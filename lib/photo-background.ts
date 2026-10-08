import { randomUUID } from "node:crypto";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  BackgroundRemovalError,
  removalMessages,
  removeBackground,
  type RemovalFailure,
} from "./background-removal.ts";
import { commitUncertain } from "./db.ts";
import type { Queryable, transaction as transactionType } from "./db.ts";
import { errorCode } from "./errors.ts";
import { decodeRaw, encodeWithAlpha } from "./images.ts";
import { checkPhotoQuota, limits, lockOwner } from "./limits.ts";
import {
  purgeMediaVariants,
  readCacheFile,
  removeCacheFiles,
  storeCacheFile,
} from "./media-cache.ts";
import { photoTooLargeMessage } from "./photo-upload.ts";

// Taking the backdrop off a photo (#370): the pictures it makes, the previews
// the owner looks at before taking one, and the new version of a stored photo.
//
// A stored photo is never rewritten in place: the media cache believes the
// bytes of one ID never change. A new version is a new photo ID (the row keeps
// its bike, its place, its cover mark and its source), and the file it was made
// of stays beside it as `original_filename` until the owner goes back or
// deletes the photo. `size_bytes` counts both files.

export type PhotoBackgroundReason =
  | RemovalFailure
  | "busy"
  | "stale"
  | "gone"
  | "unreadable"
  | "format"
  | "unavailable"
  | "already_removed"
  | "no_original";

/** A refusal with the words and the status the person is answered with. */
export class PhotoBackgroundError extends Error {
  status: number;
  reason: PhotoBackgroundReason;
  retryAfter?: number;
  constructor(
    status: number,
    message: string,
    reason: PhotoBackgroundReason,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "PhotoBackgroundError";
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
  }
}

