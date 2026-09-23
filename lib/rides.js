import { randomUUID } from "node:crypto";
import { rideBikeStateError } from "./bike-status.js";
import { garminFields } from "./garmin-fields.js";
import { assertMatchingTrack } from "./garmin-csv.js";
import { notify } from "./notifications.js";
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
const timeZone = z
  .string()
  .max(80)
  .regex(/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Выберите часовой пояс");
// Calendar weeks, not 168 elapsed hours: keep the local start time across DST.
export const rideOccurrence = `CASE WHEN r.status='planned' AND r.recurrence='weekly' THEN
 ((r.started_at AT TIME ZONE r.recurrence_timezone) +
 greatest(0,ceil(extract(epoch FROM ((now() AT TIME ZONE r.recurrence_timezone) - (r.started_at AT TIME ZONE r.recurrence_timezone)))/604800)::int) * interval '7 days') AT TIME ZONE r.recurrence_timezone
 ELSE r.started_at END`;
const fields = {
  recurrence: z.enum(["none", "weekly"]).optional(),
  recurrenceTimezone: timeZone.optional(),
  bikeId: uuid,
  title: z.string().trim().min(1).max(120),
  description: z.string().max(3000).default(""),
  isPublic: z.boolean(),
  privacyEnabled: z.boolean(),
  privacyRadiusM: z.number().int().min(100).max(5000),
  visibleMetrics: z
    .array(z.enum(garminFields.map((f) => f.key)))
    .max(32)
    .optional(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  meetingPoint: z.string().trim().max(200).optional(),
  invitations: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9._-]{3,30}$/),
    )
    .max(30)
    .optional(),
};
export const rideInput = z.object({ ...fields, previewId: uuid }).strict();
export const rideEdit = z.object(fields).strict();
export const planInput = z
  .object({
    ...fields,
    scheduledAt: z.iso.datetime({ offset: true }),
    previewId: uuid.optional(),
  })
  .strict();
export const garminImportInput = z
  .object({
    bikeId: uuid,
    csv: z.string().max(2 * 1024 * 1024),
    utcOffsetMinutes: z.number().int().min(-720).max(840),
    units: z.enum(["metric", "imperial"]),
    isPublic: z.boolean(),
    selected: z.array(z.number().int().min(0).max(499)).min(1).max(500),
    visibleMetrics: z.array(z.enum(garminFields.map((f) => f.key))).max(32),
  })
  .strict();
export const effectiveRide = "r.is_public AND b.is_public AND NOT u.blocked";
export const rideFrom =
  " FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id";
const columns = `r.*,${rideOccurrence} AS occurs_at,
 (SELECT response FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=(${rideOccurrence})) AS rsvp,
 (SELECT jsonb_object_agg(response,n) FROM (SELECT v.response,count(*)::int n FROM ride_rsvps v JOIN users a ON a.id=v.user_id WHERE v.ride_id=r.id AND v.occurs_at=(${rideOccurrence}) AND NOT a.blocked GROUP BY v.response) votes) AS rsvp_counts,b.name AS bike_name,b.share_id AS bike_share_id,b.is_public AS bike_public,u.username,u.name AS author_name,u.avatar_id,
 (SELECT count(*)::int FROM ride_likes l JOIN users a ON a.id=l.user_id WHERE l.ride_id=r.id AND NOT a.blocked) AS likes,
 EXISTS(SELECT 1 FROM ride_likes l WHERE l.ride_id=r.id AND l.user_id=$1) AS liked,
 (SELECT count(*)::int FROM ride_comments c JOIN users a ON a.id=c.author_id WHERE c.ride_id=r.id AND c.deleted_at IS NULL AND NOT a.blocked) AS comments`;
