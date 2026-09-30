// Runs only against the disposable real PostgreSQL database in the HTTP CI group.
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { processActivityJob } from "../lib/activity-worker.ts";
import { disconnectActivity } from "../lib/activity-sync.ts";
import { sealActivityToken } from "../lib/activity-credentials.ts";
import { fit, loop } from "./ride-fixtures.js";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const tx = async (fn) => {
  const q = await db.connect();
  try {
    await q.query("BEGIN");
    const r = await fn(q);
    await q.query("COMMIT");
    return r;
  } catch (e) {
    await q.query("ROLLBACK");
    throw e;
  } finally {
    q.release();
  }
};
const owner = randomUUID(),
  bike = randomUUID(),
  connection = randomUUID(),
  activity = randomUUID(),
  jobId = randomUUID(),
  vendor = String(Math.floor(Math.random() * 1000000) + 2000000);
const realFetch = globalThis.fetch;
let arrivals = 0,
  release;
const gate = new Promise((r) => {
  release = r;
});
globalThis.fetch = async (url) => {
  if (String(url).endsWith(".json"))
    return Response.json({
      trip: {
        id: 1,
        user_id: Number(vendor),
        name: "Concurrent import",
        activity_type: "cycling:road",
        stationary: false,
        departed_at: new Date().toISOString(),
        distance: 1000,
        duration: 2400,
      },
    });
  arrivals++;
  if (arrivals === 2) release();
  await gate;
  return new Response(fit(loop));
};
try {
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Concurrent','hash',$2)",
    [owner, "c" + owner.replaceAll("-", "").slice(0, 20)],
  );
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,year,category) VALUES($1,$2,$1,'Concurrent',2026,'road')",
    [bike, owner],
  );
  await db.query(
    "INSERT INTO activity_connections(id,owner_id,provider,external_user_id,credentials,generation,import_since) VALUES($1,$2,'rwgps',$3,$4,$5,now()-interval '12 months')",
    [
      connection,
      owner,
      vendor,
      sealActivityToken("fixture-token", "rwgps:" + connection),
      randomUUID(),
    ],
  );
  await db.query(
    "INSERT INTO external_activities(id,owner_id,provider,external_user_id,external_id,event_at) VALUES($1,$2,'rwgps',$3,'1',now())",
    [activity, owner, vendor],
  );
  await db.query(
    "INSERT INTO activity_jobs(id,connection_id,external_id,action) VALUES($1,$2,'1','upsert')",
    [jobId, connection],
  );
  const job = (
    await db.query("SELECT * FROM activity_jobs WHERE id=$1", [jobId])
  ).rows[0];
  await Promise.all([
    processActivityJob(db, tx, job),
    processActivityJob(db, tx, job),
  ]);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
        owner,
      ])
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT * FROM activity_jobs WHERE id=$1", [jobId])).rows
      .length,
    0,
  );
  // A new event arriving during a fetch fences the stale worker revision.
  await db.query(
    "INSERT INTO activity_jobs(id,connection_id,external_id,action) VALUES($1,$2,'1','upsert')",
    [jobId, connection],
  );
  const old = (
    await db.query("SELECT * FROM activity_jobs WHERE id=$1", [jobId])
  ).rows[0];
  await db.query(
    "UPDATE activity_jobs SET action='deleted',revision=revision+1 WHERE id=$1",
    [jobId],
  );
  await processActivityJob(db, tx, old);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
        owner,
      ])
    ).rows[0].n,
    1,
  );
  await processActivityJob(
    db,
    tx,
    (await db.query("SELECT * FROM activity_jobs WHERE id=$1", [jobId]))
      .rows[0],
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
        owner,
      ])
    ).rows[0].n,
    0,
  );
  await tx((q) => disconnectActivity(q, owner));
  assert.equal(
    (
      await db.query("SELECT * FROM activity_revocations WHERE id=$1", [
        connection,
      ])
    ).rows.length,
    1,
  );
  console.log(
    "RWGPS PostgreSQL: concurrent workers produce one ride; revision fence and disconnect outbox passed.",
  );
} finally {
  globalThis.fetch = realFetch;
  await db.query("DELETE FROM users WHERE id=$1", [owner]);
  await db.query("DELETE FROM activity_revocations WHERE id=$1", [connection]);
  await db.end();
}
