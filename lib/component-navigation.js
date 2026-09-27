import { defaultGroups } from "./garage-layout.js";

// The same configured groups as the garage, completed with unassigned defaults
// and custom types. Navigation must not depend on which models are popular.
export function componentNavigation(catalog = {}, available = []) {
  const configured = catalog.componentGroups || [];
  const definitions = [
    ...defaultGroups.map((g) => configured.find((c) => c.id === g.id) || g),
    ...configured.filter((g) => !defaultGroups.some((d) => d.id === g.id)),
  ];
  const assigned = new Set(configured.flatMap((g) => g.categories));
  const seen = new Set();
  const groups = definitions.map((g) => ({
    ...g,
    categories: [
      ...g.categories.filter(
        (c) =>
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

export const componentCategoryPath = (category) =>
  "/components?" + new URLSearchParams({ category });
export const componentGroupAnchor = (id) => "component-group-" + id;
export const componentGroupPath = (id) =>
  "/components#" + encodeURIComponent(componentGroupAnchor(id));
