// An illustration assigned to any award or record, including a switched-off
// one, is protected from deletion in the media library.
export async function gameAssetInUse(q, id) {
  const result = await q.query(
    "SELECT 1 FROM game_rules WHERE image_id=$1 LIMIT 1",
    [id],
  );
  return result.rows.length > 0;
}

// Historical same-site asset paths and current IDs refer to the same immutable
// file. Do not turn arbitrary URLs into image requests.
export function gameArtworkSource(value, size = 40) {
  if (typeof value !== "string") return null;
  const match =
    /^(?:\/api\/assets\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?width=(?:160|320|640|1280))?$/i.exec(
      value,
    );
  if (!match) return null;
  const width = size * 3 <= 160 ? 160 : 320;
  return `/api/assets/${match[1]}?width=${width}`;
}
