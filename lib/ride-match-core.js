// Deterministic, explainable matching (#232). Pure functions: no DB, no clock
// reads, no private data beyond what the caller already may see. Times are
// epoch milliseconds, durations minutes. See docs/modules/rides.md.

/** @typedef {"match"|"partial"|"unknown"|"conflict"} MatchStatus */
/** @typedef {{field: string, status: MatchStatus, code: string}} MatchReason */
/** @typedef {{min: number, max: number}} Range */
/** @typedef {{start: number, end: number}} TimeWindow */
/** @typedef {{label?: string, center?: number[], radiusM?: number}} Area */
/** @typedef {{area?: Area, purpose?: string, pace?: string, surface?: string,
 * difficulty?: string, distanceKm?: Range, durationMinutes?: Range,
 * groupSize?: Range, speedKmh?: Range, beginnerFriendly?: boolean,
 * regroupPolicy?: string}} Passport */
/** What is being searched for: availability windows (null = not given) and wishes.
 * `hard` lists fields the viewer explicitly filtered by in this request.
 * @typedef {{windows: TimeWindow[]|null, passport: Passport, areaText?: string,
 * hard?: string[], strict?: boolean}} Want */
/** One concrete occurrence of a plan, as the matcher sees it.
 * @typedef {{start: number, duration: Range|null, passport: Passport,
 * trackDistanceKm?: number|null}} Offer */
/** `unfiltered` counts explicit filters whose value the offer does not state.
 * @typedef {{eligible: boolean, score: number, unfiltered: number,
 * time: MatchReason & {window?: TimeWindow}, reasons: MatchReason[], matched: string[], partial: string[], unknown: string[],
 * conflicts: string[]}} Evaluation */

/** Ranking weights. Time is also a hard constraint whenever windows exist. */
export const matchWeights = Object.freeze({
  time: 30,
  area: 20,
  duration: 10,
  distance: 10,
  pace: 10,
  purpose: 8,
  surface: 8,
  difficulty: 6,
  speed: 5,
  groupSize: 4,
  regroupPolicy: 3,
  beginnerFriendly: 3,
});
const factor = { match: 1, partial: 0.5, unknown: 0, conflict: -1 };
const ordinal = {
  pace: ["relaxed", "moderate", "sporty"],
  difficulty: ["easy", "intermediate", "technical"],
};

/** @param {string} field @param {MatchStatus} status @param {string} [code]
 * @returns {MatchReason} */
const reason = (field, status, code) => ({
  field,
  status,
  code: code || `${field}_${status}`,
});

/** Great-circle distance in metres between [lng, lat] points.
 * @param {number[]} a @param {number[]} b */
