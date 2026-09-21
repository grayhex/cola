import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuid } from "./validation.js";
import { RideError, parseGpx } from "./ride-gpx.js";
import { publicGeometry, bounds } from "./ride-geometry.js";
import {
  putOriginal,
  getOriginal,
  removeOriginal,
  cleanupRides,
} from "./ride-storage.js";
import { speedProfile } from "./ride-speed.js";
import { publicAuthor } from "./profile-dto.js";
export const rideSettingsInput = z
  .object({
    enabled: z.boolean(),
    maxGpxBytes: z.number().int().min(1024).max(10485760),
    maxPoints: z.number().int().min(2).max(200000),
    maxRides: z.number().int().min(1).max(10000),
    uploadRate: z.number().int().min(1).max(60),
    privacyRadii: z.array(z.number().int().min(100).max(5000)).min(1).max(10),
    defaultRadius: z.number().int().min(100).max(5000),
  })
  .strict()
  .refine((v) => v.privacyRadii.includes(v.defaultRadius));
export const rideDefaults = {
  enabled: true,
  maxGpxBytes: 10485760,
  maxPoints: 200000,
  maxRides: 2000,
  uploadRate: 10,
  privacyRadii: [300, 500, 1000],
  defaultRadius: 500,
};
export async function rideSettings(q) {
  const r = await q.query("SELECT value FROM ride_settings WHERE id=1");
  return { ...rideDefaults, ...r.rows[0]?.value };
}
const fields = {
  bikeId: uuid,
  title: z.string().trim().min(1).max(120),
  description: z.string().max(3000).default(""),
  isPublic: z.boolean(),
  privacyEnabled: z.boolean(),
  privacyRadiusM: z.number().int().min(100).max(5000),
};
export const rideInput = z.object({ ...fields, previewId: uuid }).strict();
export const rideEdit = z.object(fields).strict();
export const effectiveRide = "r.is_public AND b.is_public AND NOT u.blocked";
export const rideFrom =
  " FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id";
const columns = `r.*,b.name AS bike_name,b.share_id AS bike_share_id,b.is_public AS bike_public,u.username,u.name AS author_name,u.avatar_id,
 (SELECT count(*)::int FROM ride_likes l JOIN users a ON a.id=l.user_id WHERE l.ride_id=r.id AND NOT a.blocked) AS likes,
 EXISTS(SELECT 1 FROM ride_likes l WHERE l.ride_id=r.id AND l.user_id=$1) AS liked,
 (SELECT count(*)::int FROM ride_comments c JOIN users a ON a.id=c.author_id WHERE c.ride_id=r.id AND c.deleted_at IS NULL AND NOT a.blocked) AS comments`;
