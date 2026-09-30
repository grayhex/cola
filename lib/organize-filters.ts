import { ridePlanOptions } from "./ride-plan-options.js";
import { presetRange } from "./ride-filters.js";

// «Собрать компанию» (#234): the organizer's compact filters → the groups
// query of /api/ride-matches and the planner prefill. Nothing here reaches
// the page URL except these shared choices.

/** Planned duration with stops, minutes. The organizer always picks one:
 * a common time only exists for a known length. */
export const organizeDurations = Object.freeze({
  short: ["До 2 ч", { min: 60, max: 120 }] as const,
  medium: ["2–4 ч", { min: 120, max: 240 }] as const,
  long: ["4–8 ч", { min: 240, max: 480 }] as const,
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
const choices = /** @type {const} */ ["purpose", "pace", "surface"] as const;

/** Known values only; a hand-edited URL cannot inject other parameters. */
export function readOrganize(params: URLSearchParams) {
  const out: Record<string, string> = { ...organizeDefaults };
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

const range = (
  key: string,
): {
  min: number;
  max: number;
} =>
  /** @type {{min: number, max: number}} */ organizeDurations[
    /** @type {keyof typeof organizeDurations} */ key as keyof typeof organizeDurations
  ]?.[1] ||
  (organizeDurations.short[1] as {
    min: number;
    max: number;
  });

/** Query of GET /api/ride-matches/groups. */
export function organizeQuery(
  filters: Record<string, string>,
  now: Date = new Date(),
) {
  const period =
    presetRange(filters.when || organizeDefaults.when, now) ||
    presetRange(organizeDefaults.when, now);
  const duration = range(filters.duration);
  const params = new URLSearchParams({
    from: (
      period as {
        from: Date;
      }
    ).from.toISOString(),
    to: (
      period as {
        to: Date;
      }
    ).to.toISOString(),
    durationMin: String(duration.min),
    durationMax: String(duration.max),
  });
  for (const key of choices) if (filters[key]) params.set(key, filters[key]);
  if (filters.area) params.set("areaText", filters.area);
  return params;
}

/** The planner prefill for one group: the group's start and the chosen
format — never names, notes or windows of the people in it. */
export function organizeDraft(
  filters: Record<string, string>,
  group: {
    startFrom: string;
  },
) {
  const passport: {
    durationMinutes: { min: number; max: number };
    purpose?: string;
    pace?: string;
    surface?: string;
    area?: { label: string };
  } = {
    durationMinutes: range(filters.duration),
  };
  for (const key of choices) if (filters[key]) passport[key] = filters[key];
  if (filters.area) passport.area = { label: filters.area };
  // A window in progress starts "now", with seconds; the planner edits whole
  // minutes, so round up rather than land in the past.
  const minute = 60000;
  const startAt = new Date(
    Math.ceil(Date.parse(group.startFrom) / minute) * minute,
  ).toISOString();
  return { startAt, passport, fromInterest: true };
}
