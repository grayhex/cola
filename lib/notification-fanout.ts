import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.ts";
import { rideOccurrence } from "./ride-occurrence.ts";

// New plans and intents of the people a person follows (#341). The source says
// once that something was published (an announcement); a worker then walks the
// author's audience in bounded pages, so that no request does thousands of
// writes and a worker that dies is replaced by the next one, which continues
// from the last recipient done. Nothing here sends: the notice is an inbox
// record, and e-mail or push read the person's own policy when they send.

export interface NotificationLimits {
  /** Discovery messages that may leave the site per person in 24 hours. */
  discoveryPerDay: number;
  /** After one from an author, the next from the same author stays on the site. */
  authorCooldownMinutes: number;
  /** Announcements one author can make in 24 hours. */
  announcementsPerAuthorDay: number;
  /** Recipients of one announcement. */
  audienceMax: number;
  /** Recipients per page of the walk. */
  batch: number;
  /** The kill switch of the discovery events. */
  enabled: boolean;
  /** The kill switch of every interrupting channel (e-mail, push). */
  externalEnabled: boolean;
  /** The kill switch of push alone: e-mail goes on. */
  pushEnabled: boolean;
  /** Categories whose messages do not leave the site (and, for plans and intents, are not made). */
  disabledCategories: string[];
  /** The kill switch of the private area of "rides near me" (#343): nothing is read or kept while off. */
  nearbyEnabled: boolean;
  /** The biggest radius of the area, in kilometres. */
  nearbyMaxRadiusKm: number;
  /** How long an area confirmed by a phone lives, in hours. */
  nearbyDeviceTtlHours: number;
}
export const defaultNotificationLimits: NotificationLimits = {
  discoveryPerDay: 3,
  authorCooldownMinutes: 360,
  announcementsPerAuthorDay: 10,
  audienceMax: 5000,
  batch: 200,
  enabled: true,
  externalEnabled: true,
  pushEnabled: true,
  disabledCategories: [],
  nearbyEnabled: true,
  nearbyMaxRadiusKm: 50,
  nearbyDeviceTtlHours: 24,
};
export async function notificationLimits(
  q: Queryable,
): Promise<NotificationLimits> {
  const row = (
    await q.query<{
      discovery_per_day: number;
      author_cooldown_minutes: number;
      announcements_per_author_day: number;
      audience_max: number;
      batch: number;
      discovery_enabled: boolean;
      external_enabled: boolean;
      push_enabled: boolean;
      disabled_categories: string[];
      nearby_enabled: boolean;
      nearby_max_radius_km: number;
      nearby_device_ttl_hours: number;
    }>(
      "SELECT discovery_per_day,author_cooldown_minutes,announcements_per_author_day,audience_max,batch,discovery_enabled,external_enabled,push_enabled,disabled_categories,nearby_enabled,nearby_max_radius_km,nearby_device_ttl_hours FROM notification_limits WHERE id=1",
    )
  ).rows[0];
  return row
    ? {
        discoveryPerDay: row.discovery_per_day,
        authorCooldownMinutes: row.author_cooldown_minutes,
        announcementsPerAuthorDay: row.announcements_per_author_day,
        audienceMax: row.audience_max,
        batch: row.batch,
        enabled: row.discovery_enabled,
        externalEnabled: row.external_enabled,
        pushEnabled: row.push_enabled,
        disabledCategories: row.disabled_categories,
        nearbyEnabled: row.nearby_enabled,
        nearbyMaxRadiusKm: row.nearby_max_radius_km,
        nearbyDeviceTtlHours: row.nearby_device_ttl_hours,
      }
    : defaultNotificationLimits;
}

const discoveryTypes = "('plan_published','intent_published','plan_nearby')";

/** Great-circle distance in metres between two points given as SQL expressions of degrees. */
export const haversineSql = (
  latA: string,
  lngA: string,
  latB: string,
  lngB: string,
) =>
  `(2*6371000*asin(least(1,sqrt(power(sin(radians((${latB})::float8-(${latA})::float8)/2),2)+cos(radians((${latA})::float8))*cos(radians((${latB})::float8))*power(sin(radians((${lngB})::float8-(${lngA})::float8)/2),2)))))`;

