import { db } from "../lib/db.js";
import { cleanupRides } from "../lib/ride-storage.js";
try {
  await cleanupRides(db);
} finally {
  await db.end();
}
