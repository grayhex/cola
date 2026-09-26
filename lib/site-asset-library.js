import { siteAssetUsage } from "./site-assets.js";

async function readUsage(q) {
  const site = await q.query("SELECT value FROM site_settings WHERE id=1");
  // Award and record illustrations live in their rules (#106), switched-off
  // rules included.
  const rules = await q.query(
    "SELECT key,kind,image_id FROM game_rules WHERE image_id IS NOT NULL",
  );
  const game = { recordImages: {}, achievementImages: {} };
  for (const rule of rules.rows)
    game[rule.kind === "record" ? "recordImages" : "achievementImages"][rule.key] =
      rule.image_id;
  return siteAssetUsage(site.rows[0]?.value, game);
}

export async function listAssetLibrary(q) {
  const usage = await readUsage(q);
  const { rows } = await q.query(
    "SELECT id,name,created_at FROM site_assets ORDER BY created_at DESC,id",
  );
  return rows.map((asset) => ({ ...asset, usage: usage[asset.id] || [] }));
}

// Must run inside a transaction. Match the sorted lock order in siteAssetIds
// and saveRules; re-read all published references AFTER taking locks.
export async function deleteUnusedAssets(q, requestedIds) {
  const ids = [...new Set(requestedIds.map((id) => id.toLowerCase()))].sort();
  const locked = await q.query(
    "SELECT id FROM site_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [ids],
  );
  const usage = await readUsage(q);
  const deletable = locked.rows.map((asset) => asset.id).filter((id) => !usage[id]);
  const deleted = deletable.length
    ? (await q.query(
        "DELETE FROM site_assets WHERE id=ANY($1::uuid[]) RETURNING id,filename",
        [deletable],
      )).rows
    : [];
  const deletedIds = new Set(deleted.map((asset) => asset.id));
  return { deleted, skippedIds: ids.filter((id) => !deletedIds.has(id)) };
}
