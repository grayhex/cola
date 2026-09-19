import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { seedHagsyRide } from "../scripts/hagsy-demo.js";
import { rideDefaults } from "../lib/rides.js";

export const demoVersion = "013_hagsy_demo";
export const demoHash =
  "39223e5a5df062a81934dcba7d0a1d4a7be7fa8a3e196d63bd889fff29ed8bf1";
// Called within the migration transaction and its existing global advisory lock.
export async function migrateHagsyDemo(q) {
  const applied = await q.query(
    "SELECT 1 FROM schema_migrations WHERE version=$1",
    [demoVersion],
  );
  if (applied.rows.length) return null;
  const bytes = gunzipSync(
    await readFile(
      new URL("../scripts/fixtures/hagsy-demo.gpx.gz", import.meta.url),
    ),
    { maxOutputLength: 10 * 1024 * 1024 },
  );
  if (createHash("sha256").update(bytes).digest("hex") !== demoHash)
    throw Error("Demo GPX checksum mismatch");
  // This fixed, checksum-verified fixture must not prevent startup when an admin
  // changes upload policy. The site's live settings remain untouched.
  const ride = await seedHagsyRide(q, bytes, "road", {
    ...rideDefaults,
    enabled: true,
    maxGpxBytes: 10 * 1024 * 1024,
    maxPoints: 200000,
    maxRides: 2000,
    privacyRadii: [500],
    defaultRadius: 500,
  });
  await q.query("INSERT INTO schema_migrations(version) VALUES($1)", [
    demoVersion,
  ]);
  return ride;
}
