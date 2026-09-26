import { db } from "../lib/db.js";
import { cleanupRides } from "../lib/ride-storage.js";
import { cleanupMarketPhotos } from "../lib/market.js";
import { cleanupJournalPhotos } from "../lib/journal-storage.js";
import { cleanupComponentPhotos } from "../lib/component-photos.js";
try {
  await cleanupRides(db);
  await cleanupMarketPhotos(db, { orphans: true });
  await cleanupJournalPhotos(db, { orphans: true });
  await cleanupComponentPhotos(db, { orphans: true });
} finally {
  await db.end();
}
