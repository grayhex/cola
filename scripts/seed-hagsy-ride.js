// Explicit operator import, also reused by the one-time demo migration.
import { readFile } from "node:fs/promises";
import { db, transaction } from "../lib/db.js";
import { seedHagsyRide } from "./hagsy-demo.js";
import { cleanupRides } from "../lib/ride-storage.js";
import { rideDetail } from "../lib/rides.js";
try {
  if (!process.argv[2]) throw Error("Specify a private GPX file path");
  const bytes = await readFile(process.argv[2]);
  const result = await transaction((q) =>
    seedHagsyRide(q, bytes, process.argv[3] || "road"),
  );
  await cleanupRides(db);
  const ride = await rideDetail(db, result.shareId, null);
  console.log(
    JSON.stringify({
      profile: "/u/hagsy_test",
      bike: "/b/" + ride.bike.shareId,
      ride: "/r/" + ride.shareId,
      metrics: ride.metrics,
    }),
  );
} finally {
  await db.end();
}
