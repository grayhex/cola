import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { changePhoto, lockOwnBike } from "../bike-service.ts";
import { db, transaction } from "../db.ts";
import type { Queryable } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { preparePhoto } from "../images.ts";
import { QuotaError, limits, lockOwner } from "../limits.ts";
import { purgeMediaVariants } from "../media-cache.ts";
import { savePhotos } from "../photo-storage.ts";
import { ownedBike } from "../repository.ts";
import { visibleBikeById } from "../showcase.ts";
import { getSite } from "../site.ts";
import { etagOfBike } from "./bike-write-handlers.ts";
import { ApiError, notFound } from "./errors.ts";
import { idempotent, requiredKey } from "./idempotency.ts";
import { idOf } from "./journal-handlers.ts";
import { toBike, toPhoto } from "./mappers.ts";
import { readBoundedBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import { parseNoQuery } from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";

// Photos of a bicycle through /api/v1 (#347, W6a): upload, the cover and
// deletion. The engines are the site's (`preparePhoto`, `savePhotos` with its
// quotas, `changePhoto`), so what a file may be and how much a person may keep
// are the same. An upload is a raw body (no multipart); a repeat after a lost
// answer is safe because the key and the photo are written in one transaction
// and the key stands for a digest of the bytes.

type BikeParams = { params: Promise<{ id: string }> };
type PhotoParams = { params: Promise<{ id: string; photoId: string }> };

/** What an upload may declare; the bytes decide what the file really is. */
export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/octet-stream",
];
const missingBike = () => notFound("Велосипед не найден.");
const missingPhoto = () => notFound("Фото не найдено.");

const uploadsDirectory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");

/** A transaction that is already open: the engines run inside it, not beside it. */
export const within =
  (q: Queryable) =>
  <T>(run: (inner: Queryable) => Promise<T>) =>
    run(q);

/** The engine's refusal of a file, in the API's envelope. */
export function unreadable(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNSUPPORTED_IMAGE")
    throw new ApiError(
      "unsupported_media_type",
      "Поддерживаются JPEG, PNG и WebP.",
    );
  if (message.startsWith("Фото слишком"))
    throw new ApiError("invalid_request", message);
  if (/pixel limit/i.test(message))
    throw new ApiError(
      "payload_too_large",
      "Фото слишком большое по размерам в пикселях.",
    );
  throw new ApiError("invalid_request", "Не удалось прочитать изображение.");
}

/** An upload declares an image type (the bytes decide what it is), or 415. */
export function requireImageType(req: Request) {
  const declared = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!IMAGE_TYPES.includes(declared))
    throw new ApiError(
      "unsupported_media_type",
      "Тело запроса — файл JPEG, PNG или WebP.",
    );
}

/** POST /api/v1/bikes/{id}/photos */
export function handleUploadBikePhoto(req: Request, { params }: BikeParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Велосипед не найден.");
    parseNoQuery(new URL(req.url));
    // Everything that can be refused without the body is refused before it is read.
    const key = requiredKey(req.headers);
    requireImageType(req);
    const bike = await ownedBike(db, id, viewer.id);
    if (!bike) throw missingBike();
    // A photo on a public bicycle is a public write, as on the site.
    if (bike.is_public) requireVerifiedEmail(viewer);
    const bytes = await readBoundedBody(req, limits.fileBytes);
    const prepared = await preparePhoto(bytes).catch(unreadable);
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key,
        // The digest stands for the file: the same bytes under one key are one
        // upload, other bytes under it are a conflict.
        body: { sha256: createHash("sha256").update(bytes).digest("hex") },
        required: true,
      },
      async (q) => {
        await limitedIn(q, "photo-upload:" + viewer.id, limits.photoUploads);
        // The owner's lock comes first, as in every creator (limits.ts).
        await lockOwner(q, viewer.id);
        const locked = await lockOwnBike(q, id, viewer.id);
        if (!locked) throw missingBike();
        if (locked.is_public) requireVerifiedEmail(viewer);
        const photoId = randomUUID();
        try {
          await savePhotos(
            within(q) as unknown as typeof transaction,
            viewer.id,
            id,
            [{ id: photoId, filename: photoId + ".webp", bytes: prepared }],
            uploadsDirectory(),
          );
        } catch (error) {
          if (error instanceof QuotaError)
            throw new ApiError("conflict", error.message);
          throw error;
        }
        const { rows } = await q.query<{
          id: string;
          is_cover: boolean;
          source_page_url: string | null;
        }>("SELECT id,is_cover,source_page_url FROM photos WHERE id=$1", [
          photoId,
        ]);
        return { status: 201, body: toPhoto(rows[0]) };
      },
    );
    return ok(
      response.body,
      response.status,
      replayed ? { "Idempotency-Replayed": "true" } : {},
    );
  });
}

/** PUT /api/v1/bikes/{id}/photos/{photoId}/cover */
export function handleSetBikeCover(req: Request, { params }: PhotoParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const { id: rawId, photoId: rawPhoto } = await params;
    const id = idOf(rawId, "Велосипед не найден.");
    const photoId = idOf(rawPhoto, "Фото не найдено.");
    parseNoQuery(new URL(req.url));
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    const body = await transaction(async (q) => {
      const bike = await lockOwnBike(q, id, viewer.id);
      if (!bike) throw missingBike();
      if (bike.is_public) requireVerifiedEmail(viewer);
      const photo = await q.query(
        "SELECT 1 FROM photos WHERE id=$1 AND bike_id=$2",
        [photoId, id],
      );
      if (!photo.rows.length) throw missingPhoto();
      await changePhoto(
        within(q) as unknown as typeof transaction,
        id,
        photoId,
        "cover",
      );
      const read = await visibleBikeById(q, id, viewer.id, await getSite(q));
      if (!read) throw missingBike();
      return { bike: toBike(read), version: bike.version };
    });
    return ok(body.bike, 200, { ETag: etagOfBike(id, body.version) });
  });
}

/** DELETE /api/v1/bikes/{id}/photos/{photoId} */
export function handleDeleteBikePhoto(req: Request, { params }: PhotoParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const { id: rawId, photoId: rawPhoto } = await params;
    const id = idOf(rawId, "Велосипед не найден.");
    const photoId = idOf(rawPhoto, "Фото не найдено.");
    parseNoQuery(new URL(req.url));
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    const filename = await transaction(async (q) => {
      if (!(await lockOwnBike(q, id, viewer.id))) throw missingBike();
      // The next oldest photo takes the cover, as on the site; gone already is
      // as good as removed now.
      return changePhoto(
        within(q) as unknown as typeof transaction,
        id,
        photoId,
        "remove",
      );
    });
    // The files go after the commit: a failed commit must not lose a photo.
    if (filename) {
      await unlink(path.join(uploadsDirectory(), filename)).catch(() => {});
      await purgeMediaVariants([photoId]);
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
