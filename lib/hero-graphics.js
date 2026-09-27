// Stored references contain only local asset IDs or the two bundled scenes.
export const bundledAnimations = [
  { name: "transparent-bike", label: "Велосипедист · компактный" },
  { name: "riding-bike", label: "Велосипедист · большая сцена" },
];

// One-way upgrade of the settings saved before #185. The retired mode is not
// exposed to the client or accepted by the new settings API.
export function migrateHeroGraphics(stored) {
  if (!Object.hasOwn(stored, "heroGraphicMode")) return {};
  const custom = stored.heroGraphicMode === "custom";
  const uploaded = (id) => (id ? { kind: "svg", assetId: id } : null);
  return {
    heroTitleAnimation: custom
      ? null
      : { kind: "builtin", name: "transparent-bike" },
    heroStageAnimation: custom
      ? uploaded(stored.heroAnimationLightId)
      : { kind: "builtin", name: "riding-bike" },
    heroStageDarkAnimation: custom
      ? uploaded(stored.heroAnimationDarkId)
      : null,
  };
}

export function animationAssetIds(settings) {
  return ["heroTitleAnimation", "heroStageAnimation", "heroStageDarkAnimation"]
    .map((key) => settings[key]?.assetId)
    .filter((id) => typeof id === "string");
}

export function assetFormat(filename = "") {
  return filename.endsWith(".riv")
    ? "rive"
    : filename.endsWith(".svg")
      ? "svg"
      : "image";
}