const positiveEnv = (key: string, fallback: number) => {
  const n = Number(process.env[key]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};
/** How long one try may take, from reading the picture to its result. */
export const removalTimeoutMs = () =>
  positiveEnv("BACKGROUND_REMOVAL_TIMEOUT_MS", 20_000);
const removalSlots = () => positiveEnv("BACKGROUND_REMOVAL_CONCURRENCY", 2);

// Who is being served now. A try holds a few pictures' worth of memory, so the
// site does two at a time and one per person; the rest is told to come back
// (not queued: a queue is how a time limit gets spent waiting).
declare global {
  var colaCutouts: Set<string> | undefined;
}
const running = (globalThis.colaCutouts ??= new Set<string>());
function claim(owner: string) {
  if (running.has(owner))
    throw new PhotoBackgroundError(
      429,
      "Предыдущая обработка ещё идёт. Дождитесь её окончания.",
      "busy",
      3,
    );
  if (running.size >= removalSlots())
    throw new PhotoBackgroundError(
      429,
      "Сейчас обрабатываются другие фотографии. Повторите через несколько секунд.",
      "busy",
      5,
    );
  running.add(owner);
  return () => {
    running.delete(owner);
  };
}

const failureStatus: Partial<Record<RemovalFailure, number>> = {
  timeout: 504,
  aborted: 408,
  too_large: 413,
};
const refusal = (e: BackgroundRemovalError) =>
  new PhotoBackgroundError(
    failureStatus[e.reason] ?? 422,
    removalMessages[e.reason],
    e.reason,
  );

export type Cutout = {
  /** WebP with transparency. */
  bytes: Buffer;
  width: number;
  height: number;
  /** The share of the picture that became see-through (0…1). */
  removed: number;
};

/**
 * The picture without its solid backdrop. Nothing is stored here: a result
 * that arrives after the time limit is an error, never a late success.
 */
export async function cutOut(
  source: Buffer,
  owner: string,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Cutout> {
  const release = claim(owner);
  const deadline = Date.now() + (timeoutMs ?? removalTimeoutMs());
  const late = () => {
    if (Date.now() > deadline)
      throw new PhotoBackgroundError(504, removalMessages.timeout, "timeout");
  };
  try {
    let raw;
    try {
      raw = await decodeRaw(source);
    } catch {
      throw new PhotoBackgroundError(
        422,
        "Не удалось прочитать изображение.",
        "unreadable",
      );
    }
    late();
    let removal;
    try {
      removal = await removeBackground(raw, { deadline, signal });
    } catch (e) {
      if (e instanceof BackgroundRemovalError) throw refusal(e);
      throw e;
    }
    const bytes = await encodeWithAlpha(removal);
    late();
    return {
      bytes,
      width: removal.width,
      height: removal.height,
      removed: removal.removed,
    };
  } finally {
    release();
  }
}

/** The body of a request that sends a picture: the limits of an upload. */
export async function readPictureBody(req: Request) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(
      req.headers.get("content-type") ?? "",
    )
  )
    throw new PhotoBackgroundError(
      415,
      "Поддерживаются JPEG, PNG и WebP",
      "format",
    );
  const reader = req.body?.getReader();
  if (!reader)
    throw new PhotoBackgroundError(400, "Выберите фото", "unreadable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limits.fileBytes) {
      await reader.cancel();
      throw new PhotoBackgroundError(413, photoTooLargeMessage(), "too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ── Previews ─────────────────────────────────────────────────────────────

export type PreviewSource =
  | { kind: "photo"; photoId: string }
  | { kind: "candidate"; candidateId: string }
  | { kind: "upload" };

interface PreviewRow {
  id: string;
  owner_id: string;
  source: "photo" | "candidate" | "upload";
  photo_id: string | null;
  candidate_id: string | null;
  width: number;
  height: number;
  size_bytes: number;
  removed: number;
  applied_photo_id: string | null;
  expired: boolean;
}
export interface PreviewDto {
  id: string;
  /** The picture without its backdrop; only its owner may fetch it. */
  url: string;
  /** For a found photo, which the page does not hold: the picture as it was. */
  beforeUrl: string | null;
  width: number;
  height: number;
  removed: number;
  bytes: number;
}

// A preview is looked at within minutes and used within the hour; a person has
// a handful at a time (one per photo they are comparing, not an archive).
const previewMinutes = 60;
const previewsPerOwner = 6;
const previewName = (id: string, side: "after" | "before" = "after") =>
  `preview-${id}${side === "before" ? "-before" : ""}.webp`;
const previewFiles = (ids: string[]) =>
  ids.flatMap((id) => [previewName(id), previewName(id, "before")]);
export const previewUrl = (id: string, side: "after" | "before" = "after") =>
  `/api/bikes/previews/${id}${side === "before" ? "?side=before" : ""}`;

/** Expired previews, and the owner's oldest beyond the handful, are let go. */
async function dropStalePreviews(db: Queryable, owner: string) {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM photo_previews WHERE expires_at<now() OR (owner_id=$1 AND id NOT IN (
       SELECT id FROM photo_previews WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2))
     RETURNING id`,
    [owner, previewsPerOwner - 1],
  );
  await removeCacheFiles(previewFiles(rows.map((r) => r.id)));
}

export async function storePreview(
  db: Queryable,
  owner: string,
  source: PreviewSource,
  result: Cutout,
  before: Buffer | null = null,
): Promise<PreviewDto> {
  await dropStalePreviews(db, owner);
  const id = randomUUID();
  try {
    await storeCacheFile(previewName(id), result.bytes);
    if (before) await storeCacheFile(previewName(id, "before"), before);
    await db.query(
      `INSERT INTO photo_previews(id,owner_id,source,photo_id,candidate_id,width,height,size_bytes,removed,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now() + interval '${previewMinutes} minutes')`,
      [
        id,
        owner,
        source.kind,
        source.kind === "photo" ? source.photoId : null,
        source.kind === "candidate" ? source.candidateId : null,
        result.width,
        result.height,
        result.bytes.length,
        result.removed,
      ],
    );
  } catch (e) {
    await removeCacheFiles(previewFiles([id]));
    throw e;
  }
  return {
    id,
    url: previewUrl(id),
    beforeUrl: before ? previewUrl(id, "before") : null,
    width: result.width,
    height: result.height,
    removed: result.removed,
    bytes: result.bytes.length,
  };
}

const previewColumns =
  "id,owner_id,source,photo_id,candidate_id,width,height,size_bytes,removed,applied_photo_id,expires_at<now() AS expired";
const stalePreview = () =>
  new PhotoBackgroundError(
    404,
    "Предпросмотр устарел. Удалите фон ещё раз.",
    "gone",
  );

/** One side of the owner's own preview, or null: nobody else's, nothing expired. */
export async function readPreview(
  db: Queryable,
  owner: string,
  id: string,
  side: "after" | "before" = "after",
) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM photo_previews WHERE id=$1 AND owner_id=$2 AND applied_photo_id IS NULL AND expires_at>now()",
    [id, owner],
  );
  if (!rows[0]) return null;
  return readCacheFile(previewName(id, side));
}

/** The owner lets a preview go: its row and its files. */
export async function discardPreview(db: Queryable, owner: string, id: string) {
  const { rows } = await db.query<{ id: string }>(
    "DELETE FROM photo_previews WHERE id=$1 AND owner_id=$2 RETURNING id",
    [id, owner],
  );
  if (rows[0]) await removeCacheFiles(previewFiles([id]));
}

/**
 * The bytes of a preview made of a found photo, for the import that carries it
 * onto the bike. Only the owner's, unexpired, unspent, and only for that photo.
 */
export async function previewOfCandidate(
  db: Queryable,
  owner: string,
  previewId: string,
  candidateId: string,
) {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM photo_previews WHERE id=$1 AND owner_id=$2 AND source='candidate' AND candidate_id=$3 AND applied_photo_id IS NULL AND expires_at>now()",
    [previewId, owner, candidateId],
  );
  const bytes = rows[0] ? await readCacheFile(previewName(previewId)) : null;
  if (!bytes) throw stalePreview();
  return bytes;
}

/** Previews that went onto the bike with the import: spent, files let go. */
export async function settlePreviews(
  db: Queryable,
  owner: string,
  spent: { previewId: string; photoId: string }[],
) {
  for (const { previewId, photoId } of spent)
    await db.query(
      "UPDATE photo_previews SET applied_photo_id=$3 WHERE id=$1 AND owner_id=$2",
      [previewId, owner, photoId],
    );
  await removeCacheFiles(previewFiles(spent.map((s) => s.previewId)));
}

// ── The new version of a stored photo ────────────────────────────────────

interface PhotoVersionRow {
  id: string;
  filename: string;
  size_bytes: string | number | null;
  original_filename: string | null;
  original_size_bytes: string | number | null;
}
const staleVersion = () =>
  new PhotoBackgroundError(
    409,
    "Фотография изменилась или удалена, пока шла обработка. Удалите фон ещё раз.",
    "stale",
  );

/**
 * The stored photo takes the preview as its new version: a new ID, the file it
 * was made of kept. Repeating the call with the same preview answers with the
 * version already made. A preview made of another version of the photo, or of
 * a photo that is gone, is never applied.
 */
export async function applyPreview(
  transaction: typeof transactionType,
  {
    owner,
    bikeId,
    photoId,
    previewId,
    directory,
  }: {
    owner: string;
    bikeId: string;
    photoId: string;
    previewId: string;
    directory: string;
  },
) {
  let written: string | undefined;
  let outcome: { id: string; previousId: string | null; repeated: boolean };
  try {
    outcome = await transaction(async (q) => {
      await lockOwner(q, owner);
      const bike = await q.query<{ id: string }>(
        "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [bikeId, owner],
      );
      if (!bike.rows[0])
        throw new PhotoBackgroundError(404, "Велосипед не найден", "gone");
      const found = await q.query<PreviewRow>(
        `SELECT ${previewColumns} FROM photo_previews WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [previewId, owner],
      );
      const preview = found.rows[0];
      if (!preview) throw stalePreview();
      if (preview.applied_photo_id)
        return {
          id: preview.applied_photo_id,
          previousId: preview.photo_id,
          repeated: true,
        };
      if (preview.expired || preview.source !== "photo") throw stalePreview();
      if (preview.photo_id !== photoId) throw staleVersion();
      const photo = await q.query<PhotoVersionRow>(
        "SELECT id,filename,size_bytes,original_filename,original_size_bytes FROM photos WHERE id=$1 AND bike_id=$2 FOR UPDATE",
        [photoId, bikeId],
      );
      const current = photo.rows[0];
      if (!current || current.original_filename) throw staleVersion();
      const bytes = await readCacheFile(previewName(previewId));
      if (!bytes) throw stalePreview();
      const previousSize =
        current.size_bytes === null
          ? (await stat(path.join(directory, current.filename))).size
          : Number(current.size_bytes);
      await checkPhotoQuota(q, owner, bikeId, [bytes.length], limits, {
        replacing: true,
      });
      const id = randomUUID(),
        filename = id + ".webp";
      await mkdir(directory, { recursive: true });
      const handle = await open(path.join(directory, filename), "wx");
      written = filename;
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      await q.query(
        "UPDATE photos SET id=$2,filename=$3,size_bytes=$4,original_filename=filename,original_size_bytes=$5 WHERE id=$1",
        [photoId, id, filename, bytes.length + previousSize, previousSize],
      );
      await q.query(
        "UPDATE photo_previews SET applied_photo_id=$2 WHERE id=$1",
        [previewId, id],
      );
      return { id, previousId: photoId, repeated: false };
    });
  } catch (e) {
    // After an uncertain COMMIT the file may already be the photo's own.
    if (written && !commitUncertain(e))
      await unlink(path.join(directory, written)).catch(() => {});
    throw e;
  }
  if (!outcome.repeated) {
    await removeCacheFiles(previewFiles([previewId]));
    if (outcome.previousId) await purgeMediaVariants([outcome.previousId]);
  }
  return outcome;
}

