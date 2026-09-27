import { z } from "zod";
import { bikeResolverClient } from "./bike-resolver-client.js";
import { CommunityError } from "./community-validation.js";
import {
  componentActor,
  lockComponent,
  authorizeComponentPhotoSearch,
} from "./component-access.js";
import { preparePhoto } from "./images.js";

const urlOn = (hosts) =>
  z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        hosts.includes(u.hostname)
      );
    });
export const componentPhotoSource = z
  .object({
    provider: z.literal("Wikimedia Commons"),
    url: urlOn(["commons.wikimedia.org"]),
    imageUrl: urlOn(["upload.wikimedia.org", "thumb.wikimedia.org"]),
    title: z.string().max(300),
    creator: z.string().min(1).max(500),
    credit: z.string().max(1000),
    license: z.string().min(1).max(80),
    licenseUrl: urlOn(["creativecommons.org"]),
  })
  .strict();
export const componentPhotoSelection = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length),
    confirmed: z.literal(true),
  })
  .strict();
const result = z.object({
  photos: z
    .array(z.object({ id: z.uuid(), source: componentPhotoSource }))
    .max(6),
});
async function upstream(path, method = "GET", body = undefined) {
  try {
    return await bikeResolverClient.request(
      "/v1/component-photos/" + path,
      method,
      body,
    );
  } catch {
    throw new CommunityError(
      "Поиск Wikimedia Commons сейчас недоступен или устарел. Повторите позже; ручная загрузка остаётся доступной по вашим правам.",
      503,
    );
  }
}
export async function searchComponentPhotos(q, transaction, id, user) {
  const model = await authorizeComponentPhotoSearch(q, id, user);
  let photos;
  try {
    photos = result.parse(
      await upstream("search", "POST", {
        category: model.category,
        brand: model.brand,
        name: model.name,
      }),
    ).photos;
  } catch (e) {
    if (e instanceof CommunityError) throw e;
    throw new CommunityError(
      "Поиск вернул неподходящие данные. Попробуйте позже.",
      503,
    );
  }
  await transaction(async (tx) => {
    const actor = await componentActor(tx, user);
    const current = await lockComponent(tx, id);
    await authorizeComponentPhotoSearch(tx, current.id, actor);
    await tx.query(
      "DELETE FROM component_photo_candidates WHERE expires_at<=now() OR (owner_id=$1 AND model_id=$2)",
      [actor.id, current.id],
    );
    for (const p of photos)
      await tx.query(
        "INSERT INTO component_photo_candidates(id,owner_id,model_id) VALUES($1,$2,$3)",
        [p.id, actor.id, current.id],
      );
  });
  return { provider: "Wikimedia Commons", photos };
}
export async function loadComponentCandidate(q, id, user, token) {
  const model = await authorizeComponentPhotoSearch(q, id, user);
  const found = await q.query(
    `SELECT 1 FROM component_photo_candidates c JOIN component_models s ON s.id=c.model_id
    WHERE c.id=$1 AND c.owner_id=$2 AND coalesce(s.merged_into,s.id)=$3 AND c.expires_at>now()`,
    [token, user.id, model.id],
  );
  if (!found.rowCount)
    throw new CommunityError(
      "Выбор устарел или недоступен. Повторите поиск.",
      404,
    );
  const photo = await upstream(token);
  let source, raw;
  try {
    source = componentPhotoSource.parse(photo.source);
    if (typeof photo.data !== "string" || photo.data.length > 12 * 1024 * 1024)
      throw new Error("Large image");
    raw = Buffer.from(photo.data, "base64");
    if (!raw.length || raw.length > 8 * 1024 * 1024)
      throw new Error("Large image");
    return { bytes: await preparePhoto(raw), source, candidateId: token };
  } catch {
    throw new CommunityError(
      "Фото не подходит: нужен JPEG, PNG или WebP до 8 МБ, от 600 × 400 px и до 40 Мп.",
      400,
    );
  }
}
