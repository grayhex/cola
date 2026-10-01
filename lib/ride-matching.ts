import type * as RepositoryTypes from "./repository.ts";
import type * as RideMatchCoreTypes from "./ride-match-core.ts";
import type * as ZodTypes from "zod";
import type * as RideMatchInputTypes from "./ride-match-input.ts";
import { publicAuthor } from "./profile-dto.ts";
import { rideNotice } from "./ride-notifications.ts";
import { plannedEnd } from "./ride-plan.ts";
import { rideOccurrence } from "./rides.ts";
import {
  evaluate,
  explain,
  compareMatches,
  planDuration,
  groupSlots,
  normalizeLabel,
} from "./ride-match-core.ts";
import { matchLimits, explicitConditions } from "./ride-match-input.ts";

// Server side of #232: every candidate set is bounded by time, visibility and a
// row cap in SQL; ranking and explanations come from the pure core module.

export type Queryable = RepositoryTypes.Queryable;
export type Want = RideMatchCoreTypes.Want;
export type Passport = RideMatchCoreTypes.Passport;
export type Evaluation = RideMatchCoreTypes.Evaluation;
export type RiderQuery = ZodTypes.infer<typeof RideMatchInputTypes.riderQuery>;
export type DraftQuery = ZodTypes.infer<typeof RideMatchInputTypes.draftQuery>;
export type PlanQuery = ZodTypes.infer<typeof RideMatchInputTypes.planQuery>;
export type GroupsQuery = ZodTypes.infer<
  typeof RideMatchInputTypes.groupsQuery
>;
export type InterestInvitationsInput = ZodTypes.infer<
  typeof RideMatchInputTypes.interestInvitationsInput
>;

export class MatchError extends Error {
  declare status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.status = status;
  }
}
const day = 86400000;

async function requireActive(q: Queryable, viewerId: string) {
  const r = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM users WHERE id=$1 AND NOT blocked",
    [viewerId],
  );
  if (!r.rows.length) throw new MatchError("Войдите в аккаунт", 401);
}

function paging(total: number, page: number) {
  return {
    total,
    page,
    // Never report pages the query contract would reject.
    pages: Math.min(
      matchLimits.maxPages,
      Math.max(1, Math.ceil(total / matchLimits.pageSize)),
    ),
  };
}
/** @template T @param {T[]} items @param {number} page */
const pageOf = <T>(items: T[], page: number) =>
  items.slice((page - 1) * matchLimits.pageSize, page * matchLimits.pageSize);

function futureInstant(value: string | undefined, now: number) {
  if (!value) return null;
  const at = Date.parse(value);
  if (at <= now || at > now + matchLimits.horizonDays * day)
    throw new MatchError("Выберите время в пределах ближайших 90 дней", 400);
  return at;
}

function explicitWindow(
  from: string | undefined,
  to: string | undefined,
  now: number,
) {
  if (!from || !to) return null;
  const start = Date.parse(from),
    end = Date.parse(to);
  if (end <= now || end > now + matchLimits.horizonDays * day || end <= start)
    throw new MatchError(
      "Период поиска должен заканчиваться в пределах ближайших 90 дней",
      400,
    );
  return { start: Math.max(start, now), end };
}

// Concrete occurrences of visible plans, weekly series expanded in their own
// zone exactly like RSVP occurrences (calendar weeks, DST-safe).
export const planOccurrences = `CROSS JOIN LATERAL (
  SELECT ((r.started_at AT TIME ZONE r.recurrence_timezone) + k * interval '7 days') AT TIME ZONE r.recurrence_timezone AS occurs_at
  FROM generate_series(
    CASE WHEN r.recurrence='weekly' THEN greatest(0, floor(extract(epoch FROM ($2::timestamptz - r.started_at))/604800)::int - 1) ELSE 0 END,
    CASE WHEN r.recurrence='weekly' THEN greatest(0, ceil(extract(epoch FROM ($3::timestamptz - r.started_at))/604800)::int + 1) ELSE 0 END) k
) o`;
const planned = `r.status='planned' AND r.source_kind='planned' AND NOT u.blocked
  AND ((r.recurrence='weekly' AND r.started_at < $3) OR (r.recurrence='none' AND r.started_at >= $2 AND r.started_at < $3))
  AND o.occurs_at > now() AND o.occurs_at >= $2 AND o.occurs_at < $3
  AND NOT EXISTS(SELECT 1 FROM ride_cancelled_occurrences c WHERE c.ride_id=r.id AND c.occurs_on=(o.occurs_at AT TIME ZONE r.recurrence_timezone)::date)`;