/** The public, coarse area and the kind of a plan: all that nearby matching reads of it. */
export interface PlanGeometry {
  lat: number;
  lng: number;
  radiusM: number;
  purpose: string | null;
  pace: string | null;
  surface: string | null;
}
const text = (value: unknown) =>
  typeof value === "string" && value.length <= 40 ? value : null;
/**
 * What a plan's passport says in public (the area it named, rounded to a grid
 * of about a kilometre when it was saved) or null when it names none: with no
 * open geography there is no nearby match. The place of the meeting is not in
 * the passport and is not read.
 */
export function planGeometry(passport: unknown): PlanGeometry | null {
  const p = passport as {
    area?: { center?: unknown; radiusM?: unknown };
    purpose?: unknown;
    pace?: unknown;
    surface?: unknown;
  } | null;
  const center = p?.area?.center;
  const radiusM = p?.area?.radiusM;
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    typeof center[0] !== "number" ||
    typeof center[1] !== "number" ||
    !Number.isFinite(center[0]) ||
    !Number.isFinite(center[1]) ||
    Math.abs(center[0]) > 180 ||
    Math.abs(center[1]) > 90 ||
    typeof radiusM !== "number" ||
    !Number.isInteger(radiusM) ||
    radiusM < 1000 ||
    radiusM > 100_000
  )
    return null;
  return {
    lng: center[0],
    lat: center[1],
    radiusM,
    purpose: text(p?.purpose),
    pace: text(p?.pace),
    surface: text(p?.surface),
  };
}
/** The degrees a box around a plan must reach to hold every area that could overlap it. */
export function nearbyBox(
  plan: PlanGeometry,
  limits: Pick<NotificationLimits, "nearbyMaxRadiusKm">,
) {
  const reach = limits.nearbyMaxRadiusKm * 1000 + plan.radiusM;
  const cos = Math.max(Math.cos((plan.lat * Math.PI) / 180), 0.01);
  // A little more than the arithmetic: the areas are the centres of grid cells.
  return {
    lat: (reach / 111_000) * 1.05 + 0.03,
    lng: (reach / (111_320 * cos)) * 1.05 + 0.05,
  };
}
/**
 * Whether an area (the row `na` of `nearby_areas`) is one a plan can be offered
 * to: on, kept, in term, the plan inside its horizon, the circles overlapping and
 * the kind of ride wanted. Parameters are the caller's placeholders, in order:
 * now, the plan's start, latitude, longitude, radius in metres, purpose, pace,
 * surface. Nothing is read of the plan but what it says in public.
 */
export const nearbyMatchSql = (p: {
  now: string;
  occurs: string;
  lat: string;
  lng: string;
  radius: string;
  purpose: string;
  pace: string;
  surface: string;
}) => `na.enabled AND na.area_lat IS NOT NULL
  AND (na.expires_at IS NULL OR na.expires_at>${p.now}::timestamptz)
  AND ${p.occurs}::timestamptz>${p.now}::timestamptz
  AND ${p.occurs}::timestamptz<=${p.now}::timestamptz+na.horizon_days*interval '1 day'
  AND ${haversineSql("na.area_lat", "na.area_lng", `${p.lat}::float8`, `${p.lng}::float8`)}<=na.radius_m+${p.radius}::integer
  AND (coalesce(jsonb_array_length(na.filters->'purposes'),0)=0 OR (${p.purpose}::text IS NOT NULL AND jsonb_exists(na.filters->'purposes',${p.purpose}::text)))
  AND (coalesce(jsonb_array_length(na.filters->'paces'),0)=0 OR (${p.pace}::text IS NOT NULL AND jsonb_exists(na.filters->'paces',${p.pace}::text)))
  AND (coalesce(jsonb_array_length(na.filters->'surfaces'),0)=0 OR (${p.surface}::text IS NOT NULL AND jsonb_exists(na.filters->'surfaces',${p.surface}::text)))`;

/**
 * Says that a ride was published, if it is now a public planned ride with a
 * date to come. Call it in the transaction that changes the ride, after the
 * change: it is the first time that counts (the announcement of a ride exists
 * once, so private and public again, saving again and moving the date say
 * nothing twice), and it never speaks for a completed ride or an import.
 */
