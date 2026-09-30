// Runs only against the disposable real PostgreSQL database in the HTTP CI
// group: PGlite's single session cannot show two storage passes at once.
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanupRides, putOriginal } from "../lib/ride-storage.ts";

const dir = await mkdtemp(tmpdir() + "/cola-ride-gc-");
process.env.RIDES_DIR = dir;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});
const holder = await pool.connect();
const lock = 0x7269_6465;
try {
  const id = randomUUID();
  await putOriginal(id, Buffer.from("queued"));
  await pool.query(
    "INSERT INTO ride_file_gc(id,kind) VALUES($1,'ride') ON CONFLICT DO NOTHING",
    [id],
  );
  // Another pass holds the lock: this one skips and touches nothing.
  await holder.query("SELECT pg_advisory_lock($1)", [lock]);
  assert.deepEqual(await cleanupRides(pool), { skipped: true });
  await access(path.join(dir, `ride-${id}.gpx.gz`));
  await holder.query("SELECT pg_advisory_unlock($1)", [lock]);
  // Two passes started together: one runs, the other skips or runs after it;
  // the queued file is removed once and nothing fails.
  const [a, b] = await Promise.all([cleanupRides(pool), cleanupRides(pool)]);
  const ran = [a, b].filter((r) => !r.skipped);
  assert.ok(ran.length >= 1);
  assert.equal(
    ran.reduce((n, r) => n + r.gc.failed, 0),
    0,
  );
  await assert.rejects(access(path.join(dir, `ride-${id}.gpx.gz`)));
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM ride_file_gc WHERE id=$1", [
        id,
      ])
    ).rows[0].n,
    0,
  );
  // The lock is released after each pass.
  assert.equal(
    (await holder.query("SELECT pg_try_advisory_lock($1) ok", [lock])).rows[0]
      .ok,
    true,
  );
  await holder.query("SELECT pg_advisory_unlock($1)", [lock]);
  console.log("ride storage concurrency ok");
} finally {
  holder.release();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
}