export function publicRide(r, viewer) {
  return {
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    description: r.description,
    date: r.started_at
      ? new Date(r.started_at).toISOString().slice(0, 10)
      : null,
    metrics: {
      distanceM: r.distance_m,
      elapsedTimeS: r.elapsed_time_s,
      movingTimeS: r.moving_time_s,
      avgSpeedMps: r.avg_speed_mps === null ? null : Number(r.avg_speed_mps),
      elevationGainM:
        r.elevation_gain_m === null ? null : Number(r.elevation_gain_m),
    },
    geometry: r.public_geometry,
    bounds: bounds(r.public_geometry),
    bike: { id: r.bike_id, name: r.bike_name, shareId: r.bike_share_id },
    author: publicAuthor({
      id: r.owner_id,
      username: r.username,
      name: r.author_name,
      avatar_id: r.avatar_id,
    }),
    isOwner: r.owner_id === viewer,
    likes: r.likes,
    liked: r.liked,
    comments: r.comments,
  };
}
function ownerRide(r, viewer) {
  return {
    ...publicRide(r, viewer),
    isPublic: r.is_public,
    bikePublic: r.bike_public,
    privacyEnabled: r.privacy_enabled,
    privacyRadiusM: r.privacy_radius_m,
    startedAt: r.started_at,
    pointCount: r.point_count,
  };
}
export async function rideDetail(q, share, viewer, owner = false) {
  const row = (
    await q.query(
      `SELECT ${columns}${rideFrom} WHERE r.share_id=$2 AND (${effectiveRide}${owner ? " OR (r.owner_id=$1 AND NOT u.blocked)" : ""})`,
      [viewer || null, share],
    )
  ).rows[0];
  if (!row) throw new RideError("Покатушка недоступна", 404);
  return {
    ...(owner && row.owner_id === viewer
      ? ownerRide(row, viewer)
      : publicRide(row, viewer)),
    speedProfile: row.public_speed_profile || [],
  };
}
export async function rideList(
  q,
  viewer,
  {
    ownerId = null,
    username = null,
    bikeId = null,
    own = false,
    page = 1,
    ids = null,
  } = {},
) {
  const params = [viewer || null, ownerId, username, bikeId, ids];
  const where = ` WHERE ($1::uuid IS NULL OR $1::uuid IS NOT NULL) AND ${own ? "r.owner_id=$1 AND NOT u.blocked" : effectiveRide} AND ($2::uuid IS NULL OR r.owner_id=$2) AND ($3::text IS NULL OR u.username=$3) AND ($4::uuid IS NULL OR r.bike_id=$4) AND ($5::uuid[] IS NULL OR r.id=ANY($5))`;
  const count = (
    await q.query(
      "SELECT count(*)::int AS total,coalesce(sum(r.distance_m),0)::bigint AS distance" +
        rideFrom +
        where,
      params,
    )
  ).rows[0];
  const rows = (
    await q.query(
      `SELECT ${columns}${rideFrom}${where} ORDER BY r.started_at DESC NULLS LAST,r.id LIMIT 24 OFFSET $6`,
      [...params, (page - 1) * 24],
    )
  ).rows;
  return {
    rides: rows.map((r) =>
      own ? ownerRide(r, viewer) : publicRide(r, viewer),
    ),
    total: count.total,
    totalDistanceM: Number(count.distance),
    page,
    pageSize: 24,
  };
}
export async function bikeRideStats(q, ids, viewer = null) {
  return (
    await q.query(
      `SELECT r.bike_id,count(*)::int AS count,coalesce(sum(r.distance_m),0)::bigint AS distance${rideFrom} WHERE r.bike_id=ANY($1::uuid[]) AND ((${effectiveRide}) OR (r.owner_id=$2 AND NOT u.blocked)) GROUP BY r.bike_id`,
      [ids, viewer],
    )
  ).rows;
}
export async function previewRide(q, owner, bytes, config) {
  await cleanupRides(q);
  const parsed = parseGpx(bytes, {
    maxBytes: config.maxGpxBytes,
    maxPoints: config.maxPoints,
  });
  const id = randomUUID();
  await q.query("SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE", [
    owner,
  ]);
  if (
    (
      await q.query(
        "SELECT count(*)::int n FROM ride_previews WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].n >= 10
  )
    throw new RideError(
      "Слишком много незавершённых загрузок. Попробуйте через 30 минут.",
      429,
    );
  if (
    (
      await q.query(
        "SELECT 1 FROM rides WHERE owner_id=$1 AND source_hash=$2",
        [owner, parsed.sourceHash],
      )
    ).rowCount
  )
    throw new RideError("Эта покатушка уже загружена", 409);
  await putOriginal(id, bytes, "preview");
  await q.query(
    "INSERT INTO ride_previews(id,owner_id,source_hash) VALUES($1,$2,$3)",
    [id, owner, parsed.sourceHash],
  );
  return {
    previewId: id,
    title:
      parsed.title ||
      "Покатушка " +
        (parsed.metrics.startedAt
          ? new Date(parsed.metrics.startedAt).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            })
          : ""),
    metrics: parsed.metrics,
    geometry: publicGeometry(parsed.geometry),
    expiresIn: 1800,
  };
}
async function lockOwnedBike(q, owner, bike, isPublic) {
  const u = (
    await q.query(
      "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [owner],
    )
  ).rows[0];
  if (!u) throw new RideError("Пользователь недоступен", 404);
  const b = (
    await q.query(
      "SELECT is_public FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [bike, owner],
    )
  ).rows[0];
  if (!b) throw new RideError("Выберите свой велосипед", 403);
  if (isPublic && !b.is_public)
    throw new RideError(
      "Сначала опубликуйте велосипед или сохраните покатушку приватной.",
      409,
    );
}
export async function saveRide(q, owner, input, config, id = null) {
  if (!config.privacyRadii.includes(input.privacyRadiusM))
    throw new RideError("Недопустимый радиус приватности");
  await lockOwnedBike(q, owner, input.bikeId, input.isPublic);
  let bytes, existing;
  if (id) {
    existing = (
      await q.query(
        "SELECT * FROM rides WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, owner],
      )
    ).rows[0];
    if (!existing) throw new RideError("Покатушка недоступна", 404);
    bytes = await getOriginal(id);
  } else {
    if (
      (
        await q.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
          owner,
        ])
      ).rows[0].n >= config.maxRides
    )
      throw new RideError("Достигнут лимит покатушек", 409);
    const preview = (
      await q.query(
        "SELECT id FROM ride_previews WHERE id=$1 AND owner_id=$2 AND expires_at>now() FOR UPDATE",
        [input.previewId, owner],
      )
    ).rows[0];
    if (!preview)
      throw new RideError(
        "Предпросмотр истёк или недоступен. Загрузите GPX ещё раз.",
        404,
      );
    bytes = await getOriginal(input.previewId, "preview");
  }
  const parsed = parseGpx(bytes),
    geometry = publicGeometry(
      parsed.geometry,
      input.privacyEnabled,
      input.privacyRadiusM,
    ),
    m = parsed.metrics;
  if (
    !id &&
    (
      await q.query(
        "SELECT 1 FROM rides WHERE owner_id=$1 AND source_hash=$2",
        [owner, parsed.sourceHash],
      )
    ).rowCount
  )
    throw new RideError("Эта покатушка уже загружена", 409);
  const rideId = id || randomUUID(),
    shareId = existing?.share_id || randomUUID();
  if (!id) await putOriginal(rideId, bytes);
  const values = [
    rideId,
    shareId,
    owner,
    input.bikeId,
    input.title,
    input.description,
    m.startedAt,
    m.endedAt,
    m.distanceM,
    m.elapsedTimeS,
    m.movingTimeS,
    m.avgSpeedMps,
    m.elevationGainM,
    m.pointCount,
    geometry.reduce((n, s) => n + s.length, 0),
    JSON.stringify(geometry),
    input.isPublic,
    input.privacyEnabled,
    input.privacyRadiusM,
    parsed.sourceHash,
    JSON.stringify(
      speedProfile(parsed.samples, input.privacyEnabled, input.privacyRadiusM),
    ),
  ];
  await q.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,started_at,ended_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_enabled,privacy_radius_m,source_hash,public_speed_profile) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(id) DO UPDATE SET bike_id=EXCLUDED.bike_id,title=EXCLUDED.title,description=EXCLUDED.description,is_public=EXCLUDED.is_public,privacy_enabled=EXCLUDED.privacy_enabled,privacy_radius_m=EXCLUDED.privacy_radius_m,public_geometry=EXCLUDED.public_geometry,public_speed_profile=EXCLUDED.public_speed_profile,public_point_count=EXCLUDED.public_point_count,updated_at=now()`,
    values,
  );
  if (!id)
    await q.query("DELETE FROM ride_previews WHERE id=$1", [input.previewId]);
  return { id: rideId, shareId };
}
export async function deleteRide(q, owner, id) {
  await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
  const r = await q.query(
    "DELETE FROM rides WHERE id=$1 AND owner_id=$2 RETURNING id",
    [id, owner],
  );
  if (!r.rowCount) throw new RideError("Покатушка недоступна", 404);
  return { ok: true };
}