export async function announcePlan(
  q: Queryable,
  rideId: string,
  now = new Date(),
) {
  const limits = await notificationLimits(q);
  if (!limits.enabled || limits.disabledCategories.includes("plans"))
    return false;
  const occurrence = rideOccurrence.replaceAll("now()", "($2::timestamptz)");
  const result = await q.query(
    `INSERT INTO notification_fanouts(kind,source_id,author_id,occurs_at,revision,created_at)
    SELECT 'plan_published',r.id,r.owner_id,(${occurrence}),r.agreement_revision,$2
    FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
    WHERE r.id=$1 AND r.status='planned' AND r.is_public AND b.is_public AND NOT u.blocked AND (${occurrence})>$2::timestamptz
      AND (SELECT count(*) FROM notification_fanouts f WHERE f.author_id=r.owner_id AND f.created_at>$2::timestamptz-interval '24 hours')<$3
    ON CONFLICT(kind,source_id,considering) DO NOTHING`,
    [rideId, now, limits.announcementsPerAuthorDay],
  );
  return !!result.rowCount;
}

/**
 * The same for an intent: it is published when it is community-visible, active
 * and has a window to come. "Ready" and "considering" are announced separately,
 * each once, to the people who asked for that kind.
 */
export async function announceIntent(
  q: Queryable,
  intentId: string,
  now = new Date(),
) {
  const limits = await notificationLimits(q);
  if (!limits.enabled || limits.disabledCategories.includes("intents"))
    return false;
  const result = await q.query(
    `INSERT INTO notification_fanouts(kind,source_id,author_id,considering,created_at)
    SELECT 'intent_published',i.id,i.owner_id,i.readiness='considering',$2
    FROM ride_intents i JOIN users u ON u.id=i.owner_id
    WHERE i.id=$1 AND i.visibility='community' AND i.status='active' AND NOT u.blocked
      AND EXISTS(SELECT 1 FROM ride_intent_windows w WHERE w.intent_id=i.id AND w.ends_at>$2::timestamptz)
      AND (SELECT count(*) FROM notification_fanouts f WHERE f.author_id=i.owner_id AND f.created_at>$2::timestamptz-interval '24 hours')<$3
    ON CONFLICT(kind,source_id,considering) DO NOTHING`,
    [intentId, now, limits.announcementsPerAuthorDay],
  );
  return !!result.rowCount;
}

interface Fanout {
  id: string;
  kind: "plan_published" | "intent_published";
  source_id: string;
  author_id: string;
  considering: boolean;
  occurs_at: Date | null;
  revision: number | null;
  cursor: string | null;
  handled: number;
  created_at: Date;
}

/** Whether the source is still what was announced: still published, still to come. */
async function stillPublished(q: Queryable, job: Fanout, now: Date) {
  if (job.kind === "plan_published") {
    const occurrence = rideOccurrence.replaceAll("now()", "($2::timestamptz)");
    return !!(
      await q.query(
        `SELECT 1 FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
        WHERE r.id=$1 AND r.status='planned' AND r.is_public AND b.is_public AND NOT u.blocked AND (${occurrence})>$2::timestamptz`,
        [job.source_id, now],
      )
    ).rowCount;
  }
  return !!(
    await q.query(
      `SELECT 1 FROM ride_intents i JOIN users u ON u.id=i.owner_id
      WHERE i.id=$1 AND i.visibility='community' AND i.status='active' AND NOT u.blocked
        AND EXISTS(SELECT 1 FROM ride_intent_windows w WHERE w.intent_id=i.id AND w.ends_at>$2::timestamptz)`,
      [job.source_id, now],
    )
  ).rowCount;
}

/**
 * One page of one announcement, as a single statement: the audience is chosen
 * by each person's own circle (mutual follows, everyone they follow, the people
 * they picked, nobody) and mutes, the notices are made, and the cursor moves,
 * together or not at all. A notice is folded into the unread one of the same
 * author in the same quarter of an hour (a burst is one notice that points at
 * the newest), and one person gets one notice per source.
 */
