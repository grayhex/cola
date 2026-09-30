import { db, transaction } from "../lib/db.ts";
import { rwgpsConfig } from "../lib/rwgps.ts";
import { runActivityBatch } from "../lib/activity-worker.ts";
import pg from "pg";

async function batch() {
  if (!rwgpsConfig()) return;
  const lock = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  await lock.connect();
  try {
    // Session advisory lock: one active worker, released even after a crash.
    if (
      !(await lock.query("SELECT pg_try_advisory_lock(741226) AS acquired"))
        .rows[0].acquired
    )
      return;
    try {
      await runActivityBatch(db, transaction);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(741226)");
    }
  } finally {
    await lock.end();
  }
}
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
  });
do {
  try {
    await batch();
  } catch {
    console.error(JSON.stringify({ event: "activity_sync_unavailable" }));
  }
  if (process.argv.includes("--once")) break;
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5000));
} while (!stopped);
await db.end();
