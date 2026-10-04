import type { SiteSettings } from "./contracts.ts";
type AssetSettings = Partial<SiteSettings> & {
  heroAnimationLightId?: string;
  heroAnimationDarkId?: string;
};
import { illustrationSlots, planningGraphicSlots } from "./design-graphics.ts";
import { componentIllustrationIds } from "./component-illustrations.ts";
import { animationAssetIds } from "./hero-graphics.ts";
const imageKeys = new Set([
  ...illustrationSlots.map((slot) => slot.key),
  "heroBackgroundImageId",
  "heroImageId",
  "heroStageImageId",
  "heroAnimationLightId",
  "heroAnimationDarkId",
]);
// Stable ordering is also the lock order used by settings saves and cleanup.
export function siteAssetIds(settings: AssetSettings = {}) {
  return [
    ...new Set(
      [
        ...animationAssetIds(settings),
        ...planningGraphicSlots.map(({ key }) => settings[key]?.assetId),
        ...componentIllustrationIds(settings),
        ...Object.entries(settings)
          .filter(
            ([key, value]) => imageKeys.has(key) && typeof value === "string",
          )
          .map(([, value]) => value),
      ]
        .filter((id): id is string => typeof id === "string" && !!id)
        .map((id: string) => id.toLowerCase()),
    ),
  ].sort();
}

export function siteAssetUsage(
  settings: AssetSettings = {},
  game: {
    recordImages?: Record<string, string | null>;
    achievementImages?: Record<string, string | null>;
  } = {},
  mobileIds: string[] = [],
) {
  const usage = new Map<string, Set<string>>();
  function add(value: unknown, label: string) {
    if (typeof value !== "string" || !value) return;
    const id = value.toLowerCase();
    if (!usage.has(id)) usage.set(id, new Set());
    usage.get(id)!.add(label);
  }
  for (const [key, id] of Object.entries(settings)) {
    if (imageKeys.has(key)) add(id, "Оформление сайта");
  }
  for (const { key, label } of planningGraphicSlots)
    add(settings[key]?.assetId, label);
  for (const id of animationAssetIds(settings)) add(id, "Анимация главной");
  for (const id of componentIllustrationIds(settings))
    add(id, "Категории компонентов");
  for (const id of Object.values(game.recordImages || {})) add(id, "Рекорды");
  for (const id of Object.values(game.achievementImages || {}))
    add(id, "Достижения");
  // The native app settings (#338), enabled blocks or not.
  for (const id of mobileIds) add(id, "Мобильное приложение");
  return Object.fromEntries(
    [...usage].map(([id, labels]) => [id, [...labels]]),
  );
}

// Server usage is authoritative for published references. The browser also
// protects its unsaved draft; resetting a slot must not delete a live image.
export function assetUsageLabels(
  asset: { id: string; usage?: string[] },
  draft: AssetSettings = {},
  saved: AssetSettings = {},
) {
  const labels = new Set(asset.usage || []);
  if (siteAssetIds(saved).includes(asset.id)) labels.add("Опубликовано");
  if (siteAssetIds(draft).includes(asset.id))
    labels.add("В настройках / черновике");
  return [...labels];
}
