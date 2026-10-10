import type { CurrentUser as CurrentUserType } from "./auth.ts";
import type { transaction as transactionType } from "./db.ts";
import type { ComponentPhotoRow as ComponentPhotoRowType } from "./database-rows.ts";
import { errorCode } from "./errors.ts";
import { commitUncertain } from "./db.ts";
import type { ComponentPhotoRow } from "./database-rows.ts";
import type { Queryable } from "./db.ts";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  open,
  unlink,
  readdir,
  stat,
  readFile,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { CommunityError } from "./community-validation.ts";
import { limits, QuotaError, componentPhotoBytes } from "./limits.ts";
import {
  componentActor,
  lockComponent,
  publicComponent,
  componentPhotoEligibility,
  componentPhotoSearchEligibility,
  authorizeComponentPhotoSearch,
} from "./component-access.ts";
import { publicAuthor } from "./profile-dto.ts";
import { audit } from "./site.ts";
import { purgeMediaVariants } from "./media-cache.ts";
import type { CurrentUser } from "./contracts.ts";

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

/**
 * The public gallery of a model (API v1, #317): photos that are not hidden and
 * whose author is not blocked, cover first, then in the curators' order. No
 * moderation or editing state is part of it; the first is the cover.
 */
export async function componentPhotoList(q: Queryable, id: string) {
  const model = await publicComponent(q, id);
  const rows = (
    await q.query<
      ComponentPhotoRow & { username: string; name: string; avatar_id: string }
    >(
      `SELECT p.*,a.username,a.name,a.avatar_id ${joined}
       WHERE m.id=$1 AND NOT p.hidden AND NOT a.blocked
       ORDER BY (p.id=m.cover_photo_id) DESC NULLS LAST,p.sort_order,p.created_at,p.id LIMIT 60`,
      [model.id],
    )
  ).rows;
  return { modelId: model.id, rows };
}
export async function componentGallery(
  q: Queryable,
  id: string,
  user: CurrentUserType | null = null,
) {
  const model = await publicComponent(q, id);
  const admin = user?.role === "admin";
  const rows = (
    await q.query<{
      id: string;
      model_id: string;
      author_id: string;
      filename: string;
      size_bytes: number;
      width: number;
      height: number;
      caption: string;
      sort_order: number;
      hidden: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
      source: ComponentPhotoRow["source"];
      username: string;
      name: string;
      avatar_id: string;
      blocked: boolean;
    }>(
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
    canSearch: await componentPhotoSearchEligibility(q, model, user),
    canManage: admin,
    photos: rows.map((p) => ({
      id: p.id,
      url: "/api/components/media/" + p.id,
      width: p.width,
      height: p.height,
      caption: p.caption,
      source: p.source || null,
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
export async function authorizeComponentPhoto(
  q: Queryable,
  id: string,
  user: Pick<CurrentUser, "id" | "role">,
) {
  const model = await publicComponent(q, id);
  if (!(await componentPhotoEligibility(q, model, user)))
    throw new CommunityError(
      "Добавлять фото может администратор или владелец велосипеда с этой моделью компонента",
      403,
    );
  return model;
}
export async function saveComponentPhoto(
  transaction: typeof transactionType,
  id: string,
  user: CurrentUser,
  bytes: Buffer<ArrayBuffer>,
) {
  return (await saveComponentPhotos(transaction, id, user, [{ bytes }]))[0];
}
// One transaction for a selection: recheck the empty-gallery rule under the
// same user/catalog locks as uploads, merges, moderation and account changes.
export async function saveComponentPhotos(
  transaction: typeof transactionType,
  id: string,
  user: CurrentUser,
  inputs: {
    bytes: Buffer;
    candidateId?: string;
    source?: ComponentPhotoRowType["source"];
  }[],
  imported = false,
) {
  if (!inputs.length || inputs.length > 3)
    throw new CommunityError("Выберите от 1 до 3 фото", 400);
  const photos = await Promise.all(
    inputs.map(async (input) => {
      const photo = randomUUID();
      return {
        ...input,
        id: photo,
        filename: "component-" + photo + ".webp",
        ...(await sharp(input.bytes).metadata()),
      };
    }),
  );
  const written: string[] = [];
  try {
    await transaction(async (q: Queryable) => {
      const actor = await componentActor(q, user, true);
      const model = await lockComponent(q, id);
      if (imported) {
        await authorizeComponentPhotoSearch(q, model.id, actor);
        const ids = inputs.map((p) => p.candidateId);
        const consumed = await q.query<{ id: string }>(
          `DELETE FROM component_photo_candidates c USING component_models s
          WHERE c.model_id=s.id AND coalesce(s.merged_into,s.id)=$1 AND c.owner_id=$2
          AND c.id=ANY($3::uuid[]) AND c.expires_at>now() RETURNING c.id`,
          [model.id, actor.id, ids],
        );
        if (consumed.rowCount !== inputs.length)
          throw new CommunityError("Выбор устарел. Повторите поиск.", 409);
      } else await authorizeComponentPhoto(q, model.id, actor);
      await persistPreparedComponentPhotos(
        q,
        model.id,
        actor.id,
        photos.map((photo) => ({
          ...photo,
          source: imported ? photo.source : null,
        })),
        written,
      );
    });
  } catch (e) {
    await cleanComponentPhotoWrites(written, e);
    throw e;
  }
  return photos.map((p) => ({ id: p.id }));
}

export interface PreparedComponentPhoto {
  id: string;
  filename: string;
  bytes: Buffer;
  width?: number;
  height?: number;
  source?: ComponentPhotoRowType["source"];
}

// Also used read-only by the seed dry run. Callers lock the actor before writing.
export async function componentPhotoCapacity(
  q: Queryable,
  modelId: string | null,
  actorId: string,
  count: number,
  bytes: number,
) {
  const usage = (
    await q.query<{
      model: number;
      own_model: number;
      own: number;
      next_order: number;
    }>(
      `SELECT (SELECT count(*) FROM component_photos WHERE model_id IN (${scope}))::int model,
  (SELECT count(*) FROM component_photos WHERE model_id IN (${scope}) AND author_id=$2)::int own_model,
  (SELECT count(*) FROM component_photos WHERE author_id=$2)::int own,
  (SELECT coalesce(max(sort_order),-1)+1 FROM component_photos WHERE model_id IN (${scope})) next_order`,
      [modelId, actorId],
    )
  ).rows[0];
  if (
    (modelId !== null &&
      (usage.model + count > 60 || usage.own_model + count > 12)) ||
    usage.own + count > limits.photos
  )
    throw new QuotaError(
      "Максимум 60 фото модели, 12 ваших фото в одной модели и " +
        limits.photos +
        " фото компонентов на пользователя",
    );
  const other = (
    await q.query<{ bytes: string }>(
      `SELECT (SELECT coalesce(sum(coalesce(p.size_bytes,$2)),0) FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1)
  +(SELECT coalesce(sum(p.size_bytes),0) FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1)
  +(SELECT coalesce(sum(p.size_bytes),0) FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1)
  +(SELECT avatar_size_bytes FROM users WHERE id=$1) bytes`,
      [actorId, limits.fileBytes],
    )
  ).rows[0];
  if (
    Number(other.bytes) + (await componentPhotoBytes(q, actorId)) + bytes >
    limits.storageBytes
  )
    throw new QuotaError("Лимит места для фотографий исчерпан");
  return Number(usage.next_order);
}

// Shared storage primitive. The caller owns the user -> catalog locks and the
// enclosing transaction; journal writes must commit atomically with these rows.
export async function persistPreparedComponentPhotos(
  q: Queryable,
  modelId: string,
  actorId: string,
  photos: PreparedComponentPhoto[],
  written: string[],
  resume = false,
) {
  const nextOrder = await componentPhotoCapacity(
    q,
    modelId,
    actorId,
    photos.length,
    photos.reduce((n, photo) => n + photo.bytes.length, 0),
  );
  for (const photo of photos) {
    z.uuid().parse(photo.id);
    if (photo.filename !== "component-" + photo.id + ".webp")
      throw new Error("Invalid prepared photo filename");
  }
  await mkdir(directory(), { recursive: true });
  for (const [
    index,
    { id: photo, filename, bytes, width, height, source },
  ] of photos.entries()) {
    const target = path.join(directory(), filename);
    let file;
    try {
      file = await open(target, "wx");
      written.push(filename);
      await file.writeFile(bytes);
    } catch (error) {
      if (!resume || errorCode(error) !== "EEXIST") throw error;
      const info = await lstat(target);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== bytes.length ||
        !createHash("sha256")
          .update(await readFile(target))
          .digest()
          .equals(createHash("sha256").update(bytes).digest())
      )
        throw new Error(
          "Prepared photo filename is occupied by different bytes",
          { cause: error },
        );
    } finally {
      await file?.close();
    }
    await q.query(
      `INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height,sort_order,source)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        photo,
        modelId,
        actorId,
        filename,
        bytes.length,
        width,
        height,
        nextOrder + index,
        source ?? null,
      ],
    );
  }
  await q.query(
    "UPDATE component_models SET gallery_version=gallery_version+1 WHERE id=$1",
    [modelId],
  );
}

export async function cleanComponentPhotoWrites(
  written: string[],
  error: unknown,
) {
  if (!commitUncertain(error))
    for (const filename of written)
      await unlink(path.join(directory(), filename)).catch(() => {});
}

export async function changeComponentPhoto(
  q: Queryable,
  id: string,
  photoId: unknown,
  user: CurrentUser,
  input: z.infer<typeof componentPhotoEdit> | null = null,
) {
  const actor = await componentActor(
    q,
    user,
    input !== null && input.hidden !== true,
  );
  const model = await lockComponent(q, id);
  const p = (
    await q.query<ComponentPhotoRow>(
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
export async function changeComponentGallery(
  q: Queryable,
  id: string,
  user: CurrentUser,
  input: {
    version: number;
    coverId?: string | undefined;
    order?: string[] | undefined;
  },
) {
  const actor = await componentActor(q, user, true);
  if (actor.role !== "admin")
    throw new CommunityError("Доступ только для администратора", 403);
  const model = await lockComponent(q, id);
  if (model.gallery_version !== input.version)
    throw new CommunityError("Галерея уже изменена. Обновите страницу.", 409);
  const rows = (
    await q.query<{ id: string; hidden: boolean; blocked: boolean }>(
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
      rows.some((p) => !input.order!.includes(p.id))
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

export async function componentPhotoFilename(
  q: Queryable,
  id: string,
  user: CurrentUserType | null = null,
) {
  const p = (
    await q.query<{ filename: string }>(
      `SELECT p.filename ${joined} WHERE p.id=$1 AND m.first_public_at IS NOT NULL
     AND (($2::boolean) OR (NOT a.blocked AND (NOT p.hidden OR p.author_id=$3)))`,
      [id, user?.role === "admin", user?.id || null],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Фото недоступно", 404);
  return p.filename;
}
export async function readComponentPhotoFile(filename: string) {
  try {
    return await readFile(
      /*turbopackIgnore: true*/ path.join(directory(), filename),
    );
  } catch (e) {
    if (errorCode(e) === "ENOENT")
      throw new CommunityError("Фото недоступно", 404);
    throw e;
  }
}
export async function cleanupComponentPhotos(
  q: Queryable,
  { orphans = false } = {},
) {
  for (const { filename } of (
    await q.query<{ filename: string }>(
      "SELECT filename FROM component_photo_gc ORDER BY created_at LIMIT 200",
    )
  ).rows) {
    if (!/^component-[a-f0-9-]{36}\.webp$/.test(filename)) continue;
    try {
      await unlink(/*turbopackIgnore: true*/ path.join(directory(), filename));
    } catch (e) {
      if (errorCode(e) !== "ENOENT") continue;
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
        await q.query<{ "?column?": number }>(
          "SELECT 1 FROM component_photos WHERE filename=$1",
          [filename],
        )
      ).rowCount
    )
      await unlink(file).catch((e) => {
        if (errorCode(e) !== "ENOENT") throw e;
      });
  }
}
