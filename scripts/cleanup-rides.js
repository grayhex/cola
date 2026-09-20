import { db } from "../lib/db.js";
import { cleanupRides } from "../lib/ride-storage.js";
import { cleanupJournalPhotos } from "../lib/journal-storage.js";
try {
  await cleanupRides(db);
  await cleanupJournalPhotos(db, { orphans: true });
} finally {
  await db.end();
}
