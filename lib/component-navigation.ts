import type { SiteCatalog as SiteCatalogType } from "./contracts.ts";
import { defaultGroups } from "./garage-layout.ts";
import { productCategory } from "./component-products.ts";

// The same configured groups as the garage, completed with unassigned defaults
// and custom types. Navigation must not depend on which models are popular.
export function installationNavigation(
  catalog: Partial<SiteCatalogType> = {},
  available: string[] = [],
) {
  const configured = catalog.componentGroups || [];
  const definitions = [
    ...defaultGroups.map(
      (g) => configured.find((c: { id: string }) => c.id === g.id) || g,
    ),
    ...configured.filter(
      (g: { id: string }) => !defaultGroups.some((d) => d.id === g.id),
    ),
  ];
  const assigned = new Set(configured.flatMap((g) => g.categories));
  const seen = new Set();
  const groups = definitions.map((g) => ({
    ...g,
    categories: [
      ...g.categories.filter(
        (c: string) =>
          !assigned.has(c) ||
          configured.some((d) => d.id === g.id && d.categories.includes(c)),
      ),
      ...(defaultGroups.find((d) => d.id === g.id)?.categories || []).filter(
        (c) => !assigned.has(c),
      ),
    ].filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    }),
  }));
  const other = [
    ...new Set([
      ...(catalog.partCategories?.build || []),
      ...(catalog.partCategories?.accessories || []),
      ...available,
    ]),
  ].filter((c) => c && !seen.has(c));
  if (other.length) {
    const fallback = groups.find((g) => g.id === "other");
    if (fallback) fallback.categories.push(...other);
    else
      groups.push({
        id: "other",
        name: "Другое",
        icon: "other",
        categories: other,
      });
  }
  return groups.filter((g) => g.categories.length);
}

export function componentNavigation(
  catalog: Partial<SiteCatalogType> = {},
  available: string[] = [],
) {
  const seen = new Set();
  return installationNavigation(catalog, available)
    .map((group) => ({
      ...group,
      categories: group.categories
        .map(productCategory)
        .filter((category): category is string => {
          if (!category || seen.has(category)) return false;
          seen.add(category);
          return true;
        }),
    }))
    .filter((group) => group.categories.length);
}

export const componentCategoryPath = (category: string) =>
  "/components?" + new URLSearchParams({ category });
export const componentGroupAnchor = (id: string) => "component-group-" + id;
export const componentGroupPath = (id: string) =>
  "/components#" + encodeURIComponent(componentGroupAnchor(id));
