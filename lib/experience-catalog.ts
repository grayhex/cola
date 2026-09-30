import type { SiteCatalog } from "./contracts.ts";
export const defaultPurposes = [
  { id: "city", name: "Город", enabled: true },
  { id: "travel", name: "Путешествия", enabled: true },
  { id: "sport", name: "Спорт", enabled: true },
  { id: "winter", name: "Зима", enabled: true },
  { id: "custom", name: "Самосбор", enabled: true },
];
/** A spelling that search reads as the catalogue name, optionally within a
brand or component category (scope). */

export const defaultAliases: CatalogAlias[] = (
  [
    ["brand", "Куб", "Cube"],
    ["brand", "Джайант", "Giant"],
    ["brand", "Мерида", "Merida"],
    ["brand", "Трек", "Trek"],
    ["component", "Шимано", "Shimano"],
    ["component", "Срам", "SRAM"],
    ["component", "Швальбе", "Schwalbe"],
  ] as const
).map(([kind, alias, name]) => ({ kind, alias, name, scope: "" }));
export const normalizeName = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]/g, "");
export function aliasRules(
  catalog: Pick<SiteCatalog, "aliases">,
  kind: string,
  scope = "",
) {
  return (catalog.aliases || defaultAliases)
    .filter(
      (a) =>
        a.kind === kind &&
        (!a.scope || normalizeName(a.scope) === normalizeName(scope)),
    )
    .sort(
      (a, b) => normalizeName(b.alias).length - normalizeName(a.alias).length,
    );
}
export function canonicalName(value: string, rules: CatalogAlias[]) {
  let s = normalizeName(value);
  for (const a of rules)
    s = s.replaceAll(normalizeName(a.alias), normalizeName(a.name));
  return s;
}
// Legacy search grouping key, NOT a persistent catalog ID. Stable component
// models live in component_models; component.id is one owner's installation.
export function componentModel(
  part: { category: string; name: string },
  catalog: Pick<SiteCatalog, "aliases">,
) {
  return {
    category: part.category,
    name: part.name,
    key:
      normalizeName(part.category) +
      ":" +
      canonicalName(part.name, aliasRules(catalog, "component", part.category)),
  };
}

export function experienceHref({
  brand,
  model,
  component,
  componentCategory,
  purpose,
}: {
  brand?: string;
  model?: string;
  component?: string;
  componentCategory?: string;
  purpose?: string;
} = {}) {
  const p = new URLSearchParams({ exact: "1" });
  for (const [k, v] of Object.entries({
    brand,
    model,
    component,
    componentCategory,
    purpose,
  }))
    if (v) p.set(k, v);
  return "/experience?" + p;
}
// Model and part pages of owner experience (#74). Lowercase Latin and
// Cyrillic letters and digits with hyphens between words, like
// `public_url_slug` in SQL but never cut short: a page finds its builds by
// the whole name.
export function landingSlug(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const segment = (value: string) => encodeURIComponent(landingSlug(value));
export const modelLandingPath = (brand: string, model: string) =>
  `/experience/${segment(brand)}/${segment(model)}`;
export const partLandingPath = (category: string, name: string) =>
  `/experience/parts/${segment(category)}/${segment(name)}`;
export function mergeCatalog(catalog: SiteCatalog, rule: CatalogAlias) {
  const aliases = [
    ...(catalog.aliases || defaultAliases).filter(
      (a) =>
        !(
          a.kind === rule.kind &&
          a.scope === rule.scope &&
          normalizeName(a.alias) === normalizeName(rule.alias)
        ),
    ),
    rule,
  ];
  const replace = (values: string[]) => [
    ...new Set(
      values.map((v) =>
        normalizeName(v) === normalizeName(rule.alias) ? rule.name : v,
      ),
    ),
  ];
  let models = catalog.models,
    parts = catalog.parts;
  if (rule.kind === "brand")
    models = Object.fromEntries(
      Object.entries(models).map(([type, brands]) => {
        const next: Record<string, string[]> = {};
        for (const [name, list] of Object.entries(brands)) {
          const key =
            normalizeName(name) === normalizeName(rule.alias)
              ? rule.name
              : name;
          next[key] = [...new Set([...(next[key] || []), ...list])];
        }
        return [type, next];
      }),
    ) as SiteCatalog["models"];
  if (rule.kind === "model")
    models = Object.fromEntries(
      Object.entries(models).map(([type, brands]) => [
        type,
        Object.fromEntries(
          Object.entries(brands).map(([brand, values]) => [
            brand,
            !rule.scope || normalizeName(brand) === normalizeName(rule.scope)
              ? replace(values)
              : values,
          ]),
        ),
      ]),
    ) as SiteCatalog["models"];
  if (rule.kind === "component")
    parts = Object.fromEntries(
      Object.entries(parts).map(([category, values]) => [
        category,
        !rule.scope || normalizeName(category) === normalizeName(rule.scope)
          ? replace(values)
          : values,
      ]),
    );
  return { ...catalog, models, parts, aliases };
}

export type CatalogAlias = {
  kind: "brand" | "model" | "component";
  alias: string;
  name: string;
  scope: string;
};
