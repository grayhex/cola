// Real PostgreSQL verifies overlap, not PGlite's serial connection (#341): several
// workers walking one announcement, and several requests announcing one source,
// make each notice once and each announcement once.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  announceIntent,
  announcePlan,
  runNotificationFanout,
} from "../lib/notification-fanout.ts";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  statement_timeout: 20000,
});
const author = randomUUID();
const audience = Array.from({ length: 23 }, () => randomUUID());
const bike = randomUUID();
const ride = randomUUID();
const intent = randomUUID();
const hour = 3600_000;

try {
  for (const id of [author, ...audience])
    await pool.query(
      "INSERT INTO users(id,email,username,name,password_hash,email_verified_at) VALUES($1,$2,$3,'Fanout race','hash',now())",
      [id, id + "@example.test", "fan" + id.slice(0, 8)],
    );
  for (const id of audience)
    await pool.query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2),($2,$1)",
      [id, author],
    );
  await pool.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,weight,is_public) VALUES($1,$2,$1,'Fanout bike','Cube','Travel',2020,'road',14,true)",
    [bike, author],
  );
  await pool.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,source_hash,status,source_kind,has_track,meeting_point,started_at,is_public,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,meeting_visibility)
    VALUES($1,$1,$2,$3,'Fanout ride','planned:'||$1::uuid::text,'planned','planned',false,'Gate',now()+interval '2 days',true,0,0,0,'[]',500,'participants')`,
    [ride, author, bike],
  );
  await pool.query("UPDATE notification_limits SET batch=4");

  // Eight requests announcing one ride at once: one announcement.
  const made = await Promise.all(
    Array.from({ length: 8 }, () => announcePlan(pool, ride)),
  );
  assert.equal(made.filter(Boolean).length, 1, "one announcement of a ride");

  // Six workers walk it together, in pages of four: everyone is told once.
  const results = await Promise.all(
    Array.from({ length: 6 }, async () => {
      let recipients = 0;
      for (let round = 0; round < 30; round++) {
        const result = await runNotificationFanout(pool, { pages: 3 });
        recipients += result.recipients;
        if (!result.claimed) break;
      }
      return recipients;
    }),
  );
  assert.equal(
    results.reduce((a, b) => a + b, 0),
    audience.length,
    "every recipient exactly once across all workers",
  );
  const told = await pool.query(
    "SELECT recipient_id,count(*)::int n FROM notifications WHERE type='plan_published' AND ride_id=$1 GROUP BY recipient_id",
    [ride],
  );
  assert.equal(told.rowCount, audience.length);
  assert.ok(told.rows.every((row) => row.n === 1));
  assert.equal(
    told.rows.some((row) => row.recipient_id === author),
    false,
    "the author is never told",
  );
  const job = (
    await pool.query(
      "SELECT status,handled FROM notification_fanouts WHERE source_id=$1",
      [ride],
    )
  ).rows[0];
  assert.deepEqual(job, { status: "done", handled: audience.length });

  // An intent made public by two devices at once: one announcement, one notice each.
  await pool.query(
    `INSERT INTO ride_intents(id,owner_id,readiness,time_zone,passport,visibility,request_hash)
    VALUES($1,$2,'ready','Europe/Moscow','{}','community','hash')`,
    [intent, author],
  );
  await pool.query(
    "INSERT INTO ride_intent_windows(intent_id,starts_at,ends_at) VALUES($1,$2,$3)",
    [
      intent,
      new Date(Date.now() + 24 * hour),
      new Date(Date.now() + 26 * hour),
    ],
  );
  const intents = await Promise.all(
    Array.from({ length: 6 }, () => announceIntent(pool, intent)),
  );
  assert.equal(intents.filter(Boolean).length, 1);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let round = 0; round < 30; round++)
        if (!(await runNotificationFanout(pool, { pages: 3 })).claimed) break;
    }),
  );
  const intentNotices = await pool.query(
    "SELECT recipient_id,count(*)::int n FROM notifications WHERE type='intent_published' AND intent_id=$1 GROUP BY recipient_id",
    [intent],
  );
  assert.equal(intentNotices.rowCount, audience.length);
  assert.ok(intentNotices.rows.every((row) => row.n === 1));

  // A worker that died holding the lease: the work is not taken until it runs
  // out, then it is continued from the last recipient and nobody is told twice.
  const second = randomUUID();
  await pool.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,source_hash,status,source_kind,has_track,meeting_point,started_at,is_public,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,meeting_visibility)
    VALUES($1,$1,$2,$3,'Fanout ride 2','planned:'||$1::uuid::text,'planned','planned',false,'Gate',now()+interval '3 days',true,0,0,0,'[]',500,'participants')`,
    [second, author, bike],
  );
  assert.equal(await announcePlan(pool, second), true);
  const first = await runNotificationFanout(pool, { pages: 1 });
  assert.equal(first.claimed, 1);
  await pool.query(
    "UPDATE notification_fanouts SET lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' WHERE source_id=$1",
    [second],
  );
  assert.equal((await runNotificationFanout(pool, { pages: 1 })).claimed, 0);
  await pool.query(
    "UPDATE notification_fanouts SET lease_until=now()-interval '1 second' WHERE source_id=$1",
    [second],
  );
  for (let round = 0; round < 30; round++)
    if (!(await runNotificationFanout(pool, { pages: 3 })).claimed) break;
  // A burst of the same author within a quarter of an hour folds into the
  // unread notice (so there is one, not two), unless a boundary of the quarter
  // fell between the two rides.
  const unread = await pool.query(
    "SELECT recipient_id,count(*)::int n FROM notifications WHERE type='plan_published' GROUP BY recipient_id",
  );
  assert.equal(unread.rowCount, audience.length);
  assert.ok(unread.rows.every((row) => row.n >= 1 && row.n <= 2));
  console.log("notification fan-out concurrency checks passed");
} finally {
  await pool.end();
}
