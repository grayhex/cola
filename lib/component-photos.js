import { randomUUID } from "node:crypto";
import { mkdir, open, unlink, readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { CommunityError } from "./community-validation.js";
import { limits, QuotaError, componentPhotoBytes } from "./limits.js";
import {
  componentActor,
  lockComponent,
  publicComponent,
  componentPhotoEligibility,
} from "./component-access.js";
import { publicAuthor } from "./profile-dto.js";
import { audit } from "./site.js";
import { purgeMediaVariants } from "./media-cache.js";

const directory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
const scope =
  "SELECT id FROM component_models WHERE coalesce(merged_into,id)=$1";
const joined = `FROM component_photos p JOIN users a ON a.id=p.author_id
 JOIN component_models s ON s.id=p.model_id JOIN component_models m ON m.id=coalesce(s.merged_into,s.id)`;
export const componentPhotoEdit = z
  .object({
    version: z.number().int().positive(),
    caption: z
      .string()
      .trim()
      .max(300)
      .refine((s) => !s.includes("\0"))
      .optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.caption !== undefined || v.hidden !== undefined);
export const componentGalleryEdit = z
  .object({
    version: z.number().int().positive(),
    coverId: z.uuid().optional(),
    order: z.array(z.uuid()).max(60).optional(),
  })
  .strict()
  .refine((v) => v.coverId !== undefined || v.order !== undefined);

export async function componentGallery(q, id, user = null) {
  const model = await publicComponent(q, id);
  const admin = user?.role === "admin";
  const rows = (
    await q.query(
      `SELECT p.*,a.username,a.name,a.avatar_id,a.blocked ${joined}
     WHERE m.id=$1 AND (($2::boolean) OR (NOT p.hidden AND NOT a.blocked) OR p.author_id=$3)
     ORDER BY (p.id=m.cover_photo_id) DESC NULLS LAST,p.sort_order,p.created_at,p.id LIMIT 60`,
      [model.id, admin, user?.id || null],
    )
  ).rows;
  const cover = rows.find((p) => !p.hidden && !p.blocked)?.id || null;
  return {
    modelId: model.id,
    version: model.gallery_version,
    canUpload: await componentPhotoEligibility(q, model, user),
    canManage: admin,
    photos: rows.map((p) => ({
      id: p.id,
      url: "/api/components/media/" + p.id,
      width: p.width,
      height: p.height,
      caption: p.caption,
      author: publicAuthor({
        id: p.author_id,
        username: p.username,
        name: p.name,
        avatar_id: p.avatar_id,
      }),
      createdAt: p.created_at,
      version: p.version,
      hidden: p.hidden,
      unavailable: p.blocked,
      isCover: p.id === cover,
      canEdit: admin || user?.id === p.author_id,
      canReport: !!user && user.id !== p.author_id && !p.hidden && !p.blocked,
    })),
  };
}
export async function authorizeComponentPhoto(q, id, user) {
  const model = await publicComponent(q, id);
  if (!(await componentPhotoEligibility(q, model, user)))
    throw new CommunityError(
      "Добавлять фото может администратор или владелец велосипеда с этой моделью компонента",
      403,
    );
  return model;
}
export async function saveComponentPhoto(transaction, id, user, bytes) {
  const photo = randomUUID(),
    filename = "component-" + photo + ".webp";
  const { width, height } = await sharp(bytes).metadata();
  let written = false;
  try {
    await transaction(async (q) => {
      const actor = await componentActor(q, user, true);
      const model = await lockComponent(q, id);
      await authorizeComponentPhoto(q, model.id, actor);
      const usage = (
        await q.query(
          `SELECT (SELECT count(*) FROM component_photos WHERE model_id IN (${scope}))::int model,
        (SELECT count(*) FROM component_photos WHERE model_id IN (${scope}) AND author_id=$2)::int own_model,
        (SELECT count(*) FROM component_photos WHERE author_id=$2)::int own,
        (SELECT coalesce(max(sort_order),-1)+1 FROM component_photos WHERE model_id IN (${scope})) next_order`,
          [model.id, actor.id],
        )
      ).rows[0];
      if (
        usage.model >= 60 ||
        usage.own_model >= 12 ||
        usage.own >= limits.photos
      )
        throw new QuotaError(
          "Максимум 60 фото модели, 12 ваших фото в одной модели и " +
            limits.photos +
            " фото компонентов на пользователя",
        );
      const other = (
        await q.query(
          `SELECT (SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0) FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1)
        +(SELECT coalesce(sum(p.size_bytes),0) FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1)
        +(SELECT coalesce(sum(p.size_bytes),0) FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1)
        +(SELECT avatar_size_bytes FROM users WHERE id=$1) bytes`,
          [actor.id, limits.fileBytes],
        )
      ).rows[0];
      if (
        Number(other.bytes) +
          (await componentPhotoBytes(q, actor.id)) +
          bytes.length >
        limits.storageBytes
      )
        throw new QuotaError("Лимит места для фотографий исчерпан");
      await mkdir(directory(), { recursive: true });
      const file = await open(path.join(directory(), filename), "wx");
      written = true;
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
      await q.query(
        `INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          photo,
          model.id,
          actor.id,
          filename,
          bytes.length,
          width,
          height,
          usage.next_order,
        ],
      );
      await q.query(
        "UPDATE component_models SET gallery_version=gallery_version+1 WHERE id=$1",
        [model.id],
      );
    });
  } catch (e) {
    if (written && !e.commitUncertain)
      await unlink(path.join(directory(), filename)).catch(() => {});
    throw e;
  }
  return { id: photo };
}
export async function changeComponentPhoto(q, id, photoId, user, input = null) {
  const actor = await componentActor(
    q,
    user,
    input !== null && input.hidden !== true,
  );
  const model = await lockComponent(q, id);
  const p = (
    await q.query(
      `SELECT * FROM component_photos WHERE id=$2 AND model_id IN (${scope}) FOR UPDATE`,
      [model.id, photoId],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Фото недоступно", 404);
  if (
    actor.role !== "admin" &&
    (p.author_id !== actor.id || input?.hidden !== undefined)
  )
    throw new CommunityError("Недостаточно прав", 403);
  if (input && p.version !== input.version)
    throw new CommunityError("Фото уже изменено. Обновите галерею.", 409);
  // Hiding cannot be combined with publishing a changed caption without verification.
  if (input?.caption !== undefined) await componentActor(q, actor, true);
  if (input)
    await q.query(
      "UPDATE component_photos SET caption=coalesce($2,caption),hidden=coalesce($3,hidden),version=version+1,updated_at=now() WHERE id=$1",
      [photoId, input.caption ?? null, input.hidden ?? null],
    );
  else await q.query("DELETE FROM component_photos WHERE id=$1", [photoId]);
  await q.query(
    "UPDATE component_models SET gallery_version=gallery_version+1 WHERE id=$1",
    [model.id],
  );
  if (actor.role === "admin")
    await audit(
      q,
      actor.id,
      "component_photo." + (input ? "update" : "delete"),
      photoId,
    );
  return { ok: true };
}
export async function changeComponentGallery(q, id, user, input) {
  const actor = await componentActor(q, user, true);
  if (actor.role !== "admin")
    throw new CommunityError("Доступ только для администратора", 403);
  const model = await lockComponent(q, id);
  if (model.gallery_version !== input.version)
    throw new CommunityError("Галерея уже изменена. Обновите страницу.", 409);
  const rows = (
    await q.query(
      `SELECT p.id,p.hidden,a.blocked ${joined} WHERE m.id=$1 ORDER BY p.id`,
      [model.id],
    )
  ).rows;
  if (
    input.coverId &&
    !rows.some((p) => p.id === input.coverId && !p.hidden && !p.blocked)
  )
    throw new CommunityError("Выберите доступное фото этой модели", 404);
  if (input.order) {
    if (
      new Set(input.order).size !== rows.length ||
      input.order.length !== rows.length ||
      rows.some((p) => !input.order.includes(p.id))
    )
      throw new CommunityError(
        "Состав галереи изменился. Обновите страницу.",
        409,
      );
    for (const [index, photo] of input.order.entries())
      await q.query("UPDATE component_photos SET sort_order=$2 WHERE id=$1", [
        photo,
        index,
      ]);
  }
  await q.query(
    "UPDATE component_models SET cover_photo_id=coalesce($2,cover_photo_id),gallery_version=gallery_version+1 WHERE id=$1",
    [model.id, input.coverId || null],
  );
  await audit(q, actor.id, "component_gallery.update", model.id);
  return { ok: true };
}
export async function componentPhotoFilename(q, id, user = null) {
  const p = (
    await q.query(
      `SELECT p.filename ${joined} WHERE p.id=$1 AND m.first_public_at IS NOT NULL
     AND (($2::boolean) OR (NOT a.blocked AND (NOT p.hidden OR p.author_id=$3)))`,
      [id, user?.role === "admin", user?.id || null],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Фото недоступно", 404);
  return p.filename;
}
export async function readComponentPhotoFile(filename) {
  try {
    return await readFile(
      /*turbopackIgnore: true*/ path.join(directory(), filename),
    );
  } catch (e) {
    if (e.code === "ENOENT") throw new CommunityError("Фото недоступно", 404);
    throw e;
  }
}
export async function cleanupComponentPhotos(q, { orphans = false } = {}) {
  for (const { filename } of (
    await q.query(
      "SELECT filename FROM component_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows) {
    if (!/^component-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(/*turbopackIgnore: true*/ path.join(directory(), filename));
    } catch (e) {
      if (e.code !== "ENOENT") continue;
    }
    await purgeMediaVariants([filename.slice(10, -5)]);
    await q.query("DELETE FROM component_photo_gc WHERE filename=$1", [
      filename,
    ]);
  }
  if (!orphans) return;
  for (const filename of await readdir(
    /*turbopackIgnore: true*/ directory(),
  ).catch(() => [])) {
    if (!/^component-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    const file = path.join(/*turbopackIgnore: true*/ directory(), filename);
    const info = await stat(/*turbopackIgnore: true*/ file).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 86400000) continue;
    if (
      !(
        await q.query("SELECT 1 FROM component_photos WHERE filename=$1", [
          filename,
        ])
      ).rowCount
    )
      await unlink(file).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
}
