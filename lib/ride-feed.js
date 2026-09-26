import { marketList, marketPublic } from "./market.js";
import { showcase } from "./showcase.js";
import { rideList, effectiveRide, rideFrom } from "./rides.js";
import { journalCards, followsBike } from "./journal-discovery.js";
import { journalPublic, journalFrom } from "./journal.js";
export async function rideFeed(
  q,
  viewer,
  page = 1,
  type = "all",
  mode = "following",
) {
  const followed = followsBike();
  const bikesSource = `SELECT b.id,'bike' kind,b.published_at FROM bikes b JOIN users u ON u.id=b.owner_id WHERE ${followed} AND b.is_public AND NOT u.blocked`;
  const entriesSource = `SELECT e.id,'journal' kind,e.published_at${journalFrom} WHERE ${journalPublic} AND ($1::uuid IS NULL OR true) ${mode === "new" ? "" : "AND " + followed}`;
  const ridesSource = `SELECT r.id,'ride' kind,r.published_at${rideFrom} WHERE ${followed} AND ${effectiveRide} ${type === "all" ? `AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.ride_id=r.id AND e.bike_id=b.id AND e.status='published' AND e.is_public)` : ""}`;
  const marketSource = `SELECT m.id,'market' kind,m.published_at FROM market_listings m JOIN users u ON u.id=m.owner_id WHERE ${marketPublic} AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=m.owner_id)`;
  const source =
    type === "journal"
      ? entriesSource
      : type === "rides"
        ? ridesSource
        : [bikesSource, ridesSource, entriesSource, marketSource].join(
            " UNION ALL ",
          );
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
  const [bikes, rides, entries] = await Promise.all([
    bikeIds.length ? showcase(q, viewer, { ids: bikeIds }) : { bikes: [] },
    rideIds.length ? rideList(q, viewer, { ids: rideIds }) : { rides: [] },
    journalCards(
      q,
      rows.filter((r) => r.kind === "journal").map((r) => r.id),
      viewer,
    ),
  ]);
  const marketIds = rows.filter((r) => r.kind === "market").map((r) => r.id);
  const listings = marketIds.length
    ? (await marketList(q, viewer, { ids: marketIds })).items
    : [];
  const byId = new Map(
    [...bikes.bikes, ...rides.rides, ...entries, ...listings].map((r) => [
      r.id,
      r,
    ]),
  );
  return {
    items: rows
      .filter((r) => byId.has(r.id))
      .map((r) => ({
        ...byId.get(r.id),
        kind: r.kind,
        ...(r.kind === "journal" ? { entryKind: byId.get(r.id).kind } : {}),
      })),
    bikes: bikes.bikes,
    total,
    page,
    pageSize: 24,
  };
}