/** Offer seen by the matcher; the meeting point is never loaded. */
function offerOf(row: {
  occurs_at: Date;
  plan_ends_at: Date | null;
  started_at: Date;
  plan_passport: Passport;
  has_track: boolean;
  distance_m: number;
}) {
  const start = +new Date(row.occurs_at),
    endIso = plannedEnd(row),
    passport = row.plan_passport || {};
  return {
    start,
    end: endIso ? Date.parse(endIso) : null,
    duration: planDuration({
      start,
      end: endIso ? Date.parse(endIso) : null,
      passport,
    }),
    passport,
    trackDistanceKm: row.has_track ? row.distance_m / 1000 : null,
  };
}

async function ownIntents(
  q: Queryable,
  viewerId: string,
  intentId = null as string | null,
) {
  const r = await q.query<{
    id: string;
    readiness: "ready" | "considering";
    passport: RideMatchCoreTypes.Passport;
    starts_at: Date;
    ends_at: Date;
  }>(
    `SELECT i.id,i.readiness,i.passport,w.starts_at,w.ends_at FROM ride_intents i
     JOIN ride_intent_windows w ON w.intent_id=i.id JOIN users u ON u.id=i.owner_id
     WHERE i.owner_id=$1 AND NOT u.blocked AND i.status='active' AND w.ends_at>now()
       AND ($2::uuid IS NULL OR i.id=$2) ORDER BY i.created_at,i.id,w.starts_at`,
    [viewerId, intentId],
  );

  const byId: Map<
    string,
    {
      intentId: string;
      readiness: string;
      passport: Passport;
      windows: { start: number; end: number }[];
    }
  > = new Map();
  for (const row of r.rows) {
    const item = byId.get(row.id) || {
      intentId: row.id,
      readiness: row.readiness,
      passport: row.passport,
      windows: [] as { start: number; end: number }[],
    };
    item.windows.push({
      start: +new Date(row.starts_at),
      end: +new Date(row.ends_at),
    });
    byId.set(row.id, item);
  }
  return [...byId.values()];
}

async function preferences(q: Queryable, viewerId: string): Promise<Passport> {
  const r = await q.query<{
    value: { passport?: RideMatchCoreTypes.Passport };
  }>("SELECT value FROM ride_intent_preferences WHERE owner_id=$1", [viewerId]);
  return r.rows[0]?.value?.passport || {};
}

