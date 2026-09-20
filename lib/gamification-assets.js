export function gamificationAssetIds(value = {}) {
  return [...new Set([
    ...Object.values(value.recordImages || {}),
    ...Object.values(value.achievementImages || {}),
  ].filter((id) => typeof id === "string" && id))].sort();
}

// Called within the save transaction. Asset deletion takes FOR UPDATE on the
// same rows, so an assigned file cannot disappear between validation and commit.
export async function gameAssetsExist(q, value) {
  const ids = gamificationAssetIds(value);
  if (!ids.length) return true;
  const result = await q.query(
    "SELECT id FROM site_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [ids],
  );
  return result.rows.length === ids.length;
}

export async function gameAssetInUse(q, id) {
  const result = await q.query("SELECT value FROM gamification_settings WHERE id=1");
  return gamificationAssetIds(result.rows[0]?.value).includes(id);
}

// Decorate only DTOs that already passed publication/privacy checks. No
// identity, progress or holder is reconstructed from illustration settings.
export function withGameArtwork(data, settings) {
  const result = { ...data };
  for (const [field, images] of [
    ["records", settings.recordImages],
    ["awards", settings.achievementImages],
    ["locked", settings.achievementImages],
  ]) {
    if (Array.isArray(data[field]))
      result[field] = data[field].map((item) => ({ ...item, imageId: images?.[item.key] || null }));
  }
  return result;
}
