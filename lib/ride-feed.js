import { showcase } from "./showcase.js";
import { rideList, effectiveRide, rideFrom } from "./rides.js";
export async function rideFeed(q, viewer, page = 1) {
  const source = `SELECT b.id,'bike' kind,b.published_at FROM bikes b JOIN users u ON u.id=b.owner_id JOIN user_follows f ON f.following_id=b.owner_id WHERE f.follower_id=$1 AND b.is_public AND NOT u.blocked UNION ALL SELECT r.id,'ride' kind,r.published_at${rideFrom} JOIN user_follows f ON f.following_id=r.owner_id WHERE f.follower_id=$1 AND ${effectiveRide}`;
  const total = (
    await q.query(
      "SELECT count(*)::int total FROM (" + source + ") publications",
      [viewer],
    )
  ).rows[0].total;
  const rows = (
    await q.query(
      "SELECT * FROM (" +
        source +
        ") publications ORDER BY published_at DESC,id LIMIT 24 OFFSET $2",
      [viewer, (page - 1) * 24],
    )
  ).rows;
  const bikeIds = rows.filter((r) => r.kind === "bike").map((r) => r.id),
    rideIds = rows.filter((r) => r.kind === "ride").map((r) => r.id);
  const [bikes, rides] = await Promise.all([
    bikeIds.length ? showcase(q, viewer, { ids: bikeIds }) : { bikes: [] },
    rideIds.length ? rideList(q, viewer, { ids: rideIds }) : { rides: [] },
  ]);
  const byId = new Map([...bikes.bikes, ...rides.rides].map((r) => [r.id, r]));
  return {
    items: rows
      .filter((r) => byId.has(r.id))
      .map((r) => ({ kind: r.kind, ...byId.get(r.id) })),
    bikes: bikes.bikes,
    total,
    page,
    pageSize: 24,
  };
}