/** Future plan occurrences for the viewer: own intents, explicit filters or
saved preferences. Explicit conditions override and become hard filters. */
export async function matchRides(
  q: Queryable,
  viewerId: string,
  query: RiderQuery,
  now = Date.now(),
) {
  await requireActive(q, viewerId);
  const explicit = explicitConditions(query);
  const window = explicitWindow(query.from, query.to, now);
  const base = {
    hard: explicit.hard,
    areaText: explicit.areaText,
    strict: query.strict === "1" || query.strict === "true",
  };

  let basis: string;

  let wants: (Want & { intentId: string | null })[];
  const intents = await ownIntents(q, viewerId, query.intent || null);
  if (query.intent && !intents.length)
    throw new MatchError("Намерение недоступно или истекло", 404);
  if (intents.length && (query.intent || !window)) {
    basis = query.intent ? "intent" : "intents";
    wants = intents.map((i) => ({
      ...base,
      intentId: i.intentId,
      windows: window ? [window] : i.windows,
      passport: { ...i.passport, ...explicit.passport },
    }));
  } else {
    const soft = await preferences(q, viewerId);
    // Nothing to match on: no intent, window, filter or saved preference.
    // An arbitrary list would be false personalization (#233).
    if (!window && !explicit.hard.length && !Object.keys(soft).length)
      return {
        basis: "none",
        horizon: null,
        items: [],
        ...paging(0, query.page),
        truncated: false,
      };
    basis = window ? "filters" : "preferences";
    wants = [
      {
        ...base,
        intentId: null,
        windows: window ? [window] : null,
        passport: { ...soft, ...explicit.passport },
      },
    ];
  }
  const windows = wants.flatMap((w) => w.windows || []);
  const timed = wants.every((w) => w.windows);
  const from = now,
    to = Math.min(
      now + matchLimits.horizonDays * day,
      timed
        ? Math.max(...windows.map((w) => w.end))
        : now + matchLimits.defaultRiderDays * day,
    );
  const rows = (
    await q.query<{
      id: string;
      share_id: string;
      title: string;
      owner_id: string;
      recurrence: string;
      plan_passport: RideMatchCoreTypes.Passport;
      has_track: boolean;
      distance_m: number;
      started_at: Date;
      plan_ends_at: Date | null;
      occurs_at: Date;
      next_at: Date | null;
      username: string;
      author_name: string;
      avatar_id: string | null;
      invited: boolean;
    }>(
      `SELECT r.id,r.share_id,r.title,r.owner_id,r.recurrence,r.plan_passport,r.has_track,r.distance_m,
        r.started_at,r.plan_ends_at,o.occurs_at,(${rideOccurrence}) AS next_at,
        u.username,u.name AS author_name,u.avatar_id,
        EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1) AS invited
       FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id ${planOccurrences}
       WHERE ${planned} AND r.owner_id<>$1
         AND ((r.is_public AND b.is_public) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=$1))
         AND ($4::timestamptz[] IS NULL OR EXISTS(SELECT 1 FROM unnest($4::timestamptz[],$5::timestamptz[]) w(s,e) WHERE o.occurs_at>=w.s AND o.occurs_at<w.e))
         AND NOT EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=$1 AND v.occurs_at=o.occurs_at)
       ORDER BY o.occurs_at,r.id LIMIT $6`,
      [
        viewerId,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        timed ? windows.map((w) => new Date(w.start).toISOString()) : null,
        timed ? windows.map((w) => new Date(w.end).toISOString()) : null,
        matchLimits.rideCandidates + 1,
      ],
    )
  ).rows;
  const truncated = rows.length > matchLimits.rideCandidates;
  const ranked = [];
  for (const row of rows.slice(0, matchLimits.rideCandidates)) {
    const offer = offerOf(row);
    const best = wants
      .map((want) => ({
        want,
        evaluation: evaluate(want, offer),
        start: offer.start,
        id: row.id,
      }))
      .sort(compareMatches)[0];
    if (best.evaluation.eligible) ranked.push({ ...best, row, offer });
  }
  ranked.sort(compareMatches);
  return {
    basis,
    horizon: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    items: pageOf(ranked, query.page).map(
      ({ row, offer, want, evaluation }) => ({
        ride: {
          id: row.id,
          shareId: row.share_id,
          title: row.title,
          recurrence: row.recurrence,
          passport: row.plan_passport || {},
          hasTrack: row.has_track,
          author: publicAuthor({
            id: row.owner_id,
            username: row.username,
            name: row.author_name,
            avatar_id: row.avatar_id,
          }),
        },
        occurrenceAt: new Date(offer.start).toISOString(),
        isNextOccurrence: +new Date(row.next_at ?? 0) === offer.start,
        expectedEndAt: offer.end ? new Date(offer.end).toISOString() : null,
        invited: row.invited,
        intentId: want.intentId,
        match: explain(evaluation),
      }),
    ),
    ...paging(ranked.length, query.page),
    truncated,
  };
}

