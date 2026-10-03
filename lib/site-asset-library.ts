import type { SiteSettings as SiteSettingsType } from "./contracts.ts";
import type { Queryable } from "./db.ts";
import type { SiteAssetRow } from "./database-rows.ts";
import { siteAssetUsage } from "./site-assets.ts";
import { assetFormat } from "./hero-graphics.ts";
import { mobileAssetIds } from "./mobile-config.ts";

async function readUsage(q: Queryable) {
  const site = await q.query<{ value: Partial<SiteSettingsType> }>(
    "SELECT value FROM site_settings WHERE id=1",
  );
  // Award and record illustrations live in their rules (#106), switched-off
  // rules included.
  const rules = await q.query<{ key: string; kind: string; image_id: string }>(
    "SELECT key,kind,image_id FROM game_rules WHERE image_id IS NOT NULL",
  );
  const game: {
    recordImages: Record<string, string>;
    achievementImages: Record<string, string>;
  } = { recordImages: {}, achievementImages: {} };
  for (const rule of rules.rows)
    game[rule.kind === "record" ? "recordImages" : "achievementImages"][
      rule.key
    ] = rule.image_id;
  const mobile = await q.query<{ value: unknown }>(
    "SELECT value FROM mobile_settings WHERE id=1",
  );
  return siteAssetUsage(
    site.rows[0]?.value,
    game,
    mobileAssetIds(mobile.rows[0]?.value),
  );
}

export async function listAssetLibrary(q: Queryable) {
  const usage = await readUsage(q);
  const { rows } = await q.query<SiteAssetRow>(
    "SELECT id,name,filename,created_at FROM site_assets ORDER BY created_at DESC,id",
  );
  return rows.map(({ filename, ...asset }) => ({
    ...asset,
    format: assetFormat(filename),
    usage: usage[asset.id] || [],
  }));
}

// Must run inside a transaction. Match the sorted lock order in siteAssetIds
// and saveRules; re-read all published references AFTER taking locks.
export async function deleteUnusedAssets(q: Queryable, requestedIds: string[]) {
  const ids = [
    ...new Set(requestedIds.map((id: string) => id.toLowerCase())),
  ].sort();
  const locked = await q.query<{ id: string }>(
    "SELECT id FROM site_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [ids],
  );
  const usage = await readUsage(q);
  const deletable = locked.rows
    .map((asset) => asset.id)
    .filter((id: string) => !usage[id]);
  const deleted = deletable.length
    ? (
        await q.query<{ id: string; filename: string }>(
          "DELETE FROM site_assets WHERE id=ANY($1::uuid[]) RETURNING id,filename",
          [deletable],
        )
      ).rows
    : [];
  const deletedIds = new Set(deleted.map((asset) => asset.id));
  return {
    deleted,
    skippedIds: ids.filter((id: string) => !deletedIds.has(id)),
  };
}
