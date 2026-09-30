import type { transaction as transactionType } from "./db.ts";
import { errorCode } from "./errors.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { savePhotos } from "./photo-storage.ts";

import { preparePhoto } from "./images.ts";
import { bikeResolverClient } from "./bike-resolver-client.ts";
export async function importPhotos(
  db: Queryable,
  transaction: typeof transactionType,
  bikeId: string,
  ownerId: string,
  ids: string[],
  directory: string,
) {
  const prepared = [];
  try {
    for (const candidate of ids) {
      const { rows } = await db.query<{ id: string }>(
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
    if (errorCode(e) === "23505")
      throw new Error("Эта фотография уже добавлена", { cause: e });
    throw e;
  }
}
