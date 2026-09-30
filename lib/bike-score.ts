import { defaultGroups } from "./garage-layout.ts";
export const defaultScoring = {
  base: { mtb: 50, road: 50, gravel: 50 },
  componentTarget: 21,
  photoPoints: 50,
  weight: { reference: 14, pointsPer10Percent: 0 },
  price: { reference: 100000, pointsPer10Percent: 0 },
  rules:
    /** @type {Array<{groupId: string, category: string, match: string, points: number}>} */ [] as Array<{
      groupId: string;
      category: string;
      match: string;
      points: number;
    }>,
};
const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)));
const normalized = (s: string) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function scoreBike(
  bike: {
    category?: string;
    weight?: string | number | null;
    price?: string | number | null;
    show_bike_price?: boolean;
    components?: {
      section: string;
      name: string;
      category: string;
      group_id?: string;
    }[];
    photos?: unknown[];
  },
  config = defaultScoring,
  groups = defaultGroups,
) {
  const parts = (bike.components || []).filter(
    (p: { section: string; name: string }) =>
      p.section === "build" && p.name?.trim(),
  );
  const unique = new Set(
    parts.map((p) => normalized(p.category) + "|" + normalized(p.name)),
  );
  const hasPhoto = !!bike.photos?.length;
  const filled = clamp(
    (hasPhoto ? config.photoPoints : 0) +
      (100 - config.photoPoints) *
        Math.min(1, unique.size / config.componentTarget),
  );
  // Both a real photo and the configured count are required for 100%.
  const completeness =
    hasPhoto && unique.size >= config.componentTarget
      ? 100
      : Math.min(99, filled);
  let total = config.base[bike.category as keyof typeof config.base] ?? 50;
  for (const rule of config.rules) {
    const tokens = normalized(rule.match).split(" ").filter(Boolean);
    if (!tokens.length) continue;
    if (
      parts.some((p) => {
        const group =
          groups.find((g) => g.id === p.group_id) ||
          groups.find((g) => g.categories.includes(p.category));
        const text = " " + normalized(p.name) + " ";
        return (
          (!rule.groupId || (group?.id || "other") === rule.groupId) &&
          (!rule.category || p.category === rule.category) &&
          tokens.every((token: string) => text.includes(" " + token + " "))
        );
      })
    )
      total += rule.points;
  }
  if (Number(bike.weight) > 0)
    total +=
      ((config.weight.reference - Number(bike.weight)) /
        config.weight.reference) *
      10 *
      config.weight.pointsPer10Percent;
  // A hidden price must not leak through a publicly observable score.
  if (bike.show_bike_price && Number(bike.price) > 0)
    total +=
      ((Number(bike.price) - config.price.reference) / config.price.reference) *
      10 *
      config.price.pointsPer10Percent;
  return { completeness, upgrade: clamp(total) };
}
