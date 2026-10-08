import type { transaction as transactionType } from "./db.ts";
import { errorCode } from "./errors.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { savePhotos } from "./photo-storage.ts";
import type { PreparedPhoto } from "./photo-storage.ts";

import { preparePhoto } from "./images.ts";
import { bikeResolverClient } from "./bike-resolver-client.ts";
import { previewOfCandidate, settlePreviews } from "./photo-background.ts";

/**
 * The full-size bytes of a photo the search offered, for its owner while the
 * offer stands. Used by the import and by the removal of its backdrop (#370):
 * both work on the picture at the quality the source gave, not on the small
 * thumbnail the search results show.
 */
export async function candidateBytes(
  db: Queryable,
  ownerId: string,
  candidate: string,
) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM photo_search_candidates WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
    [candidate, ownerId],
  );
  if (!rows.length) throw new Error("Поиск устарел. Найдите фотографии снова.");
  const photo = await bikeResolverClient.request("/v1/photos/" + candidate);
  if (typeof photo.data !== "string" || photo.data.length > 12 * 1024 * 1024)
    throw new Error("Изображение слишком большое");
  return {
    bytes: Buffer.from(photo.data, "base64"),
    sourceUrl: photo.sourceUrl,
    sourcePageUrl: photo.sourcePageUrl,
  };
}

export async function importPhotos(
  db: Queryable,
  transaction: typeof transactionType,
  bikeId: string,
  ownerId: string,
  ids: string[],
  directory: string,
  // Found photo → the preview of it without its backdrop, which the owner
  // accepted in the wizard (#370): it is imported instead of the original.
  cutouts: Record<string, string> = {},
) {
  const prepared: PreparedPhoto[] = [];
  try {
    for (const candidate of ids) {
      const photo = await candidateBytes(db, ownerId, candidate);
      const id = randomUUID(),
        filename = id + ".webp";
      const accepted = cutouts[candidate];
      // The cut-out is already a stored-photo WebP with transparency.
      const image = accepted
        ? await previewOfCandidate(db, ownerId, accepted, candidate)
        : await preparePhoto(photo.bytes);
      prepared.push({
        id,
        filename,
        bytes: image,
        sourceUrl: photo.sourceUrl,
        sourcePageUrl: photo.sourcePageUrl,
      });
    }
    await savePhotos(transaction, ownerId, bikeId, prepared, directory);
    // The photos are in; tidying the previews must not turn that into a failure.
    await settlePreviews(
      db,
      ownerId,
      ids.flatMap((candidate, i) =>
        cutouts[candidate]
          ? [{ previewId: cutouts[candidate], photoId: prepared[i].id }]
          : [],
      ),
    ).catch(() => {});
    // The ids are in the order of the request: the caller knows which is which.
    return { count: prepared.length, ids: prepared.map((p) => p.id) };
  } catch (e) {
    if (errorCode(e) === "23505")
      throw new Error("Эта фотография уже добавлена", { cause: e });
    throw e;
  }
}
