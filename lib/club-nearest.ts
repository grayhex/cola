import type { Queryable } from "./db.ts";
import {
  clubRideEnvelopeSql,
  internalClubRideSql,
} from "./club-ride-access.ts";
import { rideOccurrence } from "./ride-occurrence.ts";
/** A small header summary. Never a meeting point, rider roster or private bike. */
export async function nearestClubRide(
  q: Queryable,
  club: string,
  viewer: string | null,
) {
  const r = (
    await q.query<{ share_id: string; title: string; at: Date }>(
      `SELECT r.share_id,r.title,(${rideOccurrence}) at FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.club_id=$2 AND r.status='planned' AND NOT r.club_suspended AND NOT u.blocked AND (${rideOccurrence})>now() AND ${clubRideEnvelopeSql("$1")} AND (${internalClubRideSql("$1")} OR (r.is_public AND b.is_public)) ORDER BY (${rideOccurrence}),r.id LIMIT 1`,
      [viewer, club],
    )
  ).rows[0];
  return {
    viewerId: viewer,
    ride: r
      ? { href: "/r/" + r.share_id, title: r.title, at: r.at.toISOString() }
      : null,
  };
}