/** Community intents with windows touching [from, to). Private, cancelled,
deleted and expired intents never enter the query, not even as counts.
`suggestable` keeps only people who allow suggestions (#234 workspace). */
async function communityWindows(
  q: Queryable,
  viewerId: string,
  from: number,
  to: number,
  rsvp: { rideId: string; occursAt: string } | null = null,
  suggestable = false,
) {
  const rows = (
    await q.query<{
      intent_id: string;
      owner_id: string;
      readiness: "ready" | "considering";
      passport: RideMatchCoreTypes.Passport;
      allow_suggestions: boolean;
      starts_at: Date;
      ends_at: Date;
      username: string;
      name: string;
      avatar_id: string | null;
    }>(
      `SELECT i.id AS intent_id,i.owner_id,i.readiness,i.passport,i.allow_suggestions,
        w.starts_at,w.ends_at,u.username,u.name,u.avatar_id
       FROM ride_intent_windows w JOIN ride_intents i ON i.id=w.intent_id JOIN users u ON u.id=i.owner_id
       WHERE w.starts_at<$3 AND w.ends_at>$2 AND w.ends_at>now()
         AND i.visibility='community' AND i.status='active' AND NOT u.blocked AND i.owner_id<>$1
         AND ($4::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=$4 AND v.user_id=i.owner_id AND v.occurs_at=$5 AND v.response IN ('accepted','maybe')))
         AND (NOT $7::boolean OR i.allow_suggestions)
       ORDER BY w.starts_at,w.intent_id LIMIT $6`,
      [
        viewerId,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        rsvp?.rideId || null,
        rsvp?.occursAt || null,
        matchLimits.intentWindows + 1,
        suggestable,
      ],
    )
  ).rows;
  return {
    rows: rows.slice(0, matchLimits.intentWindows),
    truncated: rows.length > matchLimits.intentWindows,
  };
}

type CommunityWindow = Awaited<
  ReturnType<typeof communityWindows>
>["rows"][number];
const person = (row: CommunityWindow) =>
  publicAuthor({
    id: row.owner_id,
    username: row.username,
    name: row.name,
    avatar_id: row.avatar_id,
  });

/** Unique people whose window fits this one occurrence. Counts include every
community intent; names only those who allow suggestions. `hard` lists the
organizer's format filters: a conflicting intent is not interest (#234). */
function occurrenceInterest(
  rows: CommunityWindow[],
  offer: RideMatchCoreTypes.Offer,
  page: number,
  invited: Set<string> = new Set(),
  declined: Set<string> = new Set(),
  hard: string[] = [],
) {
  const best: Map<
    string,
    { row: CommunityWindow; evaluation: Evaluation; start: number; id: string }
  > = new Map();

  const ready: Set<string> = new Set();
  for (const row of rows) {
    const evaluation = evaluate(
      {
        windows: [
          { start: +new Date(row.starts_at), end: +new Date(row.ends_at) },
        ],
        passport: row.passport,
        hard,
      },
      offer,
    );
    if (!evaluation.eligible) continue;
    if (row.readiness === "ready") ready.add(row.owner_id);
    const item = { row, evaluation, start: offer.start, id: row.intent_id };
    const old = best.get(row.owner_id);
    if (!old || compareMatches(item, old) < 0) best.set(row.owner_id, item);
  }
  const all = [...best.values()];
  const named = all
    .filter((x) => x.row.allow_suggestions)
    .sort(
      (a, b) =>
        compareMatches(a, b) || (a.row.owner_id < b.row.owner_id ? -1 : 1),
    );
  return {
    counts: {
      total: all.length,
      ready: ready.size,
      considering: all.length - ready.size,
      timeConfirmed: all.filter((x) => x.evaluation.time.status === "match")
        .length,
      area: areaCounts(all.map((x) => x.evaluation)),
    },
    people: {
      items: pageOf(named, page).map(({ row, evaluation }) => ({
        author: person(row),
        intentId: row.intent_id,
        readiness: ready.has(row.owner_id) ? "ready" : "considering",
        invited: invited.has(row.owner_id),
        declined: declined.has(row.owner_id),
        match: explain(evaluation),
      })),
      ...paging(named.length, page),
    },
    // Everyone who may be invited, for the server-side re-check (#234).
    suggestable: new Set(named.map((x) => x.row.owner_id)),
    formats: formatCounts(all.map((x) => x.row.passport)),
  };
}
/** How many people of a group want each purpose and pace: numbers only. */
function formatCounts(passports: Passport[]) {
  const out: { purpose: Record<string, number>; pace: Record<string, number> } =
    { purpose: {}, pace: {} };
  for (const p of passports)
    for (const key of ["purpose", "pace"] as const)
      if (p?.[key]) out[key][p[key]] = (out[key][p[key]] || 0) + 1;
  return out;
}

function areaCounts(evaluations: Evaluation[]) {
  const out = { match: 0, partial: 0, unknown: 0, conflict: 0 };
  for (const e of evaluations) {
    const area = e.reasons.find((r) => r.field === "area");
    out[area ? area.status : "unknown"]++;
  }
  return out;
}

