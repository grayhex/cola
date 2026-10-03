import type * as RepositoryTypes from "./repository.ts";
import type * as DatabaseRowsTypes from "./database-rows.ts";
import type * as RideAnalysisContractTypes from "./ride-analysis-contract.ts";
import type * as RideAgreementTypes from "./ride-agreement.ts";
import type * as RideMatchCoreTypes from "./ride-match-core.ts";
import type { Queryable } from "./db.ts";
import type { RideRow, RideViewRow } from "./database-rows.ts";
import type { ExternalActivityRow } from "./activity-contracts.ts";
import type { parseGarminCsv } from "./garmin-csv.ts";
export type RideSettings = z.infer<typeof rideSettingsInput>;
export interface ActivitySummary {
  name: string;
  activityType: string | null;
  startedAt: string | null;
  metrics: Record<string, number>;
}
import { planFields, plannedDetails, plannedEnd } from "./ride-plan.ts";
import { randomUUID } from "node:crypto";
import { rideBikeStateError } from "./bike-status.ts";
import { garminFields, defaultRideFields } from "./garmin-fields.ts";
import { assertMatchingTrack } from "./garmin-csv.ts";
import {
  rideNotice,
  invalidateRideNotices,
  scheduleRideReminders,
  rideReminderStatus,
} from "./ride-notifications.ts";
import { z } from "zod";
import { uuid } from "./validation.ts";
import { RideError } from "./ride-gpx.ts";
import { parseTrack } from "./ride-track.ts";
import {
  storeRideAnalysis,
  permittedAnalysis,
  ANALYSIS_VERSION,
} from "./ride-analysis.ts";
import { publicGeometry, bounds } from "./ride-geometry.ts";
import { putOriginal, getOriginal } from "./ride-storage.ts";
import { speedProfile } from "./ride-speed.ts";
import { publicAuthor } from "./profile-dto.ts";
import {
  agreementChanges,
  mayJoin,
  participationState,
} from "./ride-agreement.ts";
import { rideOccurrence, maxCancelledOccurrences } from "./ride-occurrence.ts";
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
export async function rideSettings(q: Queryable) {
  const r = await q.query<{ value: Partial<RideSettings> }>(
    "SELECT value FROM ride_settings WHERE id=1",
  );
  return { ...rideDefaults, ...r.rows[0]?.value };
}
const timeZone = z
  .string()
  .max(80)
  .regex(/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Выберите часовой пояс");
export { rideOccurrence, maxCancelledOccurrences } from "./ride-occurrence.ts";
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
export type RideEdit = z.infer<typeof rideEdit>;
export const rideEdit = z.object({ ...fields, ...planFields }).strict();
export type PlanInput = z.infer<typeof planInput>;
export const planInput = z
  .object({
    ...fields,
    ...planFields,
    scheduledAt: z.iso.datetime({ offset: true }),
    previewId: uuid.optional(),
    // #234: proposed from a group of interest; kept for the funnel only.
    fromInterest: z.literal(true).optional(),
  })
  .strict();
export type GarminImportInput = z.infer<typeof garminImportInput>;
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
// One answer per person and date (#235): "going"/"maybe" given to an earlier
// edition of the conditions counts as "reconfirm", never as agreement.
const answerState = `CASE WHEN v.response<>'declined' AND v.revision<r.agreement_revision THEN 'reconfirm' ELSE v.response END`;
const columns = `r.*,${rideOccurrence} AS occurs_at,
 EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=$1 AND NOT viewer.blocked) AS viewer_active,
 EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1) AS invited,
 (SELECT response FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=(${rideOccurrence})) AS rsvp,
 (SELECT revision FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=(${rideOccurrence})) AS rsvp_revision,
 coalesce(r.recruitment_closed_for=(${rideOccurrence}),false) AS recruitment_closed,
 (SELECT jsonb_object_agg(state,n) FROM (SELECT ${answerState} AS state,count(*)::int n FROM ride_rsvps v JOIN users a ON a.id=v.user_id WHERE v.ride_id=r.id AND v.occurs_at=(${rideOccurrence}) AND NOT a.blocked GROUP BY 1) votes) AS rsvp_counts,b.name AS bike_name,b.share_id AS bike_share_id,b.is_public AS bike_public,u.username,u.name AS author_name,u.avatar_id,
 (SELECT count(*)::int FROM ride_likes l JOIN users a ON a.id=l.user_id WHERE l.ride_id=r.id AND NOT a.blocked) AS likes,
 EXISTS(SELECT 1 FROM ride_likes l WHERE l.ride_id=r.id AND l.user_id=$1) AS liked,
 (SELECT count(*)::int FROM ride_comments c JOIN users a ON a.id=c.author_id WHERE c.ride_id=r.id AND c.deleted_at IS NULL AND NOT a.blocked) AS comments`;
// Imported metrics (heart rate, power, calories) leave the account only when
// the owner shows them; the owner's own responses carry all of them.
export const shownMetrics = (r: RideRow) => {
  const shown = new Set(r.visible_metrics || defaultRideFields);
  return Object.fromEntries(
    Object.entries(r.import_metrics || {}).filter(([key]) => shown.has(key)),
  );
};
/** The viewer's participation in the current date (#235); the same values in
lists, the detail page and the home page. */
function viewerParticipation(
  r: RideViewRow,
  viewer: string | null | undefined,
) {
  const state = participationState({
    owner: !!viewer && r.owner_id === viewer,
    invited: !!r.invited,
    response: r.rsvp,
    revision: r.rsvp_revision,
    agreementRevision: r.agreement_revision || 1,
  });
  return {
    participation: viewer && r.viewer_active ? state : "none",
    // An answer to an earlier edition is shown as such, never as agreement.
    rsvp: ["accepted", "maybe", "declined"].includes(state) ? state : null,
    previousRsvp: state === "reconfirm" ? r.rsvp : null,
    invited: !!r.invited,
    recruitmentClosed: !!r.recruitment_closed,
    canJoin:
      !!viewer &&
      !!r.viewer_active &&
      mayJoin(state, {
        invited: !!r.invited,
        recruitmentClosed: !!r.recruitment_closed,
      }),
    agreement: {
      revision: r.agreement_revision || 1,
      changes: r.agreement_changes || [],
      changedAt: r.agreement_changed_at || null,
    },
  };
}
/**
 * Whether the viewer may read the meeting point (#235): everyone for a public
 * one, only the organizer and people who said "going" for one marked "only for
 * participants". One rule for the web, the legacy API and API v1.
 */
export function meetingVisible(
  r: RideViewRow,
  viewer: string | null | undefined,
) {
  return (
    r.source_kind !== "planned" ||
    r.meeting_visibility !== "participants" ||
    !!(r.viewer_active && (r.owner_id === viewer || r.rsvp === "accepted"))
  );
}
export function publicRide(r: RideViewRow, viewer: string | null | undefined) {
  return {
    id: r.id,
    shareId: r.share_id,
    title: r.title,
    description: r.description,
    status: r.status,
    recurrence: r.recurrence || "none",
    recurrenceTimezone: r.recurrence_timezone || "Europe/Moscow",
    rsvp: null,
    ...(r.source_kind === "planned" ? viewerParticipation(r, viewer) : {}),
    rsvpCounts: r.rsvp_counts || {},
    sourceKind: r.source_kind,
    hasTrack: r.has_track,
    visibleMetrics: r.visible_metrics,
    features: r.features || [],
    meetingPoint: meetingVisible(r, viewer) ? r.meeting_point || "" : "",
    ...(r.source_kind === "planned"
      ? {
          passport: r.plan_passport || {},
          meetingVisibility: r.meeting_visibility || "public",
          meetingHidden: !meetingVisible(r, viewer),
          expectedEndAt: plannedEnd(r),
        }
      : {}),
    ...(r.status !== "completed"
      ? { scheduledAt: r.occurs_at || r.started_at }
      : {}),
    date:
      r.import_metrics?.activityDate ||
      (r.started_at
        ? new Date(r.occurs_at || r.started_at).toISOString().slice(0, 10)
        : null),
    metrics: {
      ...shownMetrics(r),
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
export function ownerRide(r: RideViewRow, viewer: string | null | undefined) {
  const ride = publicRide(r, viewer);
  return {
    ...ride,
    metrics: { ...r.import_metrics, ...ride.metrics },
    isPublic: r.is_public,
    bikePublic: r.bike_public,
    privacyEnabled: r.privacy_enabled,
    privacyRadiusM: r.privacy_radius_m,
    startedAt: r.started_at,
    ...(r.source_kind === "planned" ? { planEndsAt: r.plan_ends_at } : {}),
    pointCount: r.point_count,
  };
}
/** Who answered the current date or is invited to it, for the organizer only
(#235). Names never reach other viewers; counts are the same states as the
public buttons plus invitations still waiting for an answer. */
async function organizerAnswers(
  q: RepositoryTypes.Queryable,
  row: RideViewRow,
) {
  const people = (
    await q.query<{
      id: string;
      username: string;
      name: string;
      avatar_id: string | null;
      invited: boolean;
      response: "accepted" | "maybe" | "declined" | null;
      revision: number | null;
    }>(
      `SELECT u.id,u.username,u.name,u.avatar_id,i.user_id IS NOT NULL AS invited,v.response,v.revision
       FROM (SELECT user_id FROM ride_invitations WHERE ride_id=$1
             UNION SELECT user_id FROM ride_rsvps WHERE ride_id=$1 AND occurs_at=$2) p
       JOIN users u ON u.id=p.user_id AND NOT u.blocked
       LEFT JOIN ride_invitations i ON i.ride_id=$1 AND i.user_id=p.user_id
       LEFT JOIN ride_rsvps v ON v.ride_id=$1 AND v.user_id=p.user_id AND v.occurs_at=$2
       WHERE p.user_id<>$3 ORDER BY u.username LIMIT 201`,
      [row.id, row.occurs_at, row.owner_id],
    )
  ).rows;
  const order = ["accepted", "reconfirm", "maybe", "invited", "declined"];
  const items = people
    .map((p) => ({
      author: publicAuthor(p),
      invited: p.invited,
      state: participationState({
        invited: p.invited,
        response: p.response,
        revision: p.revision,
        agreementRevision: row.agreement_revision || 1,
      }),
    }))
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));

  const counts: Record<string, number> = {};
  for (const item of items) counts[item.state] = (counts[item.state] || 0) + 1;
  return {
    counts,
    people: items.slice(0, 200),
    truncated: items.length > 200,
  };
}
/**
 * The stored analysis of a finished ride with a track, public or the owner's
 * full series; null when there is none or it is out of date. One reader for the
 * web, the legacy API and API v1.
 */
async function analysisSeries(q: Queryable, row: RideViewRow, full: boolean) {
  if (!row.has_track || row.status !== "completed") return null;
  return (
    (
      await q.query<{ series: RideAnalysisContractTypes.AnalysisSeries }>(
        `SELECT ${full ? "owner_series" : "public_series"} AS series FROM ride_analysis WHERE ride_id=$1 AND version=$2 AND source_hash=$3 AND privacy_enabled=$4 AND privacy_radius_m=$5`,
        [
          row.id,
          ANALYSIS_VERSION,
          row.gpx_hash,
          row.privacy_enabled,
          row.privacy_radius_m,
        ],
      )
    ).rows[0] ?? null
  );
}
/** What every reader but the owner may see of a ride's analysis (API v1). */
export async function publicRideAnalysis(q: Queryable, row: RideViewRow) {
  return permittedAnalysis(
    (await analysisSeries(q, row, false))?.series,
    row.visible_metrics || defaultRideFields,
    false,
  );
}
export async function rideDetail(
  q: Queryable,
  share: string,
  viewer: string | null | undefined,
  owner = false,
) {
  // The organizer reads the public page of an own plan too (#235); the
  // owner-only fields still need the owner endpoint.
  const row = (
    await q.query<DatabaseRowsTypes.RideViewRow>(
      `SELECT ${columns}${rideFrom} WHERE r.share_id=$2 AND (${effectiveRide} OR (NOT u.blocked AND (r.owner_id=$1 OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1))))`,
      [viewer || null, share],
    )
  ).rows[0];
  if (!row) throw new RideError("Покатушка недоступна", 404);
  const planned = row.source_kind === "planned",
    isOwner = !!viewer && row.owner_id === viewer;
  const fullAnalysis = owner && row.owner_id === viewer;
  const cached = await analysisSeries(q, row, fullAnalysis);
  return {
    ...(owner && row.owner_id === viewer
      ? ownerRide(row, viewer)
      : publicRide(row, viewer)),
    isPublic: row.is_public,
    bikePublic: row.bike_public,
    analysis: permittedAnalysis(
      cached?.series,
      row.visible_metrics || defaultRideFields,
      fullAnalysis,
    ),
    speedProfile:
      row.status === "completed" ? row.public_speed_profile || [] : [],
    // The viewer's own invitation, answered or not, for the current date: the
    // same single state as the RSVP buttons (#235).
    invitation:
      viewer && row.invited
        ? (
            {
              accepted: "accepted",
              maybe: "maybe",
              declined: "declined",
            } as Partial<Record<RideAgreementTypes.Participation, string>>
          )[
            participationState({
              invited: true,
              response: row.rsvp,
              revision: row.rsvp_revision,
              agreementRevision: row.agreement_revision || 1,
            })
          ] || "pending"
        : null,
    reminder:
      viewer && planned && !isOwner
        ? await rideReminderStatus(q, row.id, viewer)
        : null,
    invitations: isOwner
      ? (
          await q.query<{ username: string; name: string; response: string }>(
            `SELECT u.username,u.name,CASE WHEN v.response IS NULL THEN 'pending' ELSE ${answerState} END AS response
             FROM ride_invitations i JOIN users u ON u.id=i.user_id JOIN rides r ON r.id=i.ride_id
             LEFT JOIN ride_rsvps v ON v.ride_id=i.ride_id AND v.user_id=i.user_id AND v.occurs_at=$2
             WHERE i.ride_id=$1 AND NOT u.blocked ORDER BY u.username`,
            [row.id, row.occurs_at],
          )
        ).rows
      : [],
    ...(planned && isOwner && row.status === "planned"
      ? { answers: await organizerAnswers(q, row) }
      : {}),
    // Dates of a weekly series the organizer called off; the series goes on.
    ...(planned && row.recurrence === "weekly" && row.status === "planned"
      ? {
          cancelledOccurrences: (
            await q.query<{ occurs_at: Date }>(
              "SELECT occurs_at FROM ride_cancelled_occurrences WHERE ride_id=$1 AND occurs_at>now() ORDER BY occurs_at LIMIT $2",
              [row.id, maxCancelledOccurrences],
            )
          ).rows.map((c) => c.occurs_at),
        }
      : {}),
  };
}
export async function rideList(
  q: Queryable,
  viewer: string | null | undefined,
  {
    ownerId = null,
    username = null,
    bikeId = null,
    own = false,
    page = 1,
    ids = null,
    status = null,
    plan = null,
  }: {
    ownerId?: string | null;
    username?: string | null;
    bikeId?: string | null;
    own?: boolean;
    page?: number;
    ids?: string[] | null;
    status?: string | null;
    plan?: {
      from?: string;
      to?: string;
      pace?: string;
      purpose?: string;
      surface?: string;
      durationMin?: number;
      durationMax?: number;
      area?: string;
    } | null;
  } = {},
) {
  // Public upcoming plans (#233): only future occurrences, optional passport
  // filters. Unknown duration never passes a duration filter.
  const upcoming = !own && status === "planned";

  const f: {
    from?: string;
    to?: string;
    pace?: string;
    purpose?: string;
    surface?: string;
    durationMin?: number;
    durationMax?: number;
    area?: string;
  } = (upcoming && plan) || {};
  const params = [
    viewer || null,
    ownerId,
    username,
    bikeId,
    ids,
    status,
    upcoming ? f.from || new Date().toISOString() : null,
    f.to || null,
    f.pace || null,
    f.purpose || null,
    f.surface || null,
    f.durationMin ?? null,
    f.durationMax ?? null,
    f.area ? "%" + f.area.replace(/[\\%_]/g, "\\$&") + "%" : null,
  ];
  const duration = `coalesce(extract(epoch FROM (r.plan_ends_at-r.started_at))/60,(r.plan_passport->'durationMinutes'->>'max')::numeric)`;
  const where = ` WHERE ($1::uuid IS NULL OR $1::uuid IS NOT NULL) AND ${own ? "r.owner_id=$1 AND NOT u.blocked" : effectiveRide} AND ($2::uuid IS NULL OR r.owner_id=$2) AND ($3::text IS NULL OR u.username=$3) AND ($4::uuid IS NULL OR r.bike_id=$4) AND ($5::uuid[] IS NULL OR r.id=ANY($5)) AND ($6::text IS NULL OR r.status=$6)
   AND ($7::timestamptz IS NULL OR (${rideOccurrence})>=$7) AND ($8::timestamptz IS NULL OR (${rideOccurrence})<$8)
   AND ($9::text IS NULL OR r.plan_passport->>'pace'=$9) AND ($10::text IS NULL OR r.plan_passport->>'purpose'=$10) AND ($11::text IS NULL OR r.plan_passport->>'surface'=$11)
   AND ($12::int IS NULL OR ${duration}>=$12) AND ($13::int IS NULL OR ${duration}<=$13)
   AND ($14::text IS NULL OR r.plan_passport->'area'->>'label' ILIKE $14)`;
  const count = (
    await q.query<{ total: number; distance: string }>(
      "SELECT count(*)::int AS total,coalesce(sum(r.distance_m) FILTER(WHERE r.status='completed'),0)::bigint AS distance" +
        rideFrom +
        where,
      params,
    )
  ).rows[0];
  const rows = (
    await q.query<DatabaseRowsTypes.RideViewRow>(
      `SELECT ${columns}${rideFrom}${where} ORDER BY CASE WHEN r.status='planned' THEN 0 ELSE 1 END,CASE WHEN r.status='planned' THEN (${rideOccurrence}) END ASC,r.started_at DESC NULLS LAST,r.id LIMIT 24 OFFSET $15`,
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
/**
 * What API v1 shows of a ride: the legacy public rule plus "not called off".
 * A called-off ride answers 404 like a hidden one; its page does not exist for
 * a client that is not the organizer or an invitee.
 */
export const apiRide = `${effectiveRide} AND r.status<>'cancelled'`;
// PostgreSQL's own text of a timestamp: microseconds, UTC. A cursor made of it
// loses nothing to the rounding that Date makes.
const cursorText = (expression: string) =>
  `to_char((${expression}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/**
 * The text search of rides: a literal match, case and form insensitive, in
 * the title, the description, the author's name and username and the bike's
 * name: the same rule as the site search.
 */
const rideTextMatch = (parameter: string) =>
  `strpos(lower(normalize(r.title||' '||r.description||' '||u.name||' '||u.username||' '||b.name,NFKC)),lower(normalize(${parameter}::text,NFKC)))>0`;
export interface RideCursor {
  createdAt: string;
  id: string;
}
export type RideKeysetRow = RideViewRow & { cursor_at: string };
function ridePage(
  rows: RideKeysetRow[],
  limit: number,
): { rows: RideKeysetRow[]; next: RideCursor | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    next:
      rows.length > limit && last
        ? { createdAt: last.cursor_at, id: last.id }
        : null,
  };
}
/** Whether API v1 shows this ride to anyone; no card is built. */
export async function apiRideVisible(q: Queryable, id: string) {
  return (
    (await q.query(`SELECT 1${rideFrom} WHERE r.id=$1 AND ${apiRide}`, [id]))
      .rows.length > 0
  );
}
/**
 * One public ride by its id for API v1, or undefined. Hidden, private,
 * called-off, of a private bike or of a blocked author are all the same.
 */
export async function apiRideRow(
  q: Queryable,
  id: string,
  viewer: string | null,
) {
  return (
    await q.query<RideViewRow>(
      `SELECT ${columns}${rideFrom} WHERE r.id=$2 AND ${apiRide}`,
      [viewer, id],
    )
  ).rows[0];
}
/**
 * Finished public rides, newest first (API v1), optionally of one bike. The
 * position is `(coalesce(started_at, created_at), id)`: a track without times
 * has no start, and is listed by when it was added.
 */
export async function rideKeysetPage(
  q: Queryable,
  viewer: string | null,
  {
    bikeId = null,
    limit,
    after,
    text = "",
  }: {
    bikeId?: string | null;
    limit: number;
    after: RideCursor | null;
    text?: string;
  },
) {
  const position = "coalesce(r.started_at,r.created_at)";
  return ridePage(
    (
      await q.query<RideKeysetRow>(
        `SELECT ${columns},${cursorText(position)} AS cursor_at${rideFrom}
         WHERE r.status='completed' AND ${apiRide} AND ($2::uuid IS NULL OR r.bike_id=$2)
           AND ($3::timestamptz IS NULL OR (${position},r.id)<($3::timestamptz,$4::uuid))
           AND ($6::text IS NULL OR ${rideTextMatch("$6")})
         ORDER BY ${position} DESC,r.id DESC LIMIT $5`,
        [
          viewer,
          bikeId,
          after?.createdAt ?? null,
          after?.id ?? null,
          limit + 1,
          text || null,
        ],
      )
    ).rows,
    limit,
  );
}
/**
 * Public plans that have not happened yet, soonest first (API v1). A weekly
 * series is listed once, at its next date. That date moves forward with the
 * clock, so a series whose date passes between two pages may come back at its
 * next week's date; each item says which date it shows (`scheduledAt`).
 */
export async function upcomingKeysetPage(
  q: Queryable,
  viewer: string | null,
  {
    limit,
    after,
    text = "",
  }: { limit: number; after: RideCursor | null; text?: string },
) {
  const occurrence = `(${rideOccurrence})`;
  return ridePage(
    (
      await q.query<RideKeysetRow>(
        `SELECT ${columns},${cursorText(occurrence)} AS cursor_at${rideFrom}
         WHERE r.status='planned' AND r.source_kind='planned' AND ${apiRide} AND ${occurrence}>now()
           AND ($2::timestamptz IS NULL OR (${occurrence},r.id)>($2::timestamptz,$3::uuid))
           AND ($5::text IS NULL OR ${rideTextMatch("$5")})
         ORDER BY ${occurrence} ASC,r.id ASC LIMIT $4`,
        [
          viewer,
          after?.createdAt ?? null,
          after?.id ?? null,
          limit + 1,
          text || null,
        ],
      )
    ).rows,
    limit,
  );
}
/** The viewer's own next plans (#233): organised, accepted, "maybe", pending
invitations and recent cancellations of dates they had answered. Access is
rechecked like rideDetail; the meeting point follows publicRide rules. */
export async function upcomingRides(
  q: RepositoryTypes.Queryable,
  viewer: string,
) {
  const occurrence = `(${rideOccurrence})`;
  const answered = `(SELECT min(v.occurs_at) FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at>now() AND v.response IN ('accepted','maybe'))`;
  const rows = (
    await q.query<DatabaseRowsTypes.RideViewRow>(
      `SELECT ${columns},${answered} AS answered_occurrence
       ${rideFrom}
       WHERE NOT u.blocked AND r.source_kind='planned'
         AND EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=$1 AND NOT viewer.blocked)
         AND (r.owner_id=$1 OR (${effectiveRide}) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1))
         AND ((r.status='planned' AND ${occurrence}>now() AND ${occurrence}<now()+interval '60 days'
               AND (r.owner_id=$1
                 OR EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=${occurrence} AND v.response IN ('accepted','maybe'))
                 OR (EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1)
                     AND NOT EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=${occurrence}))))
           OR (r.status='cancelled' AND r.owner_id<>$1 AND r.updated_at>now()-interval '14 days' AND ${answered} IS NOT NULL))
       ORDER BY coalesce(CASE WHEN r.status='cancelled' THEN ${answered} END,${occurrence}),r.id LIMIT 20`,
      [viewer],
    )
  ).rows;
  // A single called-off date of a series the viewer said "going"/"maybe" to
  // (#235); the series itself stays in the list with its next date.
  const skipped = (
    await q.query<DatabaseRowsTypes.RideViewRow>(
      `SELECT ${columns},v.occurs_at AS answered_occurrence
       FROM ride_cancelled_occurrences c JOIN rides r ON r.id=c.ride_id
       JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
       JOIN ride_rsvps v ON v.ride_id=r.id AND v.user_id=$1 AND v.response IN ('accepted','maybe')
         AND (v.occurs_at AT TIME ZONE r.recurrence_timezone)::date=c.occurs_on
       WHERE NOT u.blocked AND r.status='planned' AND r.owner_id<>$1 AND v.occurs_at>now()
         AND c.cancelled_at>now()-interval '14 days'
         AND EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=$1 AND NOT viewer.blocked)
         AND ((${effectiveRide}) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1))
       ORDER BY v.occurs_at,r.id LIMIT 20`,
      [viewer],
    )
  ).rows.map((row) => ({ ...row, occurrence_cancelled: true }));
  const items = [...rows, ...skipped]
    .map((row) => {
      const cancelled =
        row.status === "cancelled" || !!row.occurrence_cancelled;
      const role =
        row.owner_id === viewer
          ? "organizer"
          : cancelled
            ? "cancelled"
            : row.rsvp === "accepted" || row.rsvp === "maybe"
              ? row.rsvp
              : "invited";
      const ride = publicRide(
        cancelled
          ? { ...row, occurs_at: row.answered_occurrence ?? null }
          : row,
        viewer,
      );
      return {
        ...ride,
        // A cancelled meeting is no longer an agreement to show.
        ...(cancelled ? { meetingPoint: "", meetingHidden: true } : {}),
        role,
        occurrenceCancelled: !!row.occurrence_cancelled,
        // An answer given to an earlier edition of the conditions (#235); a
        // title or typo edit is not a change.
        changedAfterAnswer:
          (role === "accepted" || role === "maybe") &&
          (row.rsvp_revision ?? 1) < (row.agreement_revision || 1),
      };
    })
    .sort(
      (a, b) =>
        +new Date(a.scheduledAt === null ? 0 : (a.scheduledAt ?? NaN)) -
          +new Date(b.scheduledAt === null ? 0 : (b.scheduledAt ?? NaN)) ||
        (a.id < b.id ? -1 : 1),
    );
  return items.slice(0, 20);
}
export async function bikeRideStats(
  q: Queryable,
  ids: string[],
  viewer: string | null = null,
) {
  return (
    await q.query<{ bike_id: string; count: number; distance: string }>(
      `SELECT r.bike_id,count(*)::int AS count,coalesce(sum(r.distance_m) FILTER(WHERE r.status='completed'),0)::bigint AS distance${rideFrom} WHERE r.status='completed' AND r.bike_id=ANY($1::uuid[]) AND ((${effectiveRide}) OR (r.owner_id=$2 AND NOT u.blocked)) GROUP BY r.bike_id`,
      [ids, viewer],
    )
  ).rows;
}
/** CPU-bound parsing of an upload, done before the transaction opens so the
connection is not held while a large track is decoded. */
export function previewParse(bytes: Uint8Array, config: RideSettings) {
  return parseTrack(bytes, {
    maxBytes: config.maxGpxBytes,
    maxPoints: config.maxPoints,
  });
}
export async function previewRide(
  q: Queryable,
  owner: string,
  bytes: Uint8Array,
  config: RideSettings,
  { planned = false, parsed = previewParse(bytes, config) } = {},
) {
  // #248: no global storage cleanup here. Only this owner's expired previews
  // go (their files join the GC queue), so they never hold the quota.
  const id = randomUUID();
  await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
    [owner],
  );
  await q.query(
    "DELETE FROM ride_previews WHERE owner_id=$1 AND expires_at<now()",
    [owner],
  );
  if (
    (
      await q.query<{ n: number }>(
        "SELECT count(*)::int n FROM ride_previews WHERE owner_id=$1 AND expires_at>=now()",
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
    metrics: { ...parsed.sensors, ...parsed.metrics },
    geometry: publicGeometry(parsed.geometry),
    expiresIn: 1800,
  };
}
export async function lockOwnedBike(
  q: Queryable,
  owner: string,
  bike: string | null,
  isPublic: boolean,
  { editing = false } = {},
) {
  const u = (
    await q.query<{ id: string }>(
      "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [owner],
    )
  ).rows[0];
  if (!u) throw new RideError("Пользователь недоступен", 404);
  const b = (
    await q.query<DatabaseRowsTypes.BikeRow>(
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

async function currentOccurrence(q: RepositoryTypes.Queryable, id: string) {
  return (
    await q.query<{ occurs_at: Date | null }>(
      `SELECT ${rideOccurrence} AS occurs_at FROM rides r WHERE r.id=$1`,
      [id],
    )
  ).rows[0]?.occurs_at;
}
/** After an owner edit of a locked plan (#235): a substantial change of the
start, meeting place or route starts a new edition of the agreement.
Answers of the current date follow it to its new start and then ask for a
new confirmation; answers of past or other dates are not touched. A typo
fix, a new title or format keeps every answer. */
async function reviseAgreement(
  q: RepositoryTypes.Queryable,
  existing: RideRow,
  before: string | Date | null | undefined,
) {
  const now = (
    await q.query<{
      meeting_point: string;
      plan_passport: RideMatchCoreTypes.Passport;
      has_track: boolean;
      occurs_at: Date | null;
    }>(
      `SELECT r.meeting_point,r.plan_passport,r.has_track,${rideOccurrence} AS occurs_at FROM rides r WHERE r.id=$1`,
      [existing.id],
    )
  ).rows[0];
  const changes = agreementChanges(
    {
      occursAt: before,
      meetingPoint: existing.meeting_point,
      area: existing.plan_passport?.area,
      hasTrack: existing.has_track,
    },
    {
      occursAt: now.occurs_at,
      meetingPoint: now.meeting_point,
      area: now.plan_passport?.area,
      hasTrack: now.has_track,
    },
  );
  if (!changes.length) return changes;
  await invalidateRideNotices(q, existing.id);
  if (changes.includes("start")) {
    // A leftover answer at the new time (from before #235) gives way to the
    // answer of the date that moved.
    await q.query(
      "DELETE FROM ride_rsvps n USING ride_rsvps o WHERE n.ride_id=$1 AND n.occurs_at=$3 AND o.ride_id=$1 AND o.occurs_at=$2 AND o.user_id=n.user_id",
      [existing.id, before, now.occurs_at],
    );
    await q.query(
      "UPDATE ride_rsvps SET occurs_at=$3 WHERE ride_id=$1 AND occurs_at=$2",
      [existing.id, before, now.occurs_at],
    );
    await q.query(
      "UPDATE rides SET recruitment_closed_for=$3 WHERE id=$1 AND recruitment_closed_for=$2",
      [existing.id, before, now.occurs_at],
    );
  }
  await q.query(
    "UPDATE rides SET agreement_revision=agreement_revision+1,agreement_changes=$2,agreement_changed_at=now(),updated_at=now() WHERE id=$1",
    [existing.id, changes],
  );
  await rideNotice(q, existing.id, "ride_changed", { occursAt: now.occurs_at });
  return changes;
}

export async function saveRide(
  q: Queryable,
  owner: string,
  input: RideEdit & { previewId?: string },
  config: RideSettings,
  id: string | null = null,
  { planned = false } = {},
) {
  if (!config.privacyRadii.includes(input.privacyRadiusM))
    throw new RideError("Недопустимый радиус приватности");
  const bike = await lockOwnedBike(q, owner, input.bikeId, input.isPublic, {
    editing: !!id,
  });
  let bytes, existing;
  if (id) {
    existing = (
      await q.query<DatabaseRowsTypes.RideRow>(
        "SELECT * FROM rides WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, owner],
      )
    ).rows[0];
    if (!existing) throw new RideError("Покатушка недоступна", 404);
    const blocked = rideBikeStateError(bike, existing, input.isPublic);
    if (blocked) throw new RideError(blocked, 409);
    if (
      existing.source_kind !== "planned" &&
      (input.passport !== undefined ||
        input.meetingVisibility !== undefined ||
        input.expectedEndAt !== undefined)
    )
      throw new RideError("Паспорт доступен только плановой поездке");
    if (existing.status !== "completed") {
      const details = plannedDetails(input, existing);
      input = {
        ...input,
        privacyEnabled:
          input.privacyEnabled || details.meetingVisibility === "participants",
      };
      if (
        input.scheduledAt &&
        new Date(input.scheduledAt) <= new Date() &&
        (input.recurrence ?? existing.recurrence) !== "weekly"
      )
        throw new RideError("Выберите будущую дату");
      const before = await currentOccurrence(q, id);
      await q.query(
        "UPDATE rides SET started_at=coalesce($2::timestamptz,started_at),features=coalesce($3::text[],features),meeting_point=coalesce($4,meeting_point),recurrence=coalesce($5,recurrence),recurrence_timezone=coalesce($6,recurrence_timezone),plan_passport=$7,meeting_visibility=$8,plan_ends_at=$9 WHERE id=$1",
        [
          id,
          input.scheduledAt || null,
          input.features || null,
          input.meetingPoint ?? null,
          input.recurrence ?? null,
          input.recurrenceTimezone ?? null,
          JSON.stringify(details.passport),
          details.meetingVisibility,
          details.expectedEndAt,
        ],
      );
      if (existing.status === "planned")
        await reviseAgreement(q, existing, before);
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
    bytes = await getOriginal(existing.track_file_id || id);
  } else {
    if (
      (
        await q.query<{ n: number }>(
          "SELECT count(*)::int n FROM rides WHERE owner_id=$1",
          [owner],
        )
      ).rows[0].n >= config.maxRides
    )
      throw new RideError("Достигнут лимит покатушек", 409);
    const preview = (
      await q.query<{ id: string }>(
        "SELECT id FROM ride_previews WHERE id=$1 AND owner_id=$2 AND expires_at>now() FOR UPDATE",
        [input.previewId, owner],
      )
    ).rows[0];
    if (!preview)
      throw new RideError(
        "Предпросмотр истёк или недоступен. Загрузите файл ещё раз.",
        404,
      );
    // The owner-bound preview row above must exist before reading its file.
    bytes = await getOriginal(input.previewId!, "preview");
  }
  const parsed = parseTrack(bytes),
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
  // Sensors of a FIT or TCX track; Garmin CSV rides keep their own metrics.
  await q.query(
    "UPDATE rides SET gpx_hash=CASE WHEN source_kind='planned' THEN NULL ELSE coalesce(gpx_hash,$2) END,visible_metrics=coalesce($3::jsonb,visible_metrics),import_metrics=CASE WHEN source_kind='gpx' THEN $4::jsonb ELSE import_metrics END WHERE id=$1",
    [
      rideId,
      planned ? null : parsed.sourceHash,
      input.visibleMetrics ? JSON.stringify(input.visibleMetrics) : null,
      JSON.stringify(parsed.sensors),
    ],
  );
  if (!id)
    await q.query("DELETE FROM ride_previews WHERE id=$1", [input.previewId]);
  if (!planned && (!existing || existing.status === "completed"))
    await storeRideAnalysis(
      q,
      rideId,
      parsed,
      input.privacyEnabled,
      input.privacyRadiusM,
    );
  return { id: rideId, shareId };
}
export async function refreshRideAnalysis(
  q: Queryable,
  owner: string,
  id: string,
  config: RideSettings,
) {
  await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
    [owner],
  );
  const row = (
    await q.query<DatabaseRowsTypes.RideRow>(
      "SELECT r.* FROM rides r JOIN users u ON u.id=r.owner_id WHERE r.id=$1 AND r.owner_id=$2 AND NOT u.blocked FOR UPDATE OF r",
      [id, owner],
    )
  ).rows[0];
  if (!row) throw new RideError("Покатушка недоступна", 404);
  if (!row.has_track || row.status !== "completed")
    throw new RideError("Для анализа нужен трек завершённой поездки");
  const parsed = parseTrack(await getOriginal(row.track_file_id || row.id), {
    maxBytes: config.maxGpxBytes,
    maxPoints: config.maxPoints,
  });
  await storeRideAnalysis(
    q,
    id,
    parsed,
    row.privacy_enabled,
    row.privacy_radius_m,
  );
  return { ok: true };
}
export async function deleteRide(q: Queryable, owner: string, id: string) {
  await q.query<{ id: string }>("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
    owner,
  ]);
  const r = await q.query<{ file_id: string }>(
    "DELETE FROM rides WHERE id=$1 AND owner_id=$2 RETURNING coalesce(track_file_id,id) file_id",
    [id, owner],
  );
  if (!r.rowCount) throw new RideError("Покатушка недоступна", 404);
  // The released file key lets the caller remove just this file (#248).
  return { ok: true, fileId: r.rows[0].file_id };
}

// External import uses the same parser, geometry, sensors, ownership locks and
// limits as uploads. Updates preserve the owner's publication and display choices.
// Immutable file keys make a failed transaction safe: the previous file remains.
export async function importActivityRide(
  q: Queryable,
  owner: string,
  activity: ExternalActivityRow,
  bikeId: string | null,
  bytes: Uint8Array | null,
  summary: ActivitySummary,
  config: RideSettings,
) {
  if (!config.enabled)
    throw new RideError("Импорт покатушек временно выключен", 403);
  const prior = activity.ride_id
    ? (
        await q.query<DatabaseRowsTypes.RideRow>(
          "SELECT * FROM rides WHERE id=$1 AND owner_id=$2",
          [activity.ride_id, owner],
        )
      ).rows[0]
    : null;
  await lockOwnedBike(q, owner, prior?.bike_id || bikeId, false, {
    editing: !!prior,
  });
  if (prior)
    await q.query<{ id: string }>(
      "SELECT id FROM rides WHERE id=$1 FOR UPDATE",
      [prior.id],
    );
  const parsed = bytes
    ? parseTrack(bytes, {
        maxBytes: config.maxGpxBytes,
        maxPoints: config.maxPoints,
      })
    : null;
  const duplicate = parsed
    ? (
        await q.query<{ id: string }>(
          "SELECT id FROM rides WHERE owner_id=$1 AND gpx_hash=$2 AND id<>$3",
          [owner, parsed.sourceHash, prior?.id || activity.id],
        )
      ).rows[0]
    : null;
  if (duplicate) return { duplicate: true };
  if (
    !prior &&
    (
      await q.query<{ n: number }>(
        "SELECT count(*)::int n FROM rides WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].n >= config.maxRides
  )
    throw new RideError("Достигнут лимит покатушек", 409);
  const id = prior?.id || randomUUID(),
    share = prior?.share_id || randomUUID(),
    fileId = bytes ? randomUUID() : null,
    privacy = prior?.privacy_enabled || false,
    radius = prior?.privacy_radius_m || config.defaultRadius,
    geometry = parsed ? publicGeometry(parsed.geometry, privacy, radius) : [],
    m = { ...summary.metrics, ...parsed?.sensors, ...parsed?.metrics },
    started = m.startedAt || summary.startedAt,
    title =
      prior && prior.title !== activity.metadata?.name
        ? prior.title
        : summary.name;
  // Replayed snapshots must not spend the upload budget or rewrite files.
  if (
    prior &&
    prior.has_track === !!bytes &&
    prior.gpx_hash === (parsed?.sourceHash || null) &&
    prior.title === title &&
    +new Date(prior.started_at ?? 0) === +new Date(started ?? 0) &&
    Object.keys(prior.import_metrics).length === Object.keys(m).length &&
    Object.entries(m).every(
      ([key, value]) => prior.import_metrics[key] === value,
    )
  ) {
    if (
      parsed &&
      !(
        await q.query(
          "SELECT 1 FROM ride_analysis WHERE ride_id=$1 AND version=$2 AND source_hash=$3 AND privacy_enabled=$4 AND privacy_radius_m=$5",
          [id, ANALYSIS_VERSION, parsed.sourceHash, privacy, radius],
        )
      ).rows.length
    )
      await storeRideAnalysis(q, id, parsed, privacy, radius);
    return { id };
  }
  const budget = (
    await q.query<{ count: number }>(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.expires_at END RETURNING count`,
      ["ride-upload:" + owner],
    )
  ).rows[0].count;
  if (budget > config.uploadRate)
    throw new RideError("Лимит импорта: повторим позже", 429);
  if (bytes) await putOriginal(fileId!, bytes);
  if (prior?.has_track)
    await q.query(
      "INSERT INTO ride_file_gc(id,kind) VALUES($1,'ride') ON CONFLICT DO NOTHING",
      [prior.track_file_id || id],
    );
  await q.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,started_at,ended_at,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_enabled,privacy_radius_m,source_hash,source_kind,has_track,gpx_hash,public_speed_profile,import_metrics,visible_metrics,track_file_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'external',$21,$22,$23,$24,$25,$26)
    ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,distance_m=EXCLUDED.distance_m,elapsed_time_s=EXCLUDED.elapsed_time_s,moving_time_s=EXCLUDED.moving_time_s,avg_speed_mps=EXCLUDED.avg_speed_mps,elevation_gain_m=EXCLUDED.elevation_gain_m,point_count=EXCLUDED.point_count,public_point_count=EXCLUDED.public_point_count,public_geometry=EXCLUDED.public_geometry,has_track=EXCLUDED.has_track,gpx_hash=EXCLUDED.gpx_hash,public_speed_profile=EXCLUDED.public_speed_profile,import_metrics=EXCLUDED.import_metrics,track_file_id=EXCLUDED.track_file_id,updated_at=now()`,
    [
      id,
      share,
      owner,
      prior?.bike_id || bikeId,
      title,
      prior?.description || "",
      started,
      m.endedAt || null,
      Math.round(m.distanceM || 0),
      m.elapsedTimeS == null ? null : Math.round(m.elapsedTimeS),
      m.movingTimeS == null ? null : Math.round(m.movingTimeS),
      m.avgSpeedMps ?? null,
      m.elevationGainM ?? null,
      m.pointCount || 0,
      geometry.reduce((n, s) => n + s.length, 0),
      JSON.stringify(geometry),
      prior?.is_public || false,
      privacy,
      radius,
      prior?.source_hash || "external:" + activity.id,
      !!bytes,
      parsed?.sourceHash || null,
      JSON.stringify(
        parsed ? speedProfile(parsed.samples, privacy, radius) : [],
      ),
      JSON.stringify(m),
      JSON.stringify(prior?.visible_metrics || defaultRideFields),
      fileId,
    ],
  );
  if (parsed) await storeRideAnalysis(q, id, parsed, privacy, radius);
  else await q.query("DELETE FROM ride_analysis WHERE ride_id=$1", [id]);
  return { id };
}

export async function importGarmin(
  q: Queryable,
  owner: string,
  input: GarminImportInput,
  parsed: ReturnType<typeof parseGarminCsv>,
  config: RideSettings,
) {
  await lockOwnedBike(q, owner, input.bikeId, input.isPublic);
  const selected = new Set(input.selected),
    rows = parsed.rides.filter((r) => selected.has(r.index));
  if (rows.length !== selected.size)
    throw new RideError("Выберите строки из предпросмотра");
  const count = (
    await q.query<{ n: number }>(
      "SELECT count(*)::int n FROM rides WHERE owner_id=$1",
      [owner],
    )
  ).rows[0].n;
  const known = new Set(
    (
      await q.query<{ source_hash: string }>(
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
async function inviteRiders(
  q: Queryable,
  ride: { id: string },
  owner: string,
  usernames: string[],
) {
  const names = [...new Set(usernames)];
  const users = (
    await q.query<{ id: string; username: string }>(
      "SELECT id,username FROM users WHERE username=ANY($1::text[]) AND NOT blocked",
      [names],
    )
  ).rows;
  const missing = names.filter((n) => !users.some((u) => u.username === n));
  if (missing.length)
    throw new RideError("Пользователи не найдены: " + missing.join(", "));
  const ids = users.filter((u) => u.id !== owner).map((u) => u.id);
  const revoked = (
    await q.query<{ user_id: string }>(
      "DELETE FROM ride_invitations WHERE ride_id=$1 AND NOT(user_id=ANY($2::uuid[])) RETURNING user_id",
      [ride.id, ids],
    )
  ).rows.map((r) => r.user_id);
  // A revoked invitation ends that person's participation in the dates ahead
  // (#235): the hidden meeting place closes, counts drop. Past answers stay.
  if (revoked.length) {
    await invalidateRideNotices(q, ride.id, { recipients: revoked });
    await q.query(
      "DELETE FROM ride_rsvps WHERE ride_id=$1 AND user_id=ANY($2::uuid[]) AND occurs_at>now()",
      [ride.id, revoked],
    );
  }
  for (const user of users) {
    if (user.id === owner) continue;
    const inserted = await q.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",
      [ride.id, user.id],
    );
    if (inserted.rowCount)
      await rideNotice(q, ride.id, "ride_invite", { recipients: [user.id] });
  }
}

export async function planRide(
  q: Queryable,
  owner: string,
  input: PlanInput,
  config: RideSettings,
) {
  const details = plannedDetails(input);
  input = {
    ...input,
    privacyEnabled:
      input.privacyEnabled || details.meetingVisibility === "participants",
  };
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
        await q.query<{ n: number }>(
          "SELECT count(*)::int n FROM rides WHERE owner_id=$1",
          [owner],
        )
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
    `UPDATE rides SET status='planned',source_kind='planned',started_at=$2,ended_at=NULL,moving_time_s=NULL,elapsed_time_s=NULL,avg_speed_mps=NULL,public_speed_profile='[]',features=$3,meeting_point=$4,recurrence=$5,recurrence_timezone=$6,plan_passport=$7,meeting_visibility=$8,plan_ends_at=$9,proposed_from_interest=$10 WHERE id=$1`,
    [
      result.id,
      input.scheduledAt,
      input.features || [],
      input.meetingPoint || "",
      input.recurrence || "none",
      input.recurrenceTimezone || "Europe/Moscow",
      JSON.stringify(details.passport),
      details.meetingVisibility,
      details.expectedEndAt,
      !!input.fromInterest,
    ],
  );
  await inviteRiders(q, { id: result.id }, owner, input.invitations || []);
  return result;
}
export async function attachRideTrack(
  q: Queryable,
  owner: string,
  id: string,
  bytes: Uint8Array,
  config: RideSettings,
) {
  const prior = (
    await q.query<{ bike_id: string; is_public: boolean }>(
      "SELECT bike_id,is_public FROM rides WHERE id=$1 AND owner_id=$2",
      [id, owner],
    )
  ).rows[0];
  if (!prior) throw new RideError("Покатушка недоступна", 404);
  const bike = await lockOwnedBike(q, owner, prior.bike_id, prior.is_public, {
    editing: true,
  });
  const ride = (
    await q.query<DatabaseRowsTypes.RideRow>(
      "SELECT * FROM rides WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [id, owner],
    )
  ).rows[0];
  if (!ride) throw new RideError("Покатушка недоступна", 404);
  if (ride.bike_id !== prior.bike_id)
    throw new RideError(
      "Велосипед покатушки изменился. Обновите страницу.",
      409,
    );
  const blocked = rideBikeStateError(bike, ride, ride.is_public);
  if (blocked) throw new RideError(blocked, 409);
  if (ride.has_track)
    throw new RideError("У этой покатушки уже есть трек", 409);
  const parsed = parseTrack(bytes, {
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
    throw new RideError("Этот трек уже привязан к другой покатушке", 409);
  const geometry = publicGeometry(
    parsed.geometry,
    ride.privacy_enabled,
    ride.privacy_radius_m,
  );
  await putOriginal(id, bytes);
  const before =
    ride.status === "planned" ? await currentOccurrence(q, id) : null;
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
  // A route added to a plan is a new edition of its agreement (#235).
  if (ride.status === "planned") await reviseAgreement(q, ride, before);
  if (ride.status === "completed")
    await storeRideAnalysis(
      q,
      id,
      parsed,
      ride.privacy_enabled,
      ride.privacy_radius_m,
    );
  return { ok: true };
}
export async function respondRide(
  q: Queryable,
  id: string,
  user: string,
  response: "accepted" | "maybe" | "declined",
  occurrenceAt: string | null = null,
  invitationOnly = false,
) {
  // Match owner mutation lock order, and re-check visibility after locking.
  const initial = (
    await q.query<{ owner_id: string; bike_id: string }>(
      "SELECT owner_id,bike_id FROM rides WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!initial) throw new RideError("Покатушка недоступна", 404);
  const people = (
    await q.query<{ id: string; blocked: boolean }>(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([user, initial.owner_id])]],
    )
  ).rows;
  if (people.some((p) => p.blocked) || !people.some((p) => p.id === user))
    throw new RideError("Пользователь недоступен", 404);
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    initial.bike_id,
  ]);
  const row = (
    await q.query<
      Pick<
        DatabaseRowsTypes.RideViewRow,
        | "id"
        | "owner_id"
        | "agreement_revision"
        | "occurs_at"
        | "recruitment_closed"
        | "invited"
      >
    >(
      `SELECT r.id,r.owner_id,r.agreement_revision,${rideOccurrence} AS occurs_at,
        coalesce(r.recruitment_closed_for=(${rideOccurrence}),false) AS recruitment_closed,
        EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$2) AS invited${rideFrom}
       WHERE r.id=$1 AND r.status='planned' AND NOT u.blocked AND (r.owner_id=$2 OR (${effectiveRide}) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$2)) FOR UPDATE OF r`,
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
  if (row.owner_id === user)
    throw new RideError("Организатор уже участвует в своей покатушке", 409);
  const previous = (
    await q.query<{
      response: "accepted" | "maybe" | "declined";
      revision: number;
    }>(
      "SELECT response,revision FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2 AND occurs_at=$3",
      [id, user, row.occurs_at],
    )
  ).rows[0];
  // A closed recruitment stops new people only (#235); leaving is always possible.
  if (
    response !== "declined" &&
    !mayJoin(
      participationState({
        invited: row.invited,
        response: previous?.response,
        revision: previous?.revision,
        agreementRevision: row.agreement_revision,
      }),
      { invited: row.invited, recruitmentClosed: row.recruitment_closed },
    )
  )
    throw new RideError(
      "Организатор закрыл набор на эту дату. Новые участники не принимаются.",
      409,
    );
  // The answer is given to the current edition of the conditions. The
  // invitation row stays an access grant; the answer lives here only.
  await q.query(
    "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ride_id,user_id,occurs_at) DO UPDATE SET response=EXCLUDED.response,revision=EXCLUDED.revision,updated_at=now()",
    [id, user, row.occurs_at, response, row.agreement_revision],
  );
  if (response !== "accepted")
    await invalidateRideNotices(q, id, {
      recipients: [user],
      remindersOnly: true,
    });
  else await scheduleRideReminders(q, new Date(), { ride: id, user });
  if (
    previous?.response !== response ||
    previous?.revision !== row.agreement_revision
  )
    await rideNotice(q, id, "ride_response", {
      recipients: [row.owner_id],
      occursAt: row.occurs_at,
    });
  const counts = (
    await q.query<{ state: string; n: number }>(
      `SELECT ${answerState} AS state,count(*)::int n FROM ride_rsvps v JOIN users u ON u.id=v.user_id JOIN rides r ON r.id=v.ride_id WHERE v.ride_id=$1 AND v.occurs_at=$2 AND NOT u.blocked GROUP BY 1`,
      [id, row.occurs_at],
    )
  ).rows;
  return {
    response,
    rsvp: response,
    previousRsvp: null,
    participation: response,
    rsvpCounts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
    scheduledAt: row.occurs_at,
    reminder: await rideReminderStatus(q, id, user),
  };
}
export async function respondRideInvitation(
  q: Queryable,
  id: string,
  user: string,
  response: "accepted" | "maybe" | "declined",
) {
  return respondRide(q, id, user, response, null, true);
}
/** The current date of an own plan, locked (users → bike → ride, like other
owner mutations). */
async function lockOwnPlan(
  q: RepositoryTypes.Queryable,
  id: string,
  owner: string,
) {
  await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
    [owner],
  );
  const initial = (
    await q.query<{ bike_id: string }>(
      "SELECT bike_id FROM rides WHERE id=$1 AND owner_id=$2",
      [id, owner],
    )
  ).rows[0];
  if (!initial) throw new RideError("Покатушка недоступна", 404);
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    initial.bike_id,
  ]);
  const row = (
    await q.query<{
      id: string;
      recurrence: string;
      recurrence_timezone: string;
      recruitment_closed_for: Date | null;
      occurs_at: Date | null;
    }>(
      `SELECT r.id,r.recurrence,r.recurrence_timezone,r.recruitment_closed_for,${rideOccurrence} AS occurs_at
       FROM rides r JOIN users u ON u.id=r.owner_id
       WHERE r.id=$1 AND r.owner_id=$2 AND r.status='planned' AND NOT u.blocked FOR UPDATE OF r`,
      [id, owner],
    )
  ).rows[0];
  if (!row || !row.occurs_at || new Date(row.occurs_at) <= new Date())
    throw new RideError("Покатушка недоступна или уже прошла", 404);
  // The availability guard above proves the current date is present.
  return row as typeof row & { occurs_at: Date };
}
/** Cancel a whole plan or series, or, with `occurrenceAt` of a weekly
series, only that date (#235): the other dates and their answers stay. */
export async function cancelPlannedRide(
  q: RepositoryTypes.Queryable,
  id: string,
  owner: string,
  occurrenceAt: string | null = null,
) {
  if (!occurrenceAt) {
    await q.query<{ id: string }>(
      "SELECT id FROM users WHERE id=$1 FOR UPDATE",
      [owner],
    );
    const before = (
      await q.query<{ occurs_at: Date | null }>(
        `SELECT ${rideOccurrence} occurs_at FROM rides r WHERE r.id=$1 AND r.owner_id=$2 AND r.status='planned' FOR UPDATE`,
        [id, owner],
      )
    ).rows[0];
    if (!before) throw new RideError("Покатушка недоступна", 404);
    await invalidateRideNotices(q, id);
    const r = await q.query<{ id: string }>(
      "UPDATE rides SET status='cancelled',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='planned' RETURNING id",
      [id, owner],
    );
    if (!r.rowCount) throw new RideError("Покатушка недоступна", 404);
    await rideNotice(q, id, "ride_cancelled", { occursAt: before.occurs_at });
    return { ok: true, scope: "ride" };
  }
  const row = await lockOwnPlan(q, id, owner);
  if (+new Date(occurrenceAt) !== +new Date(row.occurs_at))
    throw new RideError("Дата покатушки изменилась. Обновите страницу.", 409);
  if (row.recurrence !== "weekly") {
    await invalidateRideNotices(q, id);
    await q.query(
      "UPDATE rides SET status='cancelled',updated_at=now() WHERE id=$1",
      [id],
    );
    await rideNotice(q, id, "ride_cancelled", { occursAt: row.occurs_at });
    return { ok: true, scope: "ride" };
  }
  const ahead = (
    await q.query<{ n: number }>(
      "SELECT count(*)::int n FROM ride_cancelled_occurrences WHERE ride_id=$1 AND occurs_on>=(now() AT TIME ZONE $2)::date",
      [id, row.recurrence_timezone],
    )
  ).rows[0].n;
  if (ahead >= maxCancelledOccurrences)
    throw new RideError(
      "Слишком много отменённых дат подряд. Отмените серию целиком.",
      409,
    );
  await q.query(
    `INSERT INTO ride_cancelled_occurrences(ride_id,occurs_on,occurs_at)
     VALUES($1,($2::timestamptz AT TIME ZONE $3)::date,$2) ON CONFLICT DO NOTHING`,
    [id, row.occurs_at, row.recurrence_timezone],
  );
  await invalidateRideNotices(q, id, { occursAt: row.occurs_at });
  await rideNotice(q, id, "ride_cancelled", { occursAt: row.occurs_at });
  await q.query("UPDATE rides SET updated_at=now() WHERE id=$1", [id]);
  return { ok: true, scope: "occurrence", occurrenceAt: row.occurs_at };
}
/** Stop or resume new sign-ups for the current date (#235). Answers already
given stay; the desired group size is never a quota. */
export async function setRideRecruitment(
  q: RepositoryTypes.Queryable,
  id: string,
  owner: string,
  open: boolean,
  occurrenceAt: string,
) {
  const row = await lockOwnPlan(q, id, owner);
  if (+new Date(occurrenceAt) !== +new Date(row.occurs_at))
    throw new RideError("Дата покатушки изменилась. Обновите страницу.", 409);
  await q.query(
    "UPDATE rides SET recruitment_closed_for=$2,updated_at=now() WHERE id=$1",
    [id, open ? null : row.occurs_at],
  );
  return { ok: true, recruitmentClosed: !open, scheduledAt: row.occurs_at };
}
