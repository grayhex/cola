import { defaultGroups } from "./garage-layout.js";
export const defaultScoring = {
  base: { mtb: 50, road: 50, gravel: 50 },
  componentTarget: 21,
  photoPoints: 50,
  weight: { reference: 14, pointsPer10Percent: 0 },
  price: { reference: 100000, pointsPer10Percent: 0 },
  rules: [],
};
const clamp = (n) => Math.round(Math.max(0, Math.min(100, n)));
const normalized = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function scoreBike(bike, config = defaultScoring, groups = defaultGroups) {
  const parts = (bike.components || []).filter(p => p.section === "build" && p.name?.trim());
  const unique = new Set(parts.map(p => normalized(p.category)));
  const hasPhoto = !!bike.photos?.length;
  const filled = clamp((hasPhoto ? config.photoPoints : 0) +
    (100 - config.photoPoints) * Math.min(1, unique.size / config.componentTarget));
  // Both a real photo and the configured count are required for 100%.
  const completeness = hasPhoto && unique.size >= config.componentTarget ? 100 : Math.min(99, filled);
  let total = config.base[bike.category] ?? 50;
  for (const rule of config.rules) {
    const tokens = normalized(rule.match).split(" ").filter(Boolean);
    if (!tokens.length) continue;
    if (parts.some(p => {
      const group = groups.find(g => g.id === p.group_id) || groups.find(g => g.categories.includes(p.category));
      const text = " " + normalized(p.name) + " ";
      return (!rule.groupId || (group?.id || "other") === rule.groupId) &&
        (!rule.category || p.category === rule.category) &&
        tokens.every(token => text.includes(" " + token + " "));
    })) total += rule.points;
  }
  if (Number(bike.weight) > 0)
    total += ((config.weight.reference - Number(bike.weight)) / config.weight.reference) * 10 * config.weight.pointsPer10Percent;
  // A hidden price must not leak through a publicly observable score.
  if (bike.show_bike_price && Number(bike.price) > 0)
    total += ((Number(bike.price) - config.price.reference) / config.price.reference) * 10 * config.price.pointsPer10Percent;
  return { completeness, upgrade: clamp(total) };
}