/**
 * Back to the file the photo was made of: again a new ID, so that no cache
 * shows the picture without its backdrop any more. The version without the
 * backdrop is deleted.
 */
export async function restoreOriginal(
  transaction: typeof transactionType,
  {
    owner,
    bikeId,
    photoId,
    directory,
  }: { owner: string; bikeId: string; photoId: string; directory: string },
) {
  const done = await transaction(async (q) => {
    await lockOwner(q, owner);
    const bike = await q.query<{ id: string }>(
      "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [bikeId, owner],
    );
    if (!bike.rows[0])
      throw new PhotoBackgroundError(404, "Велосипед не найден", "gone");
    const photo = await q.query<PhotoVersionRow>(
      "SELECT id,filename,size_bytes,original_filename,original_size_bytes FROM photos WHERE id=$1 AND bike_id=$2 FOR UPDATE",
      [photoId, bikeId],
    );
    const current = photo.rows[0];
    if (!current)
      throw new PhotoBackgroundError(404, "Фото не найдено", "gone");
    if (!current.original_filename)
      throw new PhotoBackgroundError(
        409,
        "У этого фото нет сохранённой исходной версии.",
        "no_original",
      );
    // A lost original must not turn the photo into a broken picture.
    try {
      await stat(path.join(directory, current.original_filename));
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
      throw new PhotoBackgroundError(
        409,
        "Исходный файл не найден. Оставьте фото как есть.",
        "no_original",
      );
    }
    const id = randomUUID();
    await q.query(
      "UPDATE photos SET id=$2,filename=original_filename,size_bytes=original_size_bytes,original_filename=NULL,original_size_bytes=NULL WHERE id=$1",
      [photoId, id],
    );
    return { id, previousId: photoId, removedFile: current.filename };
  });
  // The files go after the commit: a failed commit must not lose a photo.
  await unlink(path.join(directory, done.removedFile)).catch(() => {});
  await purgeMediaVariants([done.previousId]);
  return { id: done.id, previousId: done.previousId };
}
