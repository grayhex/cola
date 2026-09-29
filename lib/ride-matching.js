import { publicAuthor } from "./profile-dto.js";
import { plannedEnd } from "./ride-plan.js";
import { rideOccurrence } from "./rides.js";
import {
  evaluate,
  explain,
  compareMatches,
  planDuration,
  groupSlots,
} from "./ride-match-core.js";
import { matchLimits, explicitConditions } from "./ride-match-input.js";

// Server side of #232: every candidate set is bounded by time, visibility and a
// row cap in SQL; ranking and explanations come from the pure core module.

/** @typedef {import("./repository.js").Queryable} Queryable */
/** @typedef {import("./ride-match-core.js").Want} Want */
/** @typedef {import("./ride-match-core.js").Passport} Passport */
/** @typedef {import("./ride-match-core.js").Evaluation} Evaluation */
/** @typedef {import("zod").infer<typeof import("./ride-match-input.js").riderQuery>} RiderQuery */
/** @typedef {import("zod").infer<typeof import("./ride-match-input.js").draftQuery>} DraftQuery */
/** @typedef {import("zod").infer<typeof import("./ride-match-input.js").planQuery>} PlanQuery */

export class MatchError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const day = 86400000;
/** @param {Queryable} q @param {string} viewerId */
async function requireActive(q, viewerId) {
  const r = await q.query("SELECT 1 FROM users WHERE id=$1 AND NOT blocked", [
    viewerId,
  ]);
  if (!r.rows.length) throw new MatchError("Войдите в аккаунт", 401);
}
/** @param {number} total @param {number} page */
function paging(total, page) {
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
const pageOf = (items, page) =>
  items.slice((page - 1) * matchLimits.pageSize, page * matchLimits.pageSize);
/** @param {string|undefined} value @param {number} now */
function futureInstant(value, now) {
  if (!value) return null;
  const at = Date.parse(value);
  if (at <= now || at > now + matchLimits.horizonDays * day)
    throw new MatchError("Выберите время в пределах ближайших 90 дней", 400);
  return at;
}
/** @param {string|undefined} from @param {string|undefined} to @param {number} now */
function explicitWindow(from, to, now) {
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
  AND o.occurs_at > now() AND o.occurs_at >= $2 AND o.occurs_at < $3`;

/** Offer seen by the matcher; the meeting point is never loaded.
 * @param {any} row */
function offerOf(row) {
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

/** @param {Queryable} q @param {string} viewerId */
async function ownIntents(
  q,
  viewerId,
  intentId = /** @type {string|null} */ (null),
) {
  const r = await q.query(
    `SELECT i.id,i.readiness,i.passport,w.starts_at,w.ends_at FROM ride_intents i
     JOIN ride_intent_windows w ON w.intent_id=i.id JOIN users u ON u.id=i.owner_id
     WHERE i.owner_id=$1 AND NOT u.blocked AND i.status='active' AND w.ends_at>now()
       AND ($2::uuid IS NULL OR i.id=$2) ORDER BY i.created_at,i.id,w.starts_at`,
    [viewerId, intentId],
  );
  /** @type {Map<string, {intentId: string, readiness: string, passport: Passport, windows: {start: number, end: number}[]}>} */
  const byId = new Map();
  for (const row of r.rows) {
    const item = byId.get(row.id) || {
      intentId: row.id,
      readiness: row.readiness,
      passport: row.passport,
      windows: /** @type {{start: number, end: number}[]} */ ([]),
    };
    item.windows.push({
      start: +new Date(row.starts_at),
      end: +new Date(row.ends_at),
    });
    byId.set(row.id, item);
  }
  return [...byId.values()];
}
/** @param {Queryable} q @param {string} viewerId @returns {Promise<Passport>} */
async function preferences(q, viewerId) {
  const r = await q.query(
    "SELECT value FROM ride_intent_preferences WHERE owner_id=$1",
    [viewerId],
  );
  return r.rows[0]?.value?.passport || {};
}

/** Future plan occurrences for the viewer: own intents, explicit filters or
 * saved preferences. Explicit conditions override and become hard filters.
 * @param {Queryable} q @param {string} viewerId @param {RiderQuery} query */
export async function matchRides(q, viewerId, query, now = Date.now()) {
  await requireActive(q, viewerId);
  const explicit = explicitConditions(query);
  const window = explicitWindow(query.from, query.to, now);
  const base = {
    hard: explicit.hard,
    areaText: explicit.areaText,
    strict: query.strict === "1" || query.strict === "true",
  };
  /** @type {string} */
  let basis;
  /** @type {(Want & {intentId: string|null})[]} */
  let wants;
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
    await q.query(
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
        isNextOccurrence: +new Date(row.next_at) === offer.start,
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
 * deleted and expired intents never enter the query, not even as counts.
 * @param {Queryable} q @param {string} viewerId @param {number} from @param {number} to
 * @param {{rideId: string, occursAt: string}|null} rsvp people already answering this occurrence */
async function communityWindows(q, viewerId, from, to, rsvp = null) {
  const rows = (
    await q.query(
      `SELECT i.id AS intent_id,i.owner_id,i.readiness,i.passport,i.allow_suggestions,
        w.starts_at,w.ends_at,u.username,u.name,u.avatar_id
       FROM ride_intent_windows w JOIN ride_intents i ON i.id=w.intent_id JOIN users u ON u.id=i.owner_id
       WHERE w.starts_at<$3 AND w.ends_at>$2 AND w.ends_at>now()
         AND i.visibility='community' AND i.status='active' AND NOT u.blocked AND i.owner_id<>$1
         AND ($4::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=$4 AND v.user_id=i.owner_id AND v.occurs_at=$5 AND v.response IN ('accepted','maybe')))
       ORDER BY w.starts_at,w.intent_id LIMIT $6`,
      [
        viewerId,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        rsvp?.rideId || null,
        rsvp?.occursAt || null,
        matchLimits.intentWindows + 1,
      ],
    )
  ).rows;
  return {
    rows: rows.slice(0, matchLimits.intentWindows),
    truncated: rows.length > matchLimits.intentWindows,
  };
}
/** @param {any} row */
const person = (row) =>
  publicAuthor({
    id: row.owner_id,
    username: row.username,
    name: row.name,
    avatar_id: row.avatar_id,
  });

/** Unique people whose window fits this one occurrence. Counts include every
 * community intent; names only those who allow suggestions.
 * @param {any[]} rows @param {import("./ride-match-core.js").Offer} offer
 * @param {number} page @param {Set<string>} [invited] */
function occurrenceInterest(rows, offer, page, invited = new Set()) {
  /** @type {Map<string, {row: any, evaluation: Evaluation, start: number, id: string}>} */
  const best = new Map();
  /** @type {Set<string>} people with at least one fitting "ready" intent */
  const ready = new Set();
  for (const row of rows) {
    const evaluation = evaluate(
      {
        windows: [
          { start: +new Date(row.starts_at), end: +new Date(row.ends_at) },
        ],
        passport: row.passport,
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
        match: explain(evaluation),
      })),
      ...paging(named.length, page),
    },
  };
}
/** @param {Evaluation[]} evaluations */
function areaCounts(evaluations) {
  const out = { match: 0, partial: 0, unknown: 0, conflict: 0 };
  for (const e of evaluations) {
    const area = e.reasons.find((r) => r.field === "area");
    out[area ? area.status : "unknown"]++;
  }
  return out;
}

/** Organizer view of an own plan occurrence (#234 builds invitations on it).
 * @param {Queryable} q @param {string} viewerId @param {string} rideId @param {PlanQuery} query */
export async function planInterest(
  q,
  viewerId,
  rideId,
  query,
  now = Date.now(),
) {
  await requireActive(q, viewerId);
  const from = now,
    to = now + matchLimits.horizonDays * day;
  const rows = (
    await q.query(
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
  const wanted = query.occurrenceAt ? Date.parse(query.occurrenceAt) : null;
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
  const invited = new Set(
    (
      await q.query("SELECT user_id FROM ride_invitations WHERE ride_id=$1", [
        rideId,
      ])
    ).rows.map((r) => r.user_id),
  );
  return {
    mode: "occurrence",
    occurrenceAt: occursAt,
    expectedEndAt: offer.end ? new Date(offer.end).toISOString() : null,
    duration: offer.duration,
    ...occurrenceInterest(found.rows, offer, query.page, invited),
    truncated: found.truncated,
  };
}

/** Organizer draft before a plan exists: one start time, or the best common
 * slots inside a period for a required duration.
 * @param {Queryable} q @param {string} viewerId @param {DraftQuery} query */
export async function draftInterest(q, viewerId, query, now = Date.now()) {
  await requireActive(q, viewerId);
  const explicit = explicitConditions(query);
  /** @type {Passport} */
  const passport = {
    ...explicit.passport,
    ...(explicit.areaText ? { area: { label: explicit.areaText } } : {}),
  };
  const duration = passport.durationMinutes || null;
  const start = futureInstant(query.start, now);
  if (start) {
    const offer = { start, duration, passport };
    const found = await communityWindows(q, viewerId, start, start + 1);
    return {
      mode: "occurrence",
      occurrenceAt: new Date(start).toISOString(),
      expectedEndAt: null,
      duration,
      ...occurrenceInterest(found.rows, offer, query.page),
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
