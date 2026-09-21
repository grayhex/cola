// Keep legacy references protected even when a semantic slot overrides them.
// Stable ordering is also the lock order used by settings saves and cleanup.
export function siteAssetIds(settings = {}) {
  return [...new Set([
    ...Object.entries(settings)
      .filter(([key, value]) => key.endsWith("Id") && typeof value === "string")
      .map(([, value]) => value),
    ...Object.values(settings.uiIcons || {}).filter(Boolean),
    ...Object.values(settings.partIconAssets || {}).filter(Boolean),
  ].filter((id) => typeof id === "string" && id).map((id) => id.toLowerCase()))].sort();
}

export function siteAssetUsage(settings = {}, game = {}) {
  const usage = new Map();
  function add(id, label) {
    if (typeof id !== "string" || !id) return;
    id = id.toLowerCase();
    if (!usage.has(id)) usage.set(id, new Set());
    usage.get(id).add(label);
  }
  for (const [key, id] of Object.entries(settings)) {
    if (key.endsWith("Id")) add(id, "Оформление сайта");
  }
  for (const id of Object.values(settings.uiIcons || {})) add(id, "Иконки интерфейса");
  for (const id of Object.values(settings.partIconAssets || {})) add(id, "Иконки компонентов");
  for (const id of Object.values(game.recordImages || {})) add(id, "Рекорды");
  for (const id of Object.values(game.achievementImages || {})) add(id, "Достижения");
  return Object.fromEntries([...usage].map(([id, labels]) => [id, [...labels]]));
}

// Server usage is authoritative for published references. The browser also
// protects its unsaved draft; resetting a slot must not delete a live image.
export function assetUsageLabels(asset, draft = {}, saved = {}) {
  const labels = new Set(asset.usage || []);
  if (siteAssetIds(saved).includes(asset.id)) labels.add("Опубликовано");
  if (siteAssetIds(draft).includes(asset.id)) labels.add("В настройках / черновике");
  return [...labels];
}
