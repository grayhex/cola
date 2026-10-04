// Real PostgreSQL verifies overlap, not PGlite's serial connection (#342):
// several workers drawing from one queue send each message once, a worker that
// died with a lease holds nothing back, and two sessions that register one
// address at once leave it to exactly one of them.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { createDeviceSession } from "../lib/device-sessions.ts";
import {
  claimPushDeliveries,
  materializePushDeliveries,
  runPushBatch,
} from "../lib/push-delivery.ts";
import { registerPushDevice } from "../lib/push-devices.ts";

const env = {
  NODE_ENV: "test",
  PUSH_TOKEN_KEY: randomBytes(32).toString("base64"),
  RUSTORE_PUSH_PROJECTS: "project-a",
  RUSTORE_PUSH_SERVICE_TOKEN: "service-secret",
};
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  statement_timeout: 20000,
});
const person = randomUUID();
const author = randomUUID();
const bike = randomUUID();
const total = 30;

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  for (const id of [person, author])
    await pool.query(
      "INSERT INTO users(id,email,username,name,password_hash,email_verified_at) VALUES($1,$2,$3,'Push race','hash',now())",
      [id, id + "@example.test", "push" + id.slice(0, 8)],
    );
  await pool.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,weight,is_public) VALUES($1,$2,$1,'Push bike','Cube','Travel',2020,'road',14,true)",
    [bike, person],
  );
  const grant = await createDeviceSession(
    pool,
    person,
    { name: "Pixel", platform: "android", appVersion: "1.0" },
    "test",
  );
  await transaction((q) =>
    registerPushDevice(
      q,
      {
        userId: person,
        sessionId: grant.sessionId,
        installationId: randomUUID(),
        provider: "rustore",
        projectId: "project-a",
        token: "address-" + randomUUID(),
      },
      env,
    ),
  );
  await pool.query(
    "INSERT INTO notification_settings(user_id,push_enabled,push_enabled_at) VALUES($1,true,now()) ON CONFLICT(user_id) DO UPDATE SET push_enabled=true,push_enabled_at=now()",
    [person],
  );
  for (let index = 0; index < total; index++) {
    const comment = randomUUID();
    await pool.query(
      "INSERT INTO bike_comments(id,bike_id,author_id,body) VALUES($1,$2,$3,'Привет')",
      [comment, bike, author],
    );
    const id = randomUUID();
    await pool.query(
      "INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key) VALUES($1,$2,$3,'comment',$4,$5,$6)",
      [id, person, author, bike, comment, id],
    );
  }

  // Four workers materialize the same events at once: one message for each.
  await Promise.all(
    Array.from({ length: 4 }, () => materializePushDeliveries(pool)),
  );
  const made = await pool.query("SELECT count(*)::int n FROM push_deliveries");
  assert.equal(made.rows[0].n, total, "one message for each event");

  // Six workers draw from the queue: every message is claimed once.
  const claimed = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const mine = [];
      for (;;) {
        const jobs = await claimPushDeliveries(pool, new Date(), 3);
        if (!jobs.length) return mine;
        mine.push(...jobs.map((job) => job.id));
      }
    }),
  );
  const all = claimed.flat();
  assert.equal(all.length, total, "every message claimed");
  assert.equal(new Set(all).size, total, "and none claimed twice");
  assert.ok(
    claimed.filter((jobs) => jobs.length).length > 1,
    "the work was shared",
  );

  // A worker that died holding leases: after the lease runs out, another one
  // sends them, once, and a live worker's leases are left alone.
  const sent = [];
  const transport = {
    async send(message) {
      sent.push(message.data);
      return { kind: "accepted" };
    },
  };
  const live = await runPushBatch(pool, { env, transport, limit: 5 });
  assert.equal(live.claimed, 0, "leases that are still held are not taken");
  const after = new Date(Date.now() + 5 * 60_000);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      runPushBatch(pool, { env, transport, now: after, limit: 30 }),
    ),
  );
  assert.equal(
    results.reduce((sum, result) => sum + result.sent, 0),
    sent.length,
  );
  assert.equal(sent.length, total, "each message sent once after the lease");
  assert.equal(new Set(sent).size, total);
  const done = await pool.query(
    "SELECT status,count(*)::int n FROM push_deliveries GROUP BY status",
  );
  assert.deepEqual(done.rows, [{ status: "sent", n: total }]);

  // Two sessions register one address at once: it ends with exactly one.
  const other = await createDeviceSession(
    pool,
    person,
    { name: "Tablet", platform: "android", appVersion: "1.0" },
    "test",
  );
  const shared = "shared-" + randomUUID();
  const attempts = await Promise.allSettled(
    [grant.sessionId, other.sessionId].map((sessionId) =>
      transaction((q) =>
        registerPushDevice(
          q,
          {
            userId: person,
            sessionId,
            installationId: randomUUID(),
            provider: "rustore",
            projectId: "project-a",
            token: shared,
          },
          env,
        ),
      ),
    ),
  );
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    2,
    "both are answered",
  );
  const live2 = await pool.query(
    "SELECT count(*)::int n FROM push_devices WHERE revoked_at IS NULL AND token_hash=encode(sha256($1::bytea),'hex')",
    [shared],
  );
  assert.equal(live2.rows[0].n, 1, "one live holder of an address");

  console.log(
    "Push delivery concurrency: one message per event, shared claims, expired leases recovered once, one holder of an address passed.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [person, author],
  ]);
  await pool.end();
}