export function distanceM(a, b) {
  const rad = Math.PI / 180,
    dLat = (b[1] - a[1]) * rad,
    dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Labels are never compared with each other; only an explicit text filter is.
 * @param {string} text */
export function normalizeLabel(text) {
  return String(text || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Total planned duration with stops, from a fixed end or the passport range.
 * @param {{start: number, end?: number|null, passport?: Passport}} plan
 * @returns {Range|null} */
export function planDuration({ start, end, passport }) {
  if (end && end > start) {
    const minutes = Math.round((end - start) / 60000);
    return { min: minutes, max: minutes };
  }
  return passport?.durationMinutes || null;
}

/** Can the whole ride happen inside one availability window?
 * Windows do not overlap, so at most one contains the start.
 * @param {number} start @param {Range|null} duration @param {TimeWindow[]|null} windows
 * @returns {MatchReason & {window?: TimeWindow}} */
export function timeFit(start, duration, windows) {
  if (!windows) return reason("time", "unknown", "time_unspecified");
  const window = windows.find((w) => start >= w.start && start < w.end);
  if (!window) return reason("time", "conflict", "time_outside_window");
  if (!duration)
    return { ...reason("time", "partial", "time_end_unknown"), window };
  if (start + duration.max * 60000 <= window.end)
    return { ...reason("time", "match", "time_fits"), window };
  if (start + duration.min * 60000 <= window.end)
    return { ...reason("time", "partial", "time_may_overrun"), window };
  return { ...reason("time", "conflict", "time_ends_after_window"), window };
}

/** @param {string} field @param {Range|undefined} want @param {Range|null|undefined} offer */
function compareRange(field, want, offer) {
  if (!want) return null;
  if (!offer) return reason(field, "unknown");
  if (offer.max < want.min || offer.min > want.max)
    return reason(field, "conflict");
  if (offer.min >= want.min && offer.max <= want.max)
    return reason(field, "match");
  return reason(field, "partial");
}
/** @param {"pace"|"difficulty"} field @param {string|undefined} want @param {string|undefined} offer */
function compareOrdinal(field, want, offer) {
  if (!want) return null;
  if (!offer) return reason(field, "unknown");
  const gap = Math.abs(
    ordinal[field].indexOf(want) - ordinal[field].indexOf(offer),
  );
  return reason(
    field,
    gap === 0 ? "match" : gap === 1 ? "partial" : "conflict",
  );
}
/** @param {string} field @param {string|undefined} want @param {string|undefined} offer */
function compareChoice(field, want, offer) {
  if (!want) return null;
  if (!offer) return reason(field, "unknown");
  return reason(field, want === offer ? "match" : "conflict");
}
/** @param {Area|undefined} want @param {Area|undefined} offer @param {string|undefined} text */
function compareArea(want, offer, text) {
  if (text) {
    if (!offer?.label) return reason("area", "unknown", "area_unknown");
    // A matching label is still not a confirmed place: districts repeat across cities.
    return normalizeLabel(offer.label).includes(normalizeLabel(text))
      ? reason("area", "partial", "area_label_text")
      : reason("area", "conflict", "area_label_mismatch");
  }
  if (!want) return null;
  if (!want.center || !offer?.center || !want.radiusM || !offer.radiusM)
    return reason("area", "unknown", "area_unknown");
  return distanceM(want.center, offer.center) <= want.radiusM + offer.radiusM
    ? reason("area", "match", "area_overlap")
    : reason("area", "conflict", "area_far");
}

/** Evaluate one offer for one want. Pure and deterministic.
 * Hard: time whenever windows exist, and the fields in `want.hard`
 * (conflict excludes; with `strict` an unknown excludes too).
 * @param {Want} want @param {Offer} offer @returns {Evaluation} */
export function evaluate(want, offer) {
  const w = want.passport || {},
    p = offer.passport || {},
    hard = new Set(want.hard || []);
  const time = timeFit(offer.start, offer.duration, want.windows);
  const trackDistance =
    offer.trackDistanceKm && offer.trackDistanceKm > 0
      ? { min: offer.trackDistanceKm, max: offer.trackDistanceKm }
      : null;
  const reasons = /** @type {MatchReason[]} */ (
    [
      reason(time.field, time.status, time.code),
      compareArea(w.area, p.area, want.areaText),
      compareRange("duration", w.durationMinutes, offer.duration),
      compareRange("distance", w.distanceKm, p.distanceKm || trackDistance),
      compareOrdinal("pace", w.pace, p.pace),
      compareChoice("purpose", w.purpose, p.purpose),
      w.surface
        ? !p.surface
          ? reason("surface", "unknown")
          : w.surface === p.surface
            ? reason("surface", "match")
            : w.surface === "mixed" || p.surface === "mixed"
              ? reason("surface", "partial")
              : reason("surface", "conflict")
        : null,
      compareOrdinal("difficulty", w.difficulty, p.difficulty),
      compareRange("speed", w.speedKmh, p.speedKmh),
      compareRange("groupSize", w.groupSize, p.groupSize),
      compareChoice("regroupPolicy", w.regroupPolicy, p.regroupPolicy),
      w.beginnerFriendly
        ? p.beginnerFriendly === undefined
          ? reason("beginnerFriendly", "unknown")
          : reason(
              "beginnerFriendly",
              p.beginnerFriendly ? "match" : "conflict",
            )
        : null,
    ].filter(Boolean)
  );
  let eligible = time.status !== "conflict";
  for (const r of reasons)
    if (
      hard.has(r.field) &&
      (r.status === "conflict" || (want.strict && r.status === "unknown"))
    )
      eligible = false;
  const pick = (/** @type {MatchStatus} */ status) =>
    reasons.filter((r) => r.status === status).map((r) => r.field);
  return {
    eligible,
    time,
    unfiltered: reasons.filter(
      (r) => hard.has(r.field) && r.status === "unknown",
    ).length,
    score: reasons.reduce(
      (sum, r) =>
        sum +
        (matchWeights[/** @type {keyof typeof matchWeights} */ (r.field)] ||
          0) *
          factor[r.status],
      0,
    ),
    reasons,
    matched: pick("match"),
    partial: pick("partial"),
    unknown: pick("unknown"),
    conflicts: pick("conflict"),
  };
}

/** Stable order: eligible; confirmed explicit filters before unknown ones;
 * score; fewer conflicts; fewer unknowns; earlier; id.
 * @template {{evaluation: Evaluation, start: number, id: string}} T
 * @param {T} a @param {T} b */
export function compareMatches(a, b) {
  return (
    Number(b.evaluation.eligible) - Number(a.evaluation.eligible) ||
    a.evaluation.unfiltered - b.evaluation.unfiltered ||
    b.evaluation.score - a.evaluation.score ||
    a.evaluation.conflicts.length - b.evaluation.conflicts.length ||
    a.evaluation.unknown.length - b.evaluation.unknown.length ||
    a.start - b.start ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Public shape of an evaluation: codes only, no coordinates or distances.
 * @param {Evaluation} e */
export function explain(e) {
  return {
    matched: e.matched,
    partial: e.partial,
    unknown: e.unknown,
    conflicts: e.conflicts,
    reasons: e.reasons.map(({ field, status, code }) => ({
      field,
      status,
      code,
    })),
  };
}

/** @typedef {{userId: string, intentId: string, readiness: "ready"|"considering",
 * start: number, end: number}} InterestWindow */
/** @typedef {{startFrom: number, startUntil: number, users: string[],
 * ready: number, considering: number, fitsMaxDuration: number}} GroupSlot */

/** Start times at which one ride of `duration` fits entirely inside a window of
 * every included user. A↔B and B↔C overlaps never add up to A+B+C: a user is
 * counted at time t only if [t, t+duration.min] is inside one of their windows.
 * Users are unique; several intents or windows of one person count once.
 * @param {InterestWindow[]} windows
 * @param {{duration: Range, from: number, to: number, limit?: number}} options
 * @returns {GroupSlot[]} best non-overlapping slots: most people, most ready, earliest */
export function groupSlots(windows, { duration, from, to, limit = 5 }) {
  const minMs = duration.min * 60000,
    maxMs = duration.max * 60000;
  /** @type {{at: number, userId: string, ready: number, delta: number}[]} */
  const events = [];
  for (const w of windows) {
    const a = Math.max(w.start, from),
      b = Math.min(w.end - minMs, to);
    if (a > b) continue;
    const ready = w.readiness === "ready" ? 1 : 0;
    // Closed interval [a, b] of feasible starts → half-open [a, b + 1 ms).
    events.push({ at: a, userId: w.userId, ready, delta: 1 });
    events.push({ at: b + 1, userId: w.userId, ready, delta: -1 });
  }
  events.sort((x, y) => x.at - y.at);
  /** @type {Map<string, {n: number, ready: number}>} */
  const active = new Map();
  /** @type {{startFrom: number, startUntil: number, total: number, ready: number}[]} */
  const segments = [];
  let ready = 0;
  for (let i = 0; i < events.length;) {
    const at = events[i].at;
    // Only a person joining/leaving or changing readiness starts a new slot;
    // another overlapping window of someone already counted does not.
    let changed = false;
    for (; i < events.length && events[i].at === at; i++) {
      const e = events[i],
        cur = active.get(e.userId) || { n: 0, ready: 0 },
        wasIn = cur.n > 0,
        wasReady = cur.ready > 0;
      cur.n += e.delta;
      cur.ready += e.ready * e.delta;
      ready += Number(cur.ready > 0) - Number(wasReady);
      if (wasIn !== cur.n > 0 || wasReady !== cur.ready > 0) changed = true;
      if (cur.n) active.set(e.userId, cur);
      else active.delete(e.userId);
    }
    if (!active.size || i >= events.length) continue;
    const last = segments[segments.length - 1];
    if (!changed && last && last.startUntil === at - 1)
      last.startUntil = events[i].at - 1;
    else
      segments.push({
        startFrom: at,
        startUntil: events[i].at - 1,
        total: active.size,
        ready,
      });
  }
  segments.sort(
    (x, y) =>
      y.total - x.total || y.ready - x.ready || x.startFrom - y.startFrom,
  );
  /** @type {typeof segments} */
  const chosen = [];
  for (const s of segments) {
    if (chosen.length >= limit) break;
    if (
      !chosen.some(
        (c) => s.startFrom <= c.startUntil && c.startFrom <= s.startUntil,
      )
    )
      chosen.push(s);
  }
  // Members are re-derived only for the few chosen slots, at their first start.
  return chosen.map((s) => {
    const at = s.startFrom,
      fits = windows.filter(
        (w) => w.start <= at && at + minMs <= w.end && at <= to,
      ),
      users = [...new Set(fits.map((w) => w.userId))].sort();
    return {
      startFrom: s.startFrom,
      startUntil: s.startUntil,
      users,
      ready: s.ready,
      considering: s.total - s.ready,
      fitsMaxDuration: new Set(
        fits.filter((w) => at + maxMs <= w.end).map((w) => w.userId),
      ).size,
    };
  });
}