/** Fields the saved plan states: an intent that explicitly contradicts one of
them is not a candidate for this plan (#234), an unstated one still is. */
function planFormat(passport: Passport) {
  const hard = ["duration"];
  for (const key of ["purpose", "pace", "surface", "difficulty"] as const)
    if (passport?.[key]) hard.push(key);
  if (passport?.distanceKm) hard.push("distance");
  if (passport?.area?.center) hard.push("area");
  return hard;
}
/** One future occurrence of an own plan and the people whose intent fits it.
Used both to show candidates and to re-check them before inviting. */
async function occurrenceCandidates(
  q: Queryable,
  viewerId: string,
  rideId: string,
  occurrenceAt: string | undefined,
  page: number,
  now: number,
) {
  await requireActive(q, viewerId);
  const from = now,
    to = now + matchLimits.horizonDays * day;
  const rows = (
    await q.query<{
      id: string;
      started_at: Date;
      plan_ends_at: Date | null;
      plan_passport: RideMatchCoreTypes.Passport;
      has_track: boolean;
      distance_m: number;
      occurs_at: Date;
    }>(
      `SELECT r.id,r.started_at,r.plan_ends_at,r.plan_passport,r.has_track,r.distance_m,o.occurs_at
       FROM rides r JOIN users u ON u.id=r.owner_id ${planOccurrences}
       WHERE r.id=$4 AND r.owner_id=$1 AND ${planned} ORDER BY o.occurs_at`,
      [
        viewerId,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        rideId,
      ],
    )
  ).rows;
  if (!rows.length)
    throw new MatchError("Покатушка недоступна или уже прошла", 404);
  const wanted = occurrenceAt ? Date.parse(occurrenceAt) : null;
  const row = wanted
    ? rows.find((r) => +new Date(r.occurs_at) === wanted)
    : rows[0];
  if (!row)
    throw new MatchError(
      "Такой даты у этой покатушки нет. Обновите страницу.",
      409,
    );
  const offer = offerOf(row),
    occursAt = new Date(offer.start).toISOString();
  const found = await communityWindows(
    q,
    viewerId,
    offer.start,
    offer.start + 1,
    {
      rideId,
      occursAt,
    },
  );
  // One read for both: who is invited, and who declined this date — someone
  // who said no is not asked again (#234). The answer lives in ride_rsvps
  // only (#235); the invitation is the access grant.
  const answers = (
    await q.query<{ user_id: string; invited: boolean; declined: boolean }>(
      `SELECT user_id,true AS invited,false AS declined FROM ride_invitations WHERE ride_id=$1
       UNION ALL SELECT user_id,false,true FROM ride_rsvps WHERE ride_id=$1 AND occurs_at=$2 AND response='declined'`,
      [rideId, occursAt],
    )
  ).rows;
  const invited = new Set(
      answers.filter((r) => r.invited).map((r) => r.user_id),
    ),
    declined = new Set(answers.filter((r) => r.declined).map((r) => r.user_id));
  return {
    offer,
    occursAt,
    invited,
    declined,
    truncated: found.truncated,
    interest: occurrenceInterest(
      found.rows,
      offer,
      page,
      invited,
      declined,
      planFormat(offer.passport),
    ),
  };
}

/** Organizer view of an own plan occurrence (#234 builds invitations on it). */
export async function planInterest(
  q: Queryable,
  viewerId: string,
  rideId: string,
  query: PlanQuery,
  now = Date.now(),
) {
  const found = await occurrenceCandidates(
    q,
    viewerId,
    rideId,
    query.occurrenceAt,
    query.page,
    now,
  );
  return {
    mode: "occurrence",
    occurrenceAt: found.occursAt,
    expectedEndAt: found.offer.end
      ? new Date(found.offer.end).toISOString()
      : null,
    duration: found.offer.duration,
    counts: found.interest.counts,
    people: found.interest.people,
    truncated: found.truncated,
  };
}

