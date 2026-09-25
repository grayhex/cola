// An illustration assigned to any award or record, including a switched-off
// one, is protected from deletion in the media library.
export async function gameAssetInUse(q, id) {
  const result = await q.query(
    "SELECT 1 FROM game_rules WHERE image_id=$1 LIMIT 1",
    [id],
  );
  return result.rows.length > 0;
}
