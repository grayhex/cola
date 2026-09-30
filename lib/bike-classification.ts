import type { Classification } from "./classification-validation.ts";
export interface ClassificationSource {
  classification?: Partial<Classification> | null;
  category?: string;
  purposes?: string[];
}
// Canonical, independent facets. The old `category` remains a compatibility
// projection for old clients, links, stock pictures and historical record keys.
export const bikeCategories: Record<string, string> = {
  mtb: "MTB",
  road_gravel: "Шоссе / гравел",
  urban_touring: "Город / туризм",
  bmx: "BMX",
  cargo_utility: "Грузовой / утилитарный",
  special: "Специальный",
};
export const bikeSubtypes: Record<string, Record<string, string>> = {
  mtb: {
    xc: "XC",
    trail: "Trail",
    enduro: "Enduro",
    downhill: "Downhill",
    dirt_jump: "Dirt Jump",
  },
  road_gravel: {
    road: "Шоссе",
    endurance: "Endurance",
    aero: "Aero",
    gravel: "Gravel",
    cyclocross: "Cyclocross",
    tt_triathlon: "TT / Triathlon",
    track: "Track",
  },
  urban_touring: {
    commuter: "Commuter",
    fitness_hybrid: "Fitness / Hybrid",
    trekking: "Trekking",
    touring: "Touring",
    cruiser: "Cruiser",
  },
  bmx: {
    bmx_race: "Race",
    freestyle: "Freestyle",
    street_park: "Street / Park",
  },
  cargo_utility: { cargo: "Cargo", longtail: "Longtail", utility: "Utility" },
  special: {
    tandem: "Tandem",
    recumbent: "Recumbent",
    adaptive: "Adaptive",
    other: "Другое",
  },
};
export const subtypeLabels: Record<string, string> = Object.assign(
  {},
  ...Object.values(bikeSubtypes),
);
export const suspensionLabels: Record<string, string> = {
  rigid: "Rigid · без амортизации",
  hardtail: "Hardtail",
  full_suspension: "Full Suspension",
};
export const constructionLabels: Record<string, string> = {
  standard: "Обычная",
  folding: "Folding · складной",
  cargo: "Cargo · грузовой",
  tandem: "Tandem · тандем",
  recumbent: "Recumbent · лежачий",
};
export const useLabels: Record<string, string> = {
  racing: "Racing",
  xc: "XC",
  trail: "Trail",
  enduro: "Enduro",
  downhill: "Downhill",
  gravel: "Gravel",
  cyclocross: "Cyclocross",
  road_racing: "Road Racing",
  audax_endurance: "Audax / Endurance",
  commuting: "Commuting",
  touring: "Touring",
  bikepacking: "Bikepacking",
  cargo: "Cargo",
  leisure: "Leisure",
};
export const emptyClassification: Classification = {
  category: "",
  subtype: null,
  suspension: null,
  construction: null,
  uses: [],
  electric: false,
  fatbike: false,
};
export const legacyCategories: Record<string, string> = {
  gravel: "Гравел",
  road: "Шоссе",
  mtb: "MTB",
};
export const categoryFilterLabels: Record<string, string> = {
  ...legacyCategories,
  ...bikeCategories,
};

export function classificationOf(
  bike: ClassificationSource = {},
): Classification {
  if (
    bike.classification &&
    bike.classification.category &&
    Object.hasOwn(bikeCategories, bike.classification.category)
  )
    return {
      category: bike.classification.category,
      subtype: Object.hasOwn(
        bikeSubtypes[bike.classification.category],
        bike.classification.subtype || "",
      )
        ? bike.classification.subtype || null
        : null,
      suspension: Object.hasOwn(
        suspensionLabels,
        bike.classification.suspension || "",
      )
        ? bike.classification.suspension || null
        : null,
      construction: Object.hasOwn(
        constructionLabels,
        bike.classification.construction || "",
      )
        ? bike.classification.construction || null
        : null,
      uses: Array.isArray(bike.classification.uses)
        ? [
            ...new Set(
              bike.classification.uses.filter((v: PropertyKey) =>
                Object.hasOwn(useLabels, v),
              ),
            ),
          ].slice(0, 3)
        : [],
      electric: bike.classification.electric === true,
      fatbike: bike.classification.fatbike === true,
    };
  const old = bike.category || "";
  const category = ["road", "gravel"].includes(old)
    ? "road_gravel"
    : Object.hasOwn(bikeCategories, old)
      ? old
      : "";
  const purposeMap: Record<string, string> = {
    city: "commuting",
    travel: "touring",
    sport: "racing",
  };
  return {
    ...emptyClassification,
    category,
    subtype: ["road", "gravel"].includes(old) ? old : null,
    uses: [
      ...new Set(
        (Array.isArray(bike.purposes) ? bike.purposes : [])
          .map((key: string) => purposeMap[key])
          .filter(Boolean),
      ),
    ].slice(0, 3),
  };
}
export function compatibilityCategory(c: Classification) {
  if (c.category !== "road_gravel") return c.category;
  if (c.subtype === "gravel") return "gravel";
  return c.subtype ? "road" : "road_gravel";
}
export function classificationLabels(bike: ClassificationSource) {
  const c = classificationOf(bike);
  const primary = subtypeLabels[c.subtype || ""] || bikeCategories[c.category];
  if (!primary) return [];
  const result = [
    ["bmx", "mtb"].includes(c.category) && c.subtype
      ? bikeCategories[c.category] + " · " + primary
      : primary,
  ];
  // Identity features take priority over additional usage tags. Max three labels,
  // never a dump of every internal field or a guessed suspension/discipline.
  if (
    c.construction &&
    c.construction !== "standard" &&
    c.construction !== c.subtype
  )
    result.push(constructionLabels[c.construction].split(" · ")[0]);
  if (c.electric) result.push("E-bike");
  if (c.fatbike) result.push("Fatbike");
  if (c.suspension && (c.category === "mtb" || c.suspension !== "rigid"))
    result.push(suspensionLabels[c.suspension].split(" · ")[0]);
  return [...new Set(result)].slice(0, 3);
}
export const classificationFilterOptions = {
  subtype: subtypeLabels,
  suspension: suspensionLabels,
  construction: constructionLabels,
  use: useLabels,
  electric: { 1: "Электро", 0: "Без электропривода" },
  fatbike: { 1: "Fatbike", 0: "Не Fatbike" },
};
export function readClassificationFilters(params: URLSearchParams) {
  return Object.fromEntries(
    Object.entries(classificationFilterOptions).map(([key, options]) => {
      const value = params.get(key) || "";
      return [key, Object.hasOwn(options, value) ? value : ""];
    }),
  );
}
export function matchesClassification(
  bike: ClassificationSource,
  filters: Record<string, string> = {},
  categories: string[] = [],
) {
  const c = classificationOf(bike);
  if (
    categories.length &&
    !categories.some(
      (key) =>
        key === c.category ||
        (key === "gravel" && c.subtype === "gravel") ||
        (key === "road" &&
          c.category === "road_gravel" &&
          c.subtype !== "gravel" &&
          !!c.subtype),
    )
  )
    return false;
  return Object.entries(filters).every(
    ([key, value]) =>
      !value ||
      (key === "use"
        ? c.uses.includes(value)
        : ["electric", "fatbike"].includes(key)
          ? c[key as keyof Classification] === (value === "1")
          : c[key as keyof Classification] === value),
  );
}