async function page(
  q: Queryable,
  job: Fanout,
  token: string,
  now: Date,
  limits: NotificationLimits,
  nearby: PlanGeometry | null,
) {
  const plan = job.kind === "plan_published";
  const box = nearby ? nearbyBox(nearby, limits) : null;
  const near = nearbyMatchSql({
    now: "$14",
    occurs: "$10",
    lat: "$19",
    lng: "$20",
    radius: "$21",
    purpose: "$22",
    pace: "$23",
    surface: "$24",
  });
  const result = await q.query<{ taken: number; last: string | null }>(
    `WITH job AS (SELECT * FROM notification_fanouts WHERE id=$1 AND lease_token=$2 AND status='pending'),
    candidates AS (
      SELECT f.follower_id id FROM user_follows f WHERE f.following_id=$3
      UNION SELECT m.user_id FROM notification_circle_members m WHERE m.member_id=$3
      UNION SELECT na.user_id FROM nearby_areas na
        WHERE $18::boolean AND na.enabled AND na.area_lat IS NOT NULL
          AND na.area_lat BETWEEN $19::float8-$25::float8 AND $19::float8+$25::float8
          AND na.area_lng BETWEEN $20::float8-$26::float8 AND $20::float8+$26::float8
          AND ($4::uuid IS NULL OR na.user_id>$4)),
    reasoned AS (
      SELECT r.id,
        (CASE coalesce(s.circle,'friends')
          WHEN 'friends' THEN EXISTS(SELECT 1 FROM user_follows a WHERE a.follower_id=r.id AND a.following_id=$3) AND EXISTS(SELECT 1 FROM user_follows b WHERE b.follower_id=$3 AND b.following_id=r.id)
          WHEN 'follows' THEN EXISTS(SELECT 1 FROM user_follows a WHERE a.follower_id=r.id AND a.following_id=$3)
          WHEN 'selected' THEN EXISTS(SELECT 1 FROM notification_circle_members m WHERE m.user_id=r.id AND m.member_id=$3)
          ELSE false END
          AND (NOT $5::boolean OR coalesce(s.considering,false))) AS friend,
        -- Only what was published after the person turned the area on or moved it: the
        -- existing catalogue is shown on request (the offers), never sent as news.
        ($18::boolean AND EXISTS(SELECT 1 FROM nearby_areas na WHERE na.user_id=r.id AND na.updated_at<=(SELECT created_at FROM job) AND ${near})) AS nearby,
        (${plan ? "true" : "false"} AND EXISTS(SELECT 1 FROM ride_intents i JOIN ride_intent_windows w ON w.intent_id=i.id
          WHERE i.owner_id=r.id AND i.status='active' AND w.starts_at<=$10::timestamptz AND w.ends_at>$10::timestamptz)) AS intent
      FROM candidates c JOIN users r ON r.id=c.id AND NOT r.blocked
      LEFT JOIN notification_settings s ON s.user_id=r.id
      WHERE r.id<>$3 AND ($4::uuid IS NULL OR r.id>$4) AND EXISTS(SELECT 1 FROM job)
        -- A block either way (#354): the author's discovery never reaches who blocked them or whom they blocked.
        AND NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id=r.id AND ub.blocked_id=$3) OR (ub.blocker_id=$3 AND ub.blocked_id=r.id))
        AND NOT EXISTS(SELECT 1 FROM notification_mutes m WHERE m.user_id=r.id AND ((m.kind='author' AND m.target_id=$3) OR ($6::boolean AND m.kind='ride' AND m.target_id=$7)))
        -- Already invited, or already answering: the ride is not advertised to them.
        AND NOT ($6::boolean AND (EXISTS(SELECT 1 FROM ride_invitations v WHERE v.ride_id=$7 AND v.user_id=r.id) OR EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=$7 AND v.user_id=r.id)))),
    audience AS (
      SELECT a.id,
        CASE WHEN a.friend THEN $12::text ELSE 'plan_nearby' END AS type,
        CASE WHEN a.friend THEN $9::text ELSE $27::text END AS group_key,
        ARRAY_REMOVE(ARRAY[CASE WHEN a.friend THEN 'friend' END,CASE WHEN a.nearby THEN 'nearby' END,CASE WHEN a.intent AND (a.friend OR a.nearby) THEN 'intent' END],NULL) AS reasons
      FROM reasoned a WHERE a.friend OR a.nearby ORDER BY a.id LIMIT $8),
    folds AS (SELECT DISTINCT ON (n.recipient_id) n.id,n.recipient_id,n.read_at,a.reasons FROM notifications n JOIN audience a ON a.id=n.recipient_id
      WHERE n.group_key=a.group_key ORDER BY n.recipient_id,n.created_at DESC,n.id),
    folded AS (UPDATE notifications n SET ride_id=CASE WHEN $6 THEN $7::uuid ELSE n.ride_id END,intent_id=CASE WHEN $6 THEN n.intent_id ELSE $7::uuid END,
        event_occurs_at=CASE WHEN $6 THEN $10::timestamptz ELSE n.event_occurs_at END,event_revision=CASE WHEN $6 THEN $11::integer ELSE n.event_revision END,reasons=folds.reasons
      FROM folds WHERE n.id=folds.id AND folds.read_at IS NULL RETURNING n.id),
    made AS (INSERT INTO notifications(id,recipient_id,actor_id,type,ride_id,intent_id,dedup_key,group_key,event_occurs_at,event_revision,created_at,external,reasons)
      SELECT gen_random_uuid(),a.id,$3,a.type,CASE WHEN $6 THEN $7::uuid END,CASE WHEN $6 THEN NULL ELSE $7::uuid END,
        a.type||':'||$7::uuid::text||':'||$13,a.group_key,CASE WHEN $6 THEN $10::timestamptz END,CASE WHEN $6 THEN $11::integer END,$14::timestamptz,
        (SELECT count(*) FROM notifications d WHERE d.recipient_id=a.id AND d.type IN ${discoveryTypes} AND d.external AND d.created_at>$14::timestamptz-interval '24 hours')<$15
          AND NOT EXISTS(SELECT 1 FROM notifications d WHERE d.recipient_id=a.id AND d.actor_id=$3 AND d.type IN ${discoveryTypes} AND d.external AND d.created_at>$14::timestamptz-make_interval(mins=>$16)),
        a.reasons
      FROM audience a LEFT JOIN folds f ON f.recipient_id=a.id WHERE f.id IS NULL OR f.read_at IS NOT NULL
      ON CONFLICT(recipient_id,dedup_key) DO NOTHING RETURNING id),
    moved AS (UPDATE notification_fanouts j SET cursor=coalesce((SELECT id FROM audience ORDER BY id DESC LIMIT 1),j.cursor),handled=j.handled+(SELECT count(*) FROM audience),
        status=CASE WHEN (SELECT count(*) FROM audience)<$8 OR j.handled+(SELECT count(*) FROM audience)>=$17 THEN 'done' ELSE j.status END,
        finished_at=CASE WHEN (SELECT count(*) FROM audience)<$8 OR j.handled+(SELECT count(*) FROM audience)>=$17 THEN $14::timestamptz END,
        lease_token=CASE WHEN (SELECT count(*) FROM audience)<$8 OR j.handled+(SELECT count(*) FROM audience)>=$17 THEN NULL ELSE j.lease_token END
      FROM job WHERE j.id=job.id RETURNING j.id)
    SELECT (SELECT count(*) FROM audience)::int taken,(SELECT id FROM audience ORDER BY id DESC LIMIT 1)::text last`,
    [
      job.id, //  1
      token, //   2
      job.author_id, // 3
      job.cursor, //    4
      job.considering, // 5
      plan, //          6
      job.source_id, // 7
      Math.min(limits.batch, Math.max(1, limits.audienceMax - job.handled)), // 8
      // The group: one author's discovery in one quarter of an hour.
      `${job.kind}:${job.author_id}:${Math.floor(now.getTime() / 900_000)}`, // 9
      job.occurs_at, //    10
      job.revision, //     11
      job.kind, //         12
      `${job.considering ? "considering" : "ready"}`, // 13
      now, //              14
      limits.discoveryPerDay, // 15
      limits.authorCooldownMinutes, // 16
      limits.audienceMax, // 17
      !!nearby, //                 18
      nearby?.lat ?? null, //      19
      nearby?.lng ?? null, //      20
      nearby?.radiusM ?? null, //  21
      nearby?.purpose ?? null, //  22
      nearby?.pace ?? null, //     23
      nearby?.surface ?? null, //  24
      box?.lat ?? null, //         25
      box?.lng ?? null, //         26
      // The group of the nearby-only: kept apart from the friends' one.
      `plan_nearby:${job.author_id}:${Math.floor(now.getTime() / 900_000)}`, // 27
    ],
  );
  return result.rows[0]?.taken ?? 0;
}