export function publicRide(r, viewer) {
  return {
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    description: r.description,
    status: r.status,
    recurrence: r.recurrence || "none",
    recurrenceTimezone: r.recurrence_timezone || "Europe/Moscow",
    rsvp: r.rsvp || null,
    rsvpCounts: r.rsvp_counts || {},
    sourceKind: r.source_kind,
    hasTrack: r.has_track,
    visibleMetrics: r.visible_metrics,
    features: r.features || [],
    meetingPoint: r.meeting_point || "",
    ...(r.status !== "completed"
      ? { scheduledAt: r.occurs_at || r.started_at }
      : {}),
    date:
      r.import_metrics?.activityDate ||
      (r.started_at
        ? new Date(r.occurs_at || r.started_at).toISOString().slice(0, 10)
        : null),
    metrics: {
      ...r.import_metrics,
      distanceM:
        r.source_kind === "planned" && !r.has_track ? null : r.distance_m,
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
export function ownerRide(r, viewer) {
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
      `SELECT ${columns}${rideFrom} WHERE r.share_id=$2 AND (${effectiveRide} OR (NOT u.blocked AND EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1))${owner ? " OR (r.owner_id=$1 AND NOT u.blocked)" : ""})`,
      [viewer || null, share],
    )
  ).rows[0];
  if (!row) throw new RideError("Покатушка недоступна", 404);
  return {
    ...(owner && row.owner_id === viewer
      ? ownerRide(row, viewer)
      : publicRide(row, viewer)),
    isPublic: row.is_public,
    bikePublic: row.bike_public,
    speedProfile:
      row.status === "completed" ? row.public_speed_profile || [] : [],
    invitation: viewer
      ? (
          await q.query(
            "SELECT response FROM ride_invitations WHERE ride_id=$1 AND user_id=$2",
            [row.id, viewer],
          )
        ).rows[0]?.response || null
      : null,
    invitations:
      row.owner_id === viewer
        ? (
            await q.query(
              "SELECT u.username,u.name,coalesce(v.response,'pending') AS response FROM ride_invitations i JOIN users u ON u.id=i.user_id LEFT JOIN ride_rsvps v ON v.ride_id=i.ride_id AND v.user_id=i.user_id AND v.occurs_at=$2 WHERE i.ride_id=r.id AND NOT u.blocked ORDER BY u.username".replace("i.ride_id=r.id", "i.ride_id=$1"),
              [row.id, row.occurs_at],
            )
          ).rows
        : [],
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
    status = null,
  } = {},
) {
  const params = [viewer || null, ownerId, username, bikeId, ids, status];
  const where = ` WHERE ($1::uuid IS NULL OR $1::uuid IS NOT NULL) AND ${own ? "r.owner_id=$1 AND NOT u.blocked" : effectiveRide} AND ($2::uuid IS NULL OR r.owner_id=$2) AND ($3::text IS NULL OR u.username=$3) AND ($4::uuid IS NULL OR r.bike_id=$4) AND ($5::uuid[] IS NULL OR r.id=ANY($5)) AND ($6::text IS NULL OR r.status=$6)`;
  const count = (
    await q.query(
      "SELECT count(*)::int AS total,coalesce(sum(r.distance_m) FILTER(WHERE r.status='completed'),0)::bigint AS distance" +
        rideFrom +
        where,
      params,
    )
  ).rows[0];
  const rows = (
    await q.query(
      `SELECT ${columns}${rideFrom}${where} ORDER BY CASE WHEN r.status='planned' THEN 0 ELSE 1 END,CASE WHEN r.status='planned' THEN (${rideOccurrence}) END ASC,r.started_at DESC NULLS LAST,r.id LIMIT 24 OFFSET $7`,
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
      `SELECT r.bike_id,count(*)::int AS count,coalesce(sum(r.distance_m) FILTER(WHERE r.status='completed'),0)::bigint AS distance${rideFrom} WHERE r.status='completed' AND r.bike_id=ANY($1::uuid[]) AND ((${effectiveRide}) OR (r.owner_id=$2 AND NOT u.blocked)) GROUP BY r.bike_id`,
      [ids, viewer],
    )
  ).rows;
}
export async function previewRide(
  q,
  owner,
  bytes,
  config,
  { planned = false } = {},
) {
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
    !planned &&
    (
      await q.query("SELECT 1 FROM rides WHERE owner_id=$1 AND gpx_hash=$2", [
        owner,
        parsed.sourceHash,
      ])
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
export async function lockOwnedBike(q, owner, bike, isPublic, { editing = false } = {}) {
  const u = (
    await q.query(
      "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [owner],
    )
  ).rows[0];
  if (!u) throw new RideError("Пользователь недоступен", 404);
  const b = (
    await q.query(
      "SELECT * FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [bike, owner],
    )
  ).rows[0];
  if (!b) throw new RideError("Выберите свой велосипед", 403);
  // All create paths (GPX, CSV, plans) use the same row lock and policy before
  // writing files, invitations or rides. Existing edits are checked below.
  const blocked = !editing && rideBikeStateError(b);
  if (blocked) throw new RideError(blocked, 409);
  if (isPublic && !b.is_public)
    throw new RideError(
      "Сначала опубликуйте велосипед или сохраните покатушку приватной.",
      409,
    );
  return b;
}
export async function saveRide(
  q,
  owner,
  input,
  config,
  id = null,
  { planned = false } = {},
) {
  if (!config.privacyRadii.includes(input.privacyRadiusM))
    throw new RideError("Недопустимый радиус приватности");
  const bike = await lockOwnedBike(q, owner, input.bikeId, input.isPublic, { editing: !!id });
  let bytes, existing;
  if (id) {
    existing = (
      await q.query(
        "SELECT * FROM rides WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, owner],
      )
    ).rows[0];
    if (!existing) throw new RideError("Покатушка недоступна", 404);
    const blocked = rideBikeStateError(bike, existing, input.isPublic);
    if (blocked) throw new RideError(blocked, 409);
    if (existing.status !== "completed") {
      if (
        input.scheduledAt &&
        new Date(input.scheduledAt) <= new Date() &&
        (input.recurrence ?? existing.recurrence) !== "weekly"
      )
        throw new RideError("Выберите будущую дату");
      await q.query(
        "UPDATE rides SET started_at=coalesce($2::timestamptz,started_at),features=coalesce($3::text[],features),meeting_point=coalesce($4,meeting_point),recurrence=coalesce($5,recurrence),recurrence_timezone=coalesce($6,recurrence_timezone) WHERE id=$1",
        [
          id,
          input.scheduledAt || null,
          input.features || null,
          input.meetingPoint ?? null,
          input.recurrence ?? null,
          input.recurrenceTimezone ?? null,
        ],
      );
      if (input.invitations)
        await inviteRiders(q, existing, owner, input.invitations);
    }
    if (!existing.has_track) {
      await q.query(
        "UPDATE rides SET bike_id=$2,title=$3,description=$4,is_public=$5,privacy_enabled=$6,privacy_radius_m=$7,visible_metrics=coalesce($8::jsonb,visible_metrics),updated_at=now() WHERE id=$1",
        [
          id,
          input.bikeId,
          input.title,
          input.description,
          input.isPublic,
          input.privacyEnabled,
          input.privacyRadiusM,
          input.visibleMetrics ? JSON.stringify(input.visibleMetrics) : null,
        ],
      );
      return { id, shareId: existing.share_id };
    }
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
    !planned &&
    (
      await q.query("SELECT 1 FROM rides WHERE owner_id=$1 AND gpx_hash=$2", [
        owner,
        parsed.sourceHash,
      ])
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
    planned ? "planned:" + rideId : parsed.sourceHash,
    JSON.stringify(
      planned || (existing && existing.status !== "completed")
        ? []
        : speedProfile(
            parsed.samples,
            input.privacyEnabled,
            input.privacyRadiusM,
          ),
    ),
  ];
  await q.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,started_at,ended_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_enabled,privacy_radius_m,source_hash,public_speed_profile) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(id) DO UPDATE SET bike_id=EXCLUDED.bike_id,title=EXCLUDED.title,description=EXCLUDED.description,is_public=EXCLUDED.is_public,privacy_enabled=EXCLUDED.privacy_enabled,privacy_radius_m=EXCLUDED.privacy_radius_m,public_geometry=EXCLUDED.public_geometry,public_speed_profile=EXCLUDED.public_speed_profile,public_point_count=EXCLUDED.public_point_count,updated_at=now()`,
    values,
  );
  await q.query(
    "UPDATE rides SET gpx_hash=CASE WHEN source_kind='planned' THEN NULL ELSE coalesce(gpx_hash,$2) END,visible_metrics=coalesce($3::jsonb,visible_metrics) WHERE id=$1",
    [
      rideId,
      planned ? null : parsed.sourceHash,
      input.visibleMetrics ? JSON.stringify(input.visibleMetrics) : null,
    ],
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

export async function importGarmin(q, owner, input, parsed, config) {
  await lockOwnedBike(q, owner, input.bikeId, input.isPublic);
  const selected = new Set(input.selected),
    rows = parsed.rides.filter((r) => selected.has(r.index));
  if (rows.length !== selected.size)
    throw new RideError("Выберите строки из предпросмотра");
  const count = (
    await q.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
      owner,
    ])
  ).rows[0].n;
  const known = new Set(
    (
      await q.query(
        "SELECT source_hash FROM rides WHERE owner_id=$1 AND source_hash=ANY($2::text[])",
        [owner, rows.map((r) => "garmin:" + r.fingerprint)],
      )
    ).rows.map((r) => r.source_hash),
  );
  const unique = [
    ...new Map(rows.map((r) => [r.fingerprint, r])).values(),
  ].filter((r) => !known.has("garmin:" + r.fingerprint));
  if (count + unique.length > config.maxRides)
    throw new RideError("Импорт превышает лимит покатушек", 409);
  const imported = [];
  for (const r of unique) {
    const id = randomUUID(),
      share = randomUUID(),
      m = r.metrics;
    await q.query(
      `INSERT INTO rides(id,share_id,owner_id,bike_id,title,started_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash,source_kind,has_track,import_metrics,visible_metrics)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,'[]',$12,$13,$14,'garmin',false,$15,$16)`,
      [
        id,
        share,
        owner,
        input.bikeId,
        r.title,
        r.startedAt,
        m.distanceM,
        m.elapsedTimeS,
        m.movingTimeS ?? null,
        m.avgSpeedMps ?? null,
        m.elevationGainM ?? null,
        input.isPublic,
        config.defaultRadius,
        "garmin:" + r.fingerprint,
        JSON.stringify(m),
        JSON.stringify(input.visibleMetrics),
      ],
    );
    imported.push({ id, shareId: share });
  }
  return { imported, skipped: rows.length - imported.length };
}
async function inviteRiders(q, ride, owner, usernames) {
  const names = [...new Set(usernames)];
  const users = (
    await q.query(
      "SELECT id,username FROM users WHERE username=ANY($1::text[]) AND NOT blocked",
      [names],
    )
  ).rows;
  const missing = names.filter((n) => !users.some((u) => u.username === n));
  if (missing.length)
    throw new RideError("Пользователи не найдены: " + missing.join(", "));
  const ids = users.filter((u) => u.id !== owner).map((u) => u.id);
  await q.query(
    "DELETE FROM ride_invitations WHERE ride_id=$1 AND NOT(user_id=ANY($2::uuid[]))",
    [ride.id, ids],
  );
  for (const user of users) {
    if (user.id === owner) continue;
    await q.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [ride.id, user.id],
    );
    await notify(q, {
      recipient: user.id,
      actor: owner,
      type: "ride_invite",
      ride: ride.id,
    });
  }
}
export async function planRide(q, owner, input, config) {
  if (!config.privacyRadii.includes(input.privacyRadiusM))
    throw new RideError("Недопустимый радиус приватности");
  if (new Date(input.scheduledAt) <= new Date())
    throw new RideError("Выберите будущую дату");
  await lockOwnedBike(q, owner, input.bikeId, input.isPublic);
  let result;
  if (input.previewId)
    result = await saveRide(q, owner, input, config, null, { planned: true });
  else {
    if (
      (
        await q.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
          owner,
        ])
      ).rows[0].n >= config.maxRides
    )
      throw new RideError("Достигнут лимит покатушек", 409);
    const id = randomUUID(),
      shareId = randomUUID();
    await q.query(
      `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,distance_m,point_count,public_point_count,public_geometry,is_public,privacy_enabled,privacy_radius_m,source_hash,has_track) VALUES($1,$2,$3,$4,$5,$6,0,0,0,'[]',$7,$8,$9,$10,false)`,
      [
        id,
        shareId,
        owner,
        input.bikeId,
        input.title,
        input.description,
        input.isPublic,
        input.privacyEnabled,
        input.privacyRadiusM,
        "planned:" + id,
      ],
    );
    result = { id, shareId };
  }
  await q.query(
    `UPDATE rides SET status='planned',source_kind='planned',started_at=$2,ended_at=NULL,moving_time_s=NULL,elapsed_time_s=NULL,avg_speed_mps=NULL,public_speed_profile='[]',features=$3,meeting_point=$4,recurrence=$5,recurrence_timezone=$6 WHERE id=$1`,
    [
      result.id,
      input.scheduledAt,
      input.features || [],
      input.meetingPoint || "",
      input.recurrence || "none",
      input.recurrenceTimezone || "Europe/Moscow",
    ],
  );
  await inviteRiders(q, { id: result.id }, owner, input.invitations || []);
  return result;
}
export async function attachRideTrack(q, owner, id, bytes, config) {
  const prior = (
    await q.query(
      "SELECT bike_id,is_public FROM rides WHERE id=$1 AND owner_id=$2",
      [id, owner],
    )
  ).rows[0];
  if (!prior) throw new RideError("Покатушка недоступна", 404);
  const bike = await lockOwnedBike(q, owner, prior.bike_id, prior.is_public, { editing: true });
  const ride = (
    await q.query(
      "SELECT * FROM rides WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [id, owner],
    )
  ).rows[0];
  if (!ride) throw new RideError("Покатушка недоступна", 404);
  if (ride.bike_id !== prior.bike_id)
    throw new RideError("Велосипед покатушки изменился. Обновите страницу.", 409);
  const blocked = rideBikeStateError(bike, ride, ride.is_public);
  if (blocked) throw new RideError(blocked, 409);
  if (ride.has_track)
    throw new RideError("У этой покатушки уже есть трек", 409);
  const parsed = parseGpx(bytes, {
    maxBytes: config.maxGpxBytes,
    maxPoints: config.maxPoints,
  });
  if (ride.source_kind === "garmin") assertMatchingTrack(ride, parsed.metrics);
  else if (ride.status !== "planned")
    throw new RideError("Нельзя прикрепить трек к этой поездке");
  if (
    ride.status !== "planned" &&
    (
      await q.query("SELECT 1 FROM rides WHERE owner_id=$1 AND gpx_hash=$2", [
        owner,
        parsed.sourceHash,
      ])
    ).rowCount
  )
    throw new RideError("Этот GPX уже привязан к другой покатушке", 409);
  const geometry = publicGeometry(
    parsed.geometry,
    ride.privacy_enabled,
    ride.privacy_radius_m,
  );
  await putOriginal(id, bytes);
  await q.query(
    `UPDATE rides SET has_track=true,gpx_hash=$2,point_count=$3,public_point_count=$4,public_geometry=$5,public_speed_profile=$6,distance_m=CASE WHEN status='planned' THEN $7 ELSE distance_m END,elevation_gain_m=CASE WHEN status='planned' THEN $8 ELSE elevation_gain_m END,updated_at=now() WHERE id=$1`,
    [
      id,
      ride.status === "planned" ? null : parsed.sourceHash,
      parsed.metrics.pointCount,
      geometry.reduce((n, s) => n + s.length, 0),
      JSON.stringify(geometry),
      JSON.stringify(
        ride.status === "completed"
          ? speedProfile(
              parsed.samples,
              ride.privacy_enabled,
              ride.privacy_radius_m,
            )
          : [],
      ),
      parsed.metrics.distanceM,
      parsed.metrics.elevationGainM,
    ],
  );
  return { ok: true };
}
export async function respondRide(
  q,
  id,
  user,
  response,
  occurrenceAt = null,
  invitationOnly = false,
) {
  // Match owner mutation lock order, and re-check visibility after locking.
  const initial = (
    await q.query("SELECT owner_id,bike_id FROM rides WHERE id=$1", [id])
  ).rows[0];
  if (!initial) throw new RideError("Покатушка недоступна", 404);
  const people = (
    await q.query(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([user, initial.owner_id])]],
    )
  ).rows;
  if (people.some((p) => p.blocked) || !people.some((p) => p.id === user))
    throw new RideError("Пользователь недоступен", 404);
  await q.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    initial.bike_id,
  ]);
  const row = (
    await q.query(
      `SELECT r.id,${rideOccurrence} AS occurs_at,EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$2) AS invited${rideFrom} WHERE r.id=$1 AND r.status='planned' AND NOT u.blocked AND (r.owner_id=$2 OR (${effectiveRide}) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$2)) FOR UPDATE OF r`,
      [id, user],
    )
  ).rows[0];
  if (
    !row ||
    (invitationOnly && !row.invited) ||
    !row.occurs_at ||
    new Date(row.occurs_at) <= new Date()
  )
    throw new RideError("Покатушка недоступна или уже прошла", 404);
  if (occurrenceAt && +new Date(occurrenceAt) !== +new Date(row.occurs_at))
    throw new RideError("Дата покатушки изменилась. Обновите страницу.", 409);
  await q.query(
    "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response) VALUES($1,$2,$3,$4) ON CONFLICT(ride_id,user_id,occurs_at) DO UPDATE SET response=EXCLUDED.response,updated_at=now()",
    [id, user, row.occurs_at, response],
  );
  if (row.invited)
    await q.query(
      "UPDATE ride_invitations SET response=$3 WHERE ride_id=$1 AND user_id=$2",
      [id, user, response],
    );
  const counts = (
    await q.query(
      "SELECT v.response,count(*)::int n FROM ride_rsvps v JOIN users u ON u.id=v.user_id WHERE v.ride_id=$1 AND v.occurs_at=$2 AND NOT u.blocked GROUP BY v.response",
      [id, row.occurs_at],
    )
  ).rows;
  return {
    response,
    rsvp: response,
    rsvpCounts: Object.fromEntries(counts.map((c) => [c.response, c.n])),
    scheduledAt: row.occurs_at,
  };
}
export async function respondRideInvitation(q, id, user, response) {
  return respondRide(q, id, user, response, null, true);
}
export async function cancelPlannedRide(q, id, owner) {
  await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
  const r = await q.query(
    "UPDATE rides SET status='cancelled',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='planned' RETURNING id",
    [id, owner],
  );
  if (!r.rowCount) throw new RideError("Покатушка недоступна", 404);
  return { ok: true };
}
