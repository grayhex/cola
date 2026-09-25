import { metricByKey, metricGroups, metricValue } from "./game-metrics.js";

export const gameDescriptionLimit = 160;

// Records and awards on /records come in the groups of their metrics, in the
// catalog's order; a group with nothing in it is not shown.
export function groupByMetric(items) {
  const known = new Set(metricGroups.map((group) => group.id));
  const grouped = metricGroups.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  }));
  // An item of an unknown group stays visible rather than disappearing.
  const other = items.filter((item) => !known.has(item.group));
  if (other.length) grouped.push({ id: "other", name: "Другие", items: other });
  return grouped.filter((group) => group.items.length);
}
export const groupRecords = (records) =>
  groupByMetric(records).map(({ items, ...group }) => ({
    ...group,
    records: items,
  }));

// The home block: at most four held records, not only prices and weights.
// Records of rides and riders take half of it, or more when bikes hold fewer.
export function homeRecords(records, limit = 4) {
  const held = records.filter((record) => record.holder);
  const bikes = held.filter((record) => record.subject === "bike");
  const others = held.filter((record) => record.subject !== "bike");
  const shownOthers = Math.min(
    others.length,
    Math.max(Math.ceil(limit / 2), limit - bikes.length),
  );
  const chosen = new Set([
    ...others.slice(0, shownOthers),
    ...bikes.slice(0, limit - shownOthers),
  ]);
  return held.filter((record) => chosen.has(record));
}

// How a rule decides, in one line for the admin list: "Дистанция покатушки
// ≥ 100 км", "Минимум: вес велосипеда · MTB".
export function ruleCondition(rule, categoryLabels = {}) {
  const metric = metricByKey[rule.metric];
  if (!metric) return "";
  const main =
    rule.kind === "award"
      ? `${metric.label} ${rule.comparison === "lte" ? "≤" : "≥"} ${metricValue(rule.metric, rule.threshold)}`
      : `${rule.direction === "min" ? "Минимум" : "Максимум"}: ${metric.label.toLowerCase()}`;
  const filters = [
    rule.category && (categoryLabels[rule.category] || rule.category),
    rule.minDistanceKm != null &&
      "от " + metricValue("ride_distance", rule.minDistanceKm),
    rule.keywords?.length && rule.keywords.join(", "),
  ].filter(Boolean);
  return [main, ...filters].join(" · ");
}