/**
 * Walks the announcements that are due, a page at a time. Safe to run from
 * several workers at once: an announcement is leased, and a page is one
 * statement that checks the lease. An announcement whose source is no longer
 * what was announced (made private, cancelled, past, the author blocked)
 * stops where it is: what was said stays in the inboxes, the rest is not said.
 */
export async function runNotificationFanout(
  q: Queryable,
  { now = new Date(), pages = 5 }: { now?: Date; pages?: number } = {},
) {
  // `recipients` are the people an announcement reached: a notice made for them
  // or folded into the one they had not read yet.
  const counts = { claimed: 0, recipients: 0, done: 0, cancelled: 0 };
  const limits = await notificationLimits(q);
  for (let index = 0; index < pages; index++) {
    const token = randomUUID();
    const job = (
      await q.query<Fanout>(
        `UPDATE notification_fanouts SET lease_token=$1,lease_until=$2::timestamptz+interval '2 minutes'
        WHERE id=(SELECT id FROM notification_fanouts WHERE status='pending' AND (lease_until IS NULL OR lease_until<=$2) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id,kind,source_id,author_id,considering,occurs_at,revision,cursor,handled,created_at`,
        [token, now],
      )
    ).rows[0];
    if (!job) break;
    counts.claimed++;
    const switchedOff =
      !limits.enabled ||
      limits.disabledCategories.includes(
        job.kind === "plan_published" ? "plans" : "intents",
      );
    if (switchedOff || !(await stillPublished(q, job, now))) {
      // Nothing was said yet: forget it, so that the real publication, if it
      // comes later, is announced. Something was: it stays as said, once.
      await q.query(
        `WITH stopped AS (UPDATE notification_fanouts SET status='cancelled',finished_at=$2,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$3 AND handled>0 RETURNING id)
        DELETE FROM notification_fanouts WHERE id=$1 AND lease_token=$3 AND handled=0`,
        [job.id, now, token],
      );
      counts.cancelled++;
      continue;
    }
    // The area a plan named in public, if nearby is on and the plan named one.
    const geometry =
      job.kind === "plan_published" &&
      limits.nearbyEnabled &&
      !limits.disabledCategories.includes("nearby")
        ? planGeometry(
            (
              await q.query<{ plan_passport: unknown }>(
                "SELECT plan_passport FROM rides WHERE id=$1",
                [job.source_id],
              )
            ).rows[0]?.plan_passport,
          )
        : null;
    counts.recipients += await page(q, job, token, now, limits, geometry);
    const after = (
      await q.query<{ status: string }>(
        "SELECT status FROM notification_fanouts WHERE id=$1",
        [job.id],
      )
    ).rows[0];
    if (after?.status === "done") counts.done++;
    else
      await q.query(
        "UPDATE notification_fanouts SET lease_until=NULL WHERE id=$1 AND lease_token=$2",
        [job.id, token],
      );
  }
  return counts;
}

/** Old, finished announcements are forgotten after a month; a pending one never is. */
export async function pruneNotificationFanouts(q: Queryable, now = new Date()) {
  await q.query(
    "DELETE FROM notification_fanouts WHERE status IN ('done','cancelled') AND finished_at<$1::timestamptz-interval '30 days'",
    [now],
  );
}

/** Operator counts only: no names, no places. */
export async function notificationFanoutStatus(q: Queryable) {
  return (
    await q.query<{ status: string; count: number }>(
      "SELECT status,count(*)::int count FROM notification_fanouts GROUP BY status ORDER BY status",
    )
  ).rows;
}
