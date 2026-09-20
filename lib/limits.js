const positive = (key, fallback) => {
  const n = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`Invalid limit: ${key}`);
  return n;
};
export const limits = Object.freeze({
  bikes: positive("MAX_BIKES_PER_USER", 20),
  photos: positive("MAX_PHOTOS_PER_USER", 240),
  storageBytes: positive("MAX_PHOTO_BYTES_PER_USER", 500 * 1024 * 1024),
  fileBytes: 10 * 1024 * 1024,
  photosPerBike: 12,
  bikeCreates: positive("BIKE_CREATES_PER_15_MIN", 30),
  photoUploads: positive("PHOTO_UPLOADS_PER_15_MIN", 60),
  follows: 60,
  comments: 20,
  commentEdits: 40,
  reports: 10,
  notificationReads: 120,
  profileEdits: 30,
  avatarUploads: 15,
  avatarFileBytes: 2 * 1024 * 1024,
  authAccount: 15,
  authIp: 40,
  authGlobal: 10000,
});
export class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuotaError";
    this.status = 409;
  }
}
// Every creator holds the same owner row lock until COMMIT, before locking a bike.
export async function lockOwner(q, owner) {
  const r = await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
    owner,
  ]);
  if (!r.rows.length) throw new QuotaError("Пользователь недоступен");
}
export async function checkBikeQuota(q, owner, config = limits) {
  await lockOwner(q, owner);
  const r = await q.query(
    "SELECT count(*)::int AS n FROM bikes WHERE owner_id=$1",
    [owner],
  );
  if (r.rows[0].n >= config.bikes)
    throw new QuotaError(
      `Не больше ${config.bikes} велосипедов на пользователя`,
    );
}
export async function checkPhotoQuota(q, owner, bike, sizes, config = limits) {
  await lockOwner(q, owner);
  const owned = await q.query(
    "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [bike, owner],
  );
  if (!owned.rows.length) throw new QuotaError("Велосипед не найден");
  const r = await q.query(
    "SELECT count(*)::int AS n,coalesce(sum(coalesce(p.size_bytes,$2)),0)::bigint AS bytes,count(*) FILTER (WHERE p.bike_id=$3)::int AS bike_count FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
    [owner, config.fileBytes, bike],
  );
  const usage = r.rows[0];
  const journalBytes = Number(
    (
      await q.query(
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
      Number(
        (
          await q.query("SELECT avatar_size_bytes FROM users WHERE id=$1", [
            owner,
          ])
        ).rows[0].avatar_size_bytes,
      ) +
      sizes.reduce((a, b) => a + b, 0) >
    config.storageBytes
  )
    throw new QuotaError("Лимит места для фотографий исчерпан");
  return usage;
}
