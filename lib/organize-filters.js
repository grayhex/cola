import { ridePlanOptions } from "./ride-plan-options.js";
import { presetRange } from "./ride-filters.js";

// «Собрать компанию» (#234): the organizer's compact filters → the groups
// query of /api/ride-matches and the planner prefill. Nothing here reaches
// the page URL except these shared choices.

/** Planned duration with stops, minutes. The organizer always picks one:
 * a common time only exists for a known length. */
export const organizeDurations = Object.freeze({
  short: ["До 2 ч", { min: 60, max: 120 }],
  medium: ["2–4 ч", { min: 120, max: 240 }],
  long: ["4–8 ч", { min: 240, max: 480 }],
});
export const organizePeriods = Object.freeze({
  weekend: "Выходные",
  week: "7 дней",
  month: "30 дней",
});
export const organizeDefaults = Object.freeze({
  when: "week",
  duration: "short",
});
const choices = /** @type {const} */ (["purpose", "pace", "surface"]);

/** Known values only; a hand-edited URL cannot inject other parameters.
 * @param {URLSearchParams} params */
export function readOrganize(params) {
  /** @type {Record<string, string>} */
  const out = { ...organizeDefaults };
  const when = params.get("when");
  if (when && when in organizePeriods) out.when = when;
  const duration = params.get("duration");
  if (duration && duration in organizeDurations) out.duration = duration;
  for (const key of choices) {
    const v = params.get(key);
    if (v && v in ridePlanOptions[key]) out[key] = v;
  }
  const area = params.get("area")?.trim().slice(0, 100);
  if (area) out.area = area;
  return out;
}

/** @param {string} key @returns {{min: number, max: number}} */
const range = (key) =>
  /** @type {{min: number, max: number}} */ (
    organizeDurations[
      /** @type {keyof typeof organizeDurations} */ (key)
    ]?.[1] || organizeDurations.short[1]
  );

/** Query of GET /api/ride-matches/groups.
 * @param {Record<string, string>} filters @param {Date} [now] */
export function organizeQuery(filters, now = new Date()) {
  const period =
    presetRange(filters.when || organizeDefaults.when, now) ||
    presetRange(organizeDefaults.when, now);
  const duration = range(filters.duration);
  const params = new URLSearchParams({
    from: /** @type {{from: Date}} */ (period).from.toISOString(),
    to: /** @type {{to: Date}} */ (period).to.toISOString(),
    durationMin: String(duration.min),
    durationMax: String(duration.max),
  });
  for (const key of choices) if (filters[key]) params.set(key, filters[key]);
  if (filters.area) params.set("areaText", filters.area);
  return params;
}

/** The planner prefill for one group: the group's start and the chosen
 * format — never names, notes or windows of the people in it.
 * @param {Record<string, string>} filters @param {{startFrom: string}} group */
export function organizeDraft(filters, group) {
  /** @type {Record<string, any>} */
  const passport = { durationMinutes: range(filters.duration) };
  for (const key of choices) if (filters[key]) passport[key] = filters[key];
  if (filters.area) passport.area = { label: filters.area };
  return { startAt: group.startFrom, passport, fromInterest: true };
}