/** «Предложить покатушку» → invite (#234). Every requested person is checked
again on the server: an intent that became private, expired, was withdrawn,
no longer allows suggestions or no longer fits the chosen time is not
invited by the old list. Existing invitations and refusals are kept as they
are; the per-ride cap is the plan form's. */
export async function interestInvitationAvailable(
  q: Queryable,
  rideId: string,
  userId: string,
  occursAt: Date,
  now = new Date(),
) {
  const owner = (
    await q.query<{ owner_id: string }>(
      "SELECT owner_id FROM rides WHERE id=$1",
      [rideId],
    )
  ).rows[0];
  if (!owner) return false;
  try {
    const found = await occurrenceCandidates(
      q,
      owner.owner_id,
      rideId,
      occursAt.toISOString(),
      1,
      +now,
    );
    return (
      found.interest.suggestable.has(userId) && !found.declined.has(userId)
    );
  } catch (error) {
    if (error instanceof MatchError) return false;
    throw error;
  }
}
export async function inviteFromInterest(
  q: Queryable,
  viewerId: string,
  rideId: string,
  input: InterestInvitationsInput,
  now = Date.now(),
) {
  // Same lock order as other owner mutations (users → bike → ride), so an
  // account deletion running at the same time cannot deadlock with it. One
  // sender at a time per plan: a double click waits and then sees the first
  // request's invitations.
  const initial = (
    await q.query<{ bike_id: string }>(
      "SELECT bike_id FROM rides WHERE id=$1 AND owner_id=$2 AND status='planned'",
      [rideId, viewerId],
    )
  ).rows[0];
  if (!initial)
    throw new MatchError("Покатушка недоступна или уже прошла", 404);
  await q.query<{ id: string }>(
    "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [[...new Set([viewerId, ...input.userIds])]],
  );
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    initial.bike_id,
  ]);
  const locked = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM rides WHERE id=$1 AND owner_id=$2 AND status='planned' FOR UPDATE",
    [rideId, viewerId],
  );
  if (!locked.rows.length)
    throw new MatchError("Покатушка недоступна или уже прошла", 404);
  const found = await occurrenceCandidates(
    q,
    viewerId,
    rideId,
    input.occurrenceAt,
    1,
    now,
  );
  let total = found.invited.size;

  const results: {
    userId: string;
    status:
      "invited" | "already_invited" | "declined" | "unavailable" | "limit";
  }[] = [];
  for (const userId of [...new Set(input.userIds)]) {
    if (found.invited.has(userId)) {
      results.push({ userId, status: "already_invited" });
      continue;
    }
    if (found.declined.has(userId)) {
      results.push({ userId, status: "declined" });
      continue;
    }
    if (!found.interest.suggestable.has(userId)) {
      results.push({ userId, status: "unavailable" });
      continue;
    }
    if (total >= matchLimits.invitationsPerRide) {
      results.push({ userId, status: "limit" });
      continue;
    }
    const inserted = await q.query(
      "INSERT INTO ride_invitations(ride_id,user_id,source) VALUES($1,$2,'interest') ON CONFLICT DO NOTHING RETURNING 1",
      [rideId, userId],
    );
    if (!inserted.rows.length) {
      results.push({ userId, status: "already_invited" });
      continue;
    }
    total++;
    found.invited.add(userId);
    await rideNotice(q, rideId, "ride_invite", {
      recipients: [userId],
      occursAt: found.occursAt,
    });
    results.push({ userId, status: "invited" });
  }
  return {
    occurrenceAt: found.occursAt,
    invited: results.filter((r) => r.status === "invited").length,
    results,
  };
}

