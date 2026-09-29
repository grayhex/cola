import { db } from "../lib/db.js";
import { cleanupRides } from "../lib/ride-storage.js";
import { cleanupMarketPhotos } from "../lib/market.js";
import { cleanupJournalPhotos } from "../lib/journal-storage.js";
import { cleanupComponentPhotos } from "../lib/component-photos.js";
// Scheduled storage maintenance (#248): requests no longer clean storage, so
// run this periodically (docs/operations/monitoring.md). One bounded pass;
// a second concurrent run skips. The report holds counts only.
let rides;
try {
  rides = await cleanupRides(db);
  console.log(JSON.stringify({ event: "ride_storage_cleanup", ...rides }));
  await cleanupMarketPhotos(db, { orphans: true });
  await cleanupJournalPhotos(db, { orphans: true });
  await cleanupComponentPhotos(db, { orphans: true });
} finally {
  await db.end();
}
// Storage errors keep their queue rows for the next pass; a non-zero exit
// makes the scheduler show them instead of losing them silently.
if (!rides.skipped && (rides.gc.failed > 0 || rides.orphans.failed > 0))
  process.exitCode = 1;
