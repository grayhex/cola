import type * as DbTypes from "./db.ts";
import type { SocialBike } from "./contracts.ts";
import type { RideViewRow } from "./database-rows.ts";
import type { JournalViewRow } from "./journal.ts";
import { marketList, marketPublic, marketApiCardsById } from "./market.ts";
import { showcase, visibleBikePage } from "./showcase.ts";
import {
  rideList,
  effectiveRide,
  rideFrom,
  apiRide,
  apiRideRowsById,
} from "./rides.ts";
import { journalCards, followsBike } from "./journal-discovery.ts";
import { journalPublic, journalFrom, journalRowsById } from "./journal.ts";
/**
 * The publications a person follows, as one SQL source of `(id, kind,
 * published_at)`: followed people's and bikes' public bikes, rides, journal
 * entries and listings. One definition for the site and API v1 (#328). `rideRule`
 * is the visibility of a ride: the site's own, or the API's (not called off).
 * `$1` is the viewer.
 */
export function feedSource(type: string, mode: string, rideRule: string) {
  const followed = followsBike();
  const bikesSource = `SELECT b.id,'bike' kind,coalesce(b.published_at,b.created_at) published_at FROM bikes b JOIN users u ON u.id=b.owner_id WHERE ${followed} AND b.is_public AND NOT u.blocked`;
  const entriesSource = `SELECT e.id,'journal' kind,coalesce(e.published_at,e.created_at) published_at${journalFrom} WHERE ${journalPublic} AND ($1::uuid IS NULL OR true) ${mode === "new" ? "" : "AND " + followed}`;
  const ridesSource = `SELECT r.id,'ride' kind,coalesce(r.published_at,r.created_at) published_at${rideFrom} WHERE ${followed} AND ${rideRule} ${type === "all" ? `AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.ride_id=r.id AND e.bike_id=b.id AND e.status='published' AND e.is_public)` : ""}`;
  const marketSource = `SELECT m.id,'market' kind,coalesce(m.published_at,m.created_at) published_at FROM market_listings m JOIN users u ON u.id=m.owner_id WHERE ${marketPublic} AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=m.owner_id)`;
  const source =
    type === "journal"
      ? entriesSource
      : type === "rides"
        ? ridesSource
        : [bikesSource, ridesSource, entriesSource, marketSource].join(
            " UNION ALL ",
          );
  return source;
}
export async function rideFeed(
  q: DbTypes.Queryable,
  viewer: string | null | undefined,
  page = 1,
  type = "all",
  mode = "following",
) {
  const source = feedSource(type, mode, effectiveRide);
  const total = (
    await q.query<{ total: number }>(
      "SELECT count(*)::int total FROM (" + source + ") publications",
      [viewer],
    )
  ).rows[0].total;
  const rows = (
    await q.query<{
      id: string;
      kind: "bike" | "ride" | "journal" | "market";
      published_at: Date;
    }>(
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
  const cards = [
    ...bikes.bikes.map((item) => ({ ...item, kind: "bike" as const })),
    ...rides.rides.map((item) => ({ ...item, kind: "ride" as const })),
    ...entries.map((item) => ({
      ...item,
      kind: "journal" as const,
      entryKind: item.kind,
    })),
    ...listings.map((item) => ({ ...item, kind: "market" as const })),
  ];
  const byId = new Map(cards.map((item) => [item.id, item]));
  return {
    items: rows.filter((r) => byId.has(r.id)).map((r) => byId.get(r.id)!),
    bikes: bikes.bikes,
    total,
    page,
    pageSize: 24,
  };
}

export type FeedEntry = { at: string } & (
  | { kind: "bike"; bike: SocialBike }
  | { kind: "ride"; ride: RideViewRow }
  | { kind: "journal"; entry: JournalViewRow }
  | {
      kind: "market";
      listing: Awaited<ReturnType<typeof marketApiCardsById>>[number];
    }
);
/**
 * The same feed for API v1 (#327): what the person follows, newest first by
 * `(published_at, id)` and a cursor instead of OFFSET. Which publications
 * qualify is `feedSource` (the site's rule, with rides that were called off
 * left out); each page is then read again under the viewer's own visibility, so
 * an item hidden in between is skipped, never shown stale.
 */
export async function feedKeysetPage(
  q: DbTypes.Queryable,
  viewer: string,
  {
    type,
    limit,
    after,
  }: {
    type: "all" | "rides" | "journal";
    limit: number;
    after: { createdAt: string; id: string } | null;
  },
) {
  const picked = (
    await q.query<{
      id: string;
      kind: "bike" | "ride" | "journal" | "market";
      cursor_at: string;
    }>(
      `SELECT id,kind,to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM (${feedSource(type, "following", apiRide)}) publications
       WHERE ($2::timestamptz IS NULL OR published_at<$2::timestamptz OR (published_at=$2::timestamptz AND id>$3::uuid))
       ORDER BY published_at DESC,id LIMIT $4`,
      [viewer, after?.createdAt ?? null, after?.id ?? null, limit + 1],
    )
  ).rows;
  const rows = picked.slice(0, limit),
    last = rows[rows.length - 1];
  const idsOf = (kind: string) =>
    rows.filter((r) => r.kind === kind).map((r) => r.id);
  const bikeIds = idsOf("bike");
  const [bikes, rides, entries, listings] = await Promise.all([
    bikeIds.length
      ? visibleBikePage(q, viewer, {
          scope: "public",
          categories: [],
          search: "",
          limit: bikeIds.length,
          after: null,
          refine: (params) => {
            params.push(bikeIds);
            return ` AND b.id=ANY($${params.length}::uuid[])`;
          },
        }).then((page) => page.bikes)
      : [],
    apiRideRowsById(q, idsOf("ride"), viewer),
    journalRowsById(q, idsOf("journal"), viewer),
    marketApiCardsById(q, idsOf("market"), viewer),
  ]);
  const byId = <T extends { id: string }>(list: T[]) =>
    new Map(list.map((item) => [item.id, item]));
  const found = {
    bike: byId(bikes),
    ride: byId(rides),
    journal: byId(entries),
    market: byId(listings),
  };
  const items = rows.flatMap((r): FeedEntry[] => {
    if (r.kind === "bike") {
      const bike = found.bike.get(r.id);
      return bike ? [{ at: r.cursor_at, kind: "bike" as const, bike }] : [];
    }
    if (r.kind === "ride") {
      const ride = found.ride.get(r.id);
      return ride ? [{ at: r.cursor_at, kind: "ride" as const, ride }] : [];
    }
    if (r.kind === "journal") {
      const entry = found.journal.get(r.id);
      return entry
        ? [{ at: r.cursor_at, kind: "journal" as const, entry }]
        : [];
    }
    const listing = found.market.get(r.id);
    return listing
      ? [{ at: r.cursor_at, kind: "market" as const, listing }]
      : [];
  });
  return {
    items,
    next:
      picked.length > limit && last
        ? { createdAt: last.cursor_at, id: last.id }
        : null,
  };
}
