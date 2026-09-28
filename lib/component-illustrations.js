import { componentNavigation } from "./component-navigation.js";

// Assignments use stable group IDs and the same category names as the catalog.
// Keep orphaned assignments until explicitly reset: a catalog edit must not
// silently make a published image eligible for deletion.
export function componentIllustrationSlots(catalog) {
  return componentNavigation(catalog).flatMap((group) => [
    {
      key: "group:" + group.id,
      kind: "groups",
      name: group.id,
      label: "Группа · " + group.name,
      group: group.name,
      emptyLabel: "Стандартный значок",
      section: "components",
    },
    ...group.categories.map((category) => ({
      key: "category:" + category,
      kind: "categories",
      name: category,
      label: "Тип · " + category,
      group: group.name,
      emptyLabel: "Стандартный значок",
      section: "components",
    })),
  ]);
}

export function componentIllustrationIds(settings = {}) {
  return ["groups", "categories"].flatMap((kind) =>
    Object.values(settings.componentIllustrations?.[kind] || {}).filter(
      (id) => typeof id === "string" && id,
    ),
  );
}
