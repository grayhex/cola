export function siteAssetIds(settings) {
  return [
    ...new Set([
      ...Object.entries(settings)
        .filter(([k, v]) => k.endsWith("Id") && typeof v === "string")
        .map(([, v]) => v),
      ...Object.values(settings.uiIcons || {}).filter(Boolean),
      ...Object.values(settings.partIconAssets || {}).filter(Boolean),
    ]),
  ];
}
