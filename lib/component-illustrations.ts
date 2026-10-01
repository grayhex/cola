import type { SiteCatalog as SiteCatalogType } from "./contracts.ts";
import type { SiteSettings as SiteSettingsType } from "./contracts.ts";
import { installationNavigation } from "./component-navigation.ts";

// Assignments use stable group IDs and the same category names as the catalog.
// Keep orphaned assignments until explicitly reset: a catalog edit must not
// silently make a published image eligible for deletion.
export function componentIllustrationSlots(
  catalog: Partial<SiteCatalogType> | undefined,
) {
  return installationNavigation(catalog).flatMap((group) => [
    {
      key: "group:" + group.id,
      kind: "groups" as const,
      name: group.id,
      label: "Группа · " + group.name,
      group: group.name,
      emptyLabel: "Стандартный значок",
      section: "components",
    },
    ...group.categories.map((category: string) => ({
      key: "category:" + category,
      kind: "categories" as const,
      name: category,
      label: "Тип · " + category,
      group: group.name,
      emptyLabel: "Стандартный значок",
      section: "components",
    })),
  ]);
}

export function componentIllustrationIds(
  settings: Partial<SiteSettingsType> = {},
) {
  return (["groups", "categories"] as const).flatMap((kind) =>
    Object.values(settings.componentIllustrations?.[kind] || {}).filter(
      (id): id is string => typeof id === "string" && !!id,
    ),
  );
}
