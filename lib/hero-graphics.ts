import type { SiteSettings as SiteSettingsType } from "./contracts.ts";
// Stored references contain only local asset IDs or the two bundled scenes.
export const bundledAnimations = [
  { name: "transparent-bike", label: "Велосипедист · компактный" },
  { name: "riding-bike", label: "Велосипедист · большая сцена" },
];

// One-way upgrade of the settings saved before #185. The retired mode is not
// exposed to the client or accepted by the new settings API.
export function migrateHeroGraphics(
  stored: Partial<SiteSettingsType> & {
    heroGraphicMode?: string;
    heroAnimationLightId?: string;
    heroAnimationDarkId?: string;
  },
) {
  if (!Object.hasOwn(stored, "heroGraphicMode")) return {};
  const custom = stored.heroGraphicMode === "custom";
  const uploaded = (id: string | undefined) =>
    id ? { kind: "svg" as const, assetId: id } : null;
  return {
    heroTitleAnimation: custom
      ? null
      : { kind: "builtin" as const, name: "transparent-bike" as const },
    heroStageAnimation: custom
      ? uploaded(stored.heroAnimationLightId)
      : { kind: "builtin" as const, name: "riding-bike" as const },
    heroStageDarkAnimation: custom
      ? uploaded(stored.heroAnimationDarkId)
      : null,
  };
}

export function animationAssetIds(settings: Partial<SiteSettingsType>) {
  return (
    [
      "heroTitleAnimation",
      "heroStageAnimation",
      "heroStageDarkAnimation",
    ] as const
  )
    .map((key) => {
      const animation = settings[key];
      return animation && "assetId" in animation
        ? animation.assetId
        : undefined;
    })
    .filter((id): id is string => typeof id === "string");
}

export function assetFormat(filename: string = "") {
  return filename.endsWith(".riv")
    ? "rive"
    : filename.endsWith(".svg")
      ? "svg"
      : "image";
}
