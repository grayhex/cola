import { ridePlanOptions } from "./ride-plan-options.ts";

// Public quick filters of upcoming rides (#233). The page URL carries only
// these shared choices — never a personal schedule, identity or coordinates.
export const datePresets = Object.freeze({
  today: "Сегодня",
  weekend: "Выходные",
  week: "7 дней",
  month: "30 дней",
});

export const durationBuckets: Readonly<
  Record<
    "short" | "medium" | "long",
    [string, { durationMin?: number; durationMax?: number }]
  >
> = Object.freeze({
  // Whole minutes, bounds inclusive and disjoint: ≤ 120, 121–240, ≥ 241.
  short: ["До 2 ч", { durationMax: 120 }],
  medium: ["2–4 ч", { durationMin: 121, durationMax: 240 }],
  long: ["Дольше 4 ч", { durationMin: 241 }],
});
/** The catalogue tabs of /rides (#370). A clean address shows upcoming rides;
 * «Все» has its own value, otherwise a deliberate choice could not be told
 * from a first visit and a copied link would change its meaning. */
export const rideStatuses = Object.freeze({
  planned: "Предстоящие",
  completed: "Прошедшие",
  all: "Все",
});
export type RideStatus = keyof typeof rideStatuses;
export const defaultRideStatus: RideStatus = "planned";
/** A known value only; anything else (a hand-edited address, the previous
 * «no status» form of «Все») opens the default tab. */
export function readRideStatus(params: URLSearchParams): RideStatus {
  const value = params.get("status");
  return value !== null && Object.hasOwn(rideStatuses, value)
    ? (value as RideStatus)
    : defaultRideStatus;
}
/** The `status` of /api/rides for a tab: «Все» sends none. */
export const rideStatusQuery = (status: RideStatus) =>
  status === "all" ? null : status;
const choiceKeys = ["pace", "purpose", "surface"] as const;
export const filterKeys = ["when", ...choiceKeys, "duration", "area"];

/** Instants for a preset in the viewer's local time. */
export function presetRange(kind: string, now: Date = new Date()) {
  const start = new Date(now);
  const midnight = (days: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  };
  if (kind === "today") return { from: start, to: midnight(1) };
  if (kind === "weekend") {
    const day = now.getDay(); // 0 Sunday … 6 Saturday
    const saturday = day === 6 || day === 0 ? 0 : 6 - day;
    const monday = day === 0 ? 1 : day === 6 ? 2 : saturday + 2;
    const from = saturday ? midnight(saturday) : start;
    return { from, to: midnight(monday) };
  }
  if (kind === "week")
    return { from: start, to: new Date(+now + 7 * 86400000) };
  if (kind === "month")
    return { from: start, to: new Date(+now + 30 * 86400000) };
  return null;
}
/** Keep only known values: a hand-edited URL cannot inject other params. */
export function readFilters(params: URLSearchParams) {
  const out: Record<string, string> = {};
  const when = params.get("when");
  if (when && when in datePresets) out.when = when;
  for (const key of choiceKeys) {
    const v = params.get(key);
    if (v && v in ridePlanOptions[key]) out[key] = v;
  }
  const duration = params.get("duration");
  if (duration && duration in durationBuckets) out.duration = duration;
  const area = params.get("area")?.trim().slice(0, 100);
  if (area) out.area = area;
  return out;
}
/** API query for /api/rides (status=planned) from page filters. */
export function apiFilters(
  filters: Record<string, string>,
  now: Date = new Date(),
) {
  const out: Record<string, string> = {};
  const range = filters.when ? presetRange(filters.when, now) : null;
  if (range) {
    out.from = range.from.toISOString();
    out.to = range.to.toISOString();
  }
  for (const key of choiceKeys) if (filters[key]) out[key] = filters[key];
  const bucket =
    durationBuckets[filters.duration as keyof typeof durationBuckets];
  if (bucket)
    for (const [k, v] of Object.entries(bucket[1])) out[k] = String(v);
  if (filters.area) out.area = filters.area;
  return out;
}
/** Human labels for the applied-filter chips. */
export function filterLabels(f: Record<string, string>) {
  const out: [string, string][] = [];
  if (f.when)
    out.push(["when", datePresets[f.when as keyof typeof datePresets]]);
  for (const key of choiceKeys)
    if (f[key])
      out.push([key, (ridePlanOptions[key] as Record<string, string>)[f[key]]]);
  if (f.duration)
    out.push([
      "duration",
      durationBuckets[f.duration as keyof typeof durationBuckets][0],
    ]);
  if (f.area) out.push(["area", "Район: " + f.area]);
  return out;
}
