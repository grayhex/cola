import type { Queryable } from "./db.ts";
export async function reorderComponents(
  q: Queryable,
  bikeId: string,
  ids: string[],
) {
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    bikeId,
  ]);
  const { rows } = await q.query<{ id: string }>(
    "SELECT id FROM components WHERE bike_id=$1",
    [bikeId],
  );
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    rows.some((r) => !ids.includes(r.id))
  )
    return false;
  for (let i = 0; i < ids.length; i++)
    await q.query(
      "UPDATE components SET sort_order=$1 WHERE id=$2 AND bike_id=$3",
      [i, ids[i], bikeId],
    );
  return true;
}
