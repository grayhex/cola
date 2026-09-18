import { randomUUID } from "node:crypto";
import { savePhotos } from "./photo-storage.js";

import { preparePhoto } from "./images.js";
import { bikeResolverClient } from "./bike-resolver-client.js";
export async function importPhotos(
  db,
  transaction,
  bikeId,
  ownerId,
  ids,
  directory,
) {
  const prepared = [];
  try {
    for (const candidate of ids) {
      const { rows } = await db.query(
        "SELECT id FROM photo_search_candidates WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
        [candidate, ownerId],
      );
      if (!rows.length)
        throw new Error("Поиск устарел. Найдите фотографии снова.");
      const photo = await bikeResolverClient.request("/v1/photos/" + candidate);
      if (
        typeof photo.data !== "string" ||
        photo.data.length > 12 * 1024 * 1024
      )
        throw new Error("Изображение слишком большое");
      const image = await preparePhoto(Buffer.from(photo.data, "base64"));
      const id = randomUUID(),
        filename = id + ".webp";
      prepared.push({
        id,
        filename,
        bytes: image,
        sourceUrl: photo.sourceUrl,
        sourcePageUrl: photo.sourcePageUrl,
      });
    }
    await savePhotos(transaction, ownerId, bikeId, prepared, directory);
    return { count: prepared.length };
  } catch (e) {
    if (e.code === "23505") throw new Error("Эта фотография уже добавлена");
    throw e;
  }
}
