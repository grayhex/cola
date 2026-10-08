import type { Queryable } from "./db.ts";
import { photoFileBytes, photosPerBike } from "./photo-upload.ts";
const positive = (key: string, fallback: number) => {
  const n = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`Invalid limit: ${key}`);
  return n;
};
export const limits = Object.freeze({
  bikes: positive("MAX_BIKES_PER_USER", 20),
  photos: positive("MAX_PHOTOS_PER_USER", 240),
  storageBytes: positive("MAX_PHOTO_BYTES_PER_USER", 500 * 1024 * 1024),
  fileBytes: photoFileBytes,
  photosPerBike,
  bikeCreates: positive("BIKE_CREATES_PER_15_MIN", 30),
  photoUploads: positive("PHOTO_UPLOADS_PER_15_MIN", 60),
  // Entries of the journal, one budget for the site and for API v1 (#347), per person.
  journalWrites: 20,
  // Edits of a bicycle and its parts through API v1 (#347), per person.
  bikeWrites: positive("BIKE_WRITES_PER_15_MIN", 240),
  follows: 60,
  comments: 20,
  // Answers to planned rides and edits of intentions to ride: one window of the
  // person for the site and for API v1.
  rideWrites: 20,
  rideIntentWrites: 40,
  // Changes of the private area of "rides near me" (#343), per person.
  nearbyWrites: 30,
  // The short list of current offers in that area, asked for by the person, per person.
  nearbyOfferReads: 120,
  commentEdits: 40,
  reports: 10,
  notificationReads: 120,
  // Registering and revoking the push address of a phone (#342), per person.
  pushDeviceWrites: 30,
  profileEdits: 30,
  avatarUploads: 15,
  avatarFileBytes: 2 * 1024 * 1024,
  authAccount: 15,
  authIp: 40,
  authGlobal: 10000,
  // Token refresh of device sessions (#303): per address and per session.
  refreshIp: 120,
  refreshSession: 30,
});
export class QuotaError extends Error {
  declare status: number;
  constructor(message: string | undefined) {
    super(message);
    this.name = "QuotaError";
    this.status = 409;
  }
}
// Every creator holds the same owner row lock until COMMIT, before locking a bike.
export async function lockOwner(q: Queryable, owner: unknown) {
  const r = await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 FOR UPDATE",
    [owner],
  );
  if (!r.rows.length) throw new QuotaError("Пользователь недоступен");
}
// Component media shares the same storage budget and owner lock as other uploads.
export async function componentPhotoBytes(q: Queryable, owner: unknown) {
  return Number(
    (
      await q.query<{ bytes: string }>(
        "SELECT coalesce(sum(size_bytes),0)::bigint bytes FROM component_photos WHERE author_id=$1",
        [owner],
      )
    ).rows[0].bytes,
  );
}
export async function checkBikeQuota(
  q: Queryable,
  owner: unknown,
  config = limits,
) {
  await lockOwner(q, owner);
  const r = await q.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bikes WHERE owner_id=$1",
    [owner],
  );
  if (r.rows[0].n >= config.bikes)
    throw new QuotaError(
      `Не больше ${config.bikes} велосипедов на пользователя`,
    );
}
export async function checkPhotoQuota(
  q: Queryable,
  owner: unknown,
  bike: unknown,
  sizes: number[],
  config = limits,
) {
  await lockOwner(q, owner);
  const owned = await q.query<{ id: string }>(
    "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [bike, owner],
  );
  if (!owned.rows.length) throw new QuotaError("Велосипед не найден");
  const r = await q.query<{ n: number; bytes: string; bike_count: number }>(
    "SELECT count(*)::int AS n,coalesce(sum(coalesce(p.size_bytes,$2)),0)::bigint AS bytes,count(*) FILTER (WHERE p.bike_id=$3)::int AS bike_count FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
    [owner, config.fileBytes, bike],
  );
  const usage = r.rows[0];
  const journalBytes = Number(
    (
      await q.query<{ bytes: string }>(
        "SELECT coalesce(sum(p.size_bytes),0)::bigint bytes FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=$1",
        [owner],
      )
    ).rows[0].bytes,
  );
  if (usage.bike_count + sizes.length > config.photosPerBike)
    throw new QuotaError(
      `Максимум ${config.photosPerBike} фотографий велосипеда`,
    );
  if (usage.n + sizes.length > config.photos)
    throw new QuotaError(
      `Максимум ${config.photos} фотографий на пользователя`,
    );
  if (
    Number(usage.bytes) +
      journalBytes +
      (await componentPhotoBytes(q, owner)) +
      Number(
        (
          await q.query<{ bytes: string }>(
            "SELECT coalesce(sum(p.size_bytes),0)::bigint bytes FROM market_photos p JOIN market_listings m ON m.id=p.listing_id WHERE m.owner_id=$1",
            [owner],
          )
        ).rows[0].bytes,
      ) +
      Number(
        (
          await q.query<{ avatar_size_bytes: string }>(
            "SELECT avatar_size_bytes FROM users WHERE id=$1",
            [owner],
          )
        ).rows[0].avatar_size_bytes,
      ) +
      sizes.reduce((a, b) => a + b, 0) >
    config.storageBytes
  )
    throw new QuotaError("Лимит места для фотографий исчерпан");
  return usage;
}
