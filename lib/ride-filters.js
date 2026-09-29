import { ridePlanOptions } from "./ride-plan-options.js";

// Public quick filters of upcoming rides (#233). The page URL carries only
// these shared choices — never a personal schedule, identity or coordinates.
export const datePresets = Object.freeze({
  today: "Сегодня",
  weekend: "Выходные",
  week: "7 дней",
  month: "30 дней",
});
/** @type {Readonly<Record<"short"|"medium"|"long", [string, {durationMin?: number, durationMax?: number}]>>} */
export const durationBuckets = Object.freeze({
  short: ["До 2 ч", { durationMax: 120 }],
  medium: ["2–4 ч", { durationMin: 120, durationMax: 240 }],
  long: ["Дольше 4 ч", { durationMin: 240 }],
});
const choiceKeys = /** @type {const} */ (["pace", "purpose", "surface"]);
export const filterKeys = ["when", ...choiceKeys, "duration", "area"];

/** Instants for a preset in the viewer's local time.
 * @param {string} kind @param {Date} [now] */
export function presetRange(kind, now = new Date()) {
  const start = new Date(now);
  const midnight = (/** @type {number} */ days) => {
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
/** Keep only known values: a hand-edited URL cannot inject other params.
 * @param {URLSearchParams} params */
export function readFilters(params) {
  /** @type {Record<string, string>} */
  const out = {};
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
/** API query for /api/rides (status=planned) from page filters.
 * @param {Record<string, string>} filters @param {Date} [now] */
export function apiFilters(filters, now = new Date()) {
  /** @type {Record<string, string>} */
  const out = {};
  const range = filters.when ? presetRange(filters.when, now) : null;
  if (range) {
    out.from = range.from.toISOString();
    out.to = range.to.toISOString();
  }
  for (const key of choiceKeys) if (filters[key]) out[key] = filters[key];
  const bucket =
    durationBuckets[
      /** @type {keyof typeof durationBuckets} */ (filters.duration)
    ];
  if (bucket)
    for (const [k, v] of Object.entries(bucket[1])) out[k] = String(v);
  if (filters.area) out.area = filters.area;
  return out;
}
/** Human labels for the applied-filter chips. @param {Record<string, string>} f */
export function filterLabels(f) {
  /** @type {[string, string][]} */
  const out = [];
  if (f.when)
    out.push([
      "when",
      datePresets[/** @type {keyof typeof datePresets} */ (f.when)],
    ]);
  for (const key of choiceKeys)
    if (f[key])
      out.push([
        key,
        /** @type {Record<string, string>} */ (ridePlanOptions[key])[f[key]],
      ]);
  if (f.duration)
    out.push([
      "duration",
      durationBuckets[
        /** @type {keyof typeof durationBuckets} */ (f.duration)
      ][0],
    ]);
  if (f.area) out.push(["area", "Район: " + f.area]);
  return out;
}