/** «Собрать компанию» (#234): common start windows of people who allow
suggestions and whose intent fits the organizer's format. Counts only — no
names, intents or windows of individual people. */
export async function interestGroups(
  q: Queryable,
  viewerId: string,
  query: GroupsQuery,
  now = Date.now(),
) {
  await requireActive(q, viewerId);
  const explicit = explicitConditions(query);

  const passport: Passport = {
    ...explicit.passport,
    ...(explicit.areaText ? { area: { label: explicit.areaText } } : {}),
  };
  const duration = passport.durationMinutes as { min: number; max: number };
  const window = explicitWindow(query.from, query.to, now) || {
    start: now,
    end: now + matchLimits.defaultSlotDays * day,
  };
  const found = await communityWindows(
    q,
    viewerId,
    window.start + duration.min * 60000 - 1,
    window.end + 1,
    null,
    true,
  );
  // A person whose intent conflicts with the chosen format is not interest
  // for it; an intent that does not state a field still is. A typed district
  // is looked up in the intent's own area label (roles are reversed here).
  const text = explicit.areaText ? normalizeLabel(explicit.areaText) : "";
  const compatible = found.rows.filter(
    (r) =>
      (!text || normalizeLabel(r.passport?.area?.label || "").includes(text)) &&
      evaluate(
        { windows: null, passport: r.passport, hard: explicit.hard },
        { start: window.start, duration, passport },
      ).eligible,
  );
  const slots = groupSlots(
    compatible.map((r) => ({
      userId: r.owner_id,
      intentId: r.intent_id,
      readiness: r.readiness,
      start: +new Date(r.starts_at),
      end: +new Date(r.ends_at),
    })),
    {
      duration,
      from: window.start,
      to: window.end,
      limit: matchLimits.groups,
    },
  );
  return {
    horizon: {
      from: new Date(window.start).toISOString(),
      to: new Date(window.end).toISOString(),
    },
    duration,
    groups: slots
      .map((slot) => {
        const members = new Set(slot.users);
        const interest = occurrenceInterest(
          compatible.filter((r) => members.has(r.owner_id)),
          { start: slot.startFrom, duration, passport },
          1,
          undefined,
          undefined,
          explicit.hard,
        );
        return {
          startFrom: new Date(slot.startFrom).toISOString(),
          startUntil: new Date(slot.startUntil).toISOString(),
          counts: {
            ...interest.counts,
            fitsMaxDuration: slot.fitsMaxDuration,
          },
          formats: interest.formats,
        };
      })
      .filter((g) => g.counts.total > 0)
      // Days read top to bottom; the matcher already chose the best slots.
      .sort((a, b) => Date.parse(a.startFrom) - Date.parse(b.startFrom)),
    truncated: found.truncated,
  };
}

/** Organizer draft before a plan exists: one start time, or the best common
slots inside a period for a required duration. */
export async function draftInterest(
  q: Queryable,
  viewerId: string,
  query: DraftQuery,
  now = Date.now(),
) {
  await requireActive(q, viewerId);
  const explicit = explicitConditions(query);

  const passport: Passport = {
    ...explicit.passport,
    ...(explicit.areaText ? { area: { label: explicit.areaText } } : {}),
  };
  const duration = passport.durationMinutes || null;
  const start = futureInstant(query.start, now);
  if (start) {
    const offer = { start, duration, passport };
    const found = await communityWindows(q, viewerId, start, start + 1);
    const interest = occurrenceInterest(found.rows, offer, query.page);
    return {
      mode: "occurrence",
      occurrenceAt: new Date(start).toISOString(),
      expectedEndAt: null,
      duration,
      counts: interest.counts,
      people: interest.people,
      truncated: found.truncated,
    };
  }
  if (!duration)
    throw new MatchError("Для поиска общего времени укажите длительность");
  const window = explicitWindow(query.from, query.to, now) || {
    start: now,
    end: now + matchLimits.defaultSlotDays * day,
  };
  const found = await communityWindows(
    q,
    viewerId,
    // A window can host a start in [from, to] only if it lasts until from + min.
    window.start + duration.min * 60000 - 1,
    window.end + 1,
  );
  const slots = groupSlots(
    found.rows.map((r) => ({
      userId: r.owner_id,
      intentId: r.intent_id,
      readiness: r.readiness,
      start: +new Date(r.starts_at),
      end: +new Date(r.ends_at),
    })),
    {
      duration,
      from: window.start,
      to: window.end,
      limit: matchLimits.slots,
    },
  );
  return {
    mode: "slots",
    horizon: {
      from: new Date(window.start).toISOString(),
      to: new Date(window.end).toISOString(),
    },
    duration,
    slots: slots.map((slot) => {
      const members = new Set(slot.users);
      const interest = occurrenceInterest(
        found.rows.filter((r) => members.has(r.owner_id)),
        { start: slot.startFrom, duration, passport },
        1,
      );
      return {
        startFrom: new Date(slot.startFrom).toISOString(),
        startUntil: new Date(slot.startUntil).toISOString(),
        counts: {
          ...interest.counts,
          fitsMaxDuration: slot.fitsMaxDuration,
        },
        people: interest.people.items.slice(0, matchLimits.slotPeople),
        peopleTotal: interest.people.total,
      };
    }),
    truncated: found.truncated,
  };
}
