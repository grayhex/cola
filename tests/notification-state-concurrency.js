// Real PostgreSQL verifies overlap, not PGlite's serial connection (#341):
// what a person marks as read while notices arrive and while other requests
// mark the same ones, and settings changed from several devices at once.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  inboxWatermark,
  markNotificationsRead,
  unreadCount,
} from "../lib/notifications.ts";
import {
  notificationSettings,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
});
const env = { MAIL_CAPTURE_DIR: "/tmp/cola-notification-state" };
const [reader, marker, devices, guarded] = Array.from({ length: 4 }, () =>
  randomUUID(),
);

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function notice(recipient) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO notifications(id,recipient_id,actor_id,type,dedup_key) VALUES($1,$2,NULL,'session_reuse',$3)",
    [id, recipient, "session_reuse:" + id],
  );
  return id;
}
const unread = async (recipient) =>
  (
    await pool.query(
      "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND read_at IS NULL",
      [recipient],
    )
  ).rows[0].n;

try {
  for (const id of [reader, marker, devices, guarded])
    await pool.query(
      "INSERT INTO users(id,email,username,name,password_hash,email_verified_at) VALUES($1,$2,$3,'State race','hash',now())",
      [id, id + "@example.test", "state" + id.slice(0, 8)],
    );

  // ---- "Read all" while notices arrive ------------------------------------
  // Everything that is there when the list is drawn is read; whatever arrives
  // while the request runs is above the mark and stays unread, however the
  // two interleave.
  for (let i = 0; i < 30; i++) await notice(reader);
  const mark = await inboxWatermark(pool, reader);
  assert.ok(mark, "there is something to mark");
  const arrivals = Array.from({ length: 4 }, async () => {
    for (let i = 0; i < 5; i++) await notice(reader);
  });
  const [result] = await Promise.all([
    markNotificationsRead(pool, reader, { upTo: mark }),
    ...arrivals,
  ]);
  assert.equal(result.marked, 30);
  assert.equal(await unread(reader), 20, "the 20 that arrived stay unread");
  assert.equal((await unreadCount(pool, reader)).unread, 20);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND read_at IS NULL AND created_at<=$2::timestamptz",
        [reader, mark.createdAt],
      )
    ).rows[0].n,
    0,
    "nothing up to the mark is left",
  );

  // ---- Several requests mark the same notices -----------------------------
  // A notice is marked once, by one of them: the counts add up to the number
  // of notices, nobody deadlocks, and none is left.
  const ids = [];
  for (let i = 0; i < 40; i++) ids.push(await notice(marker));
  const upTo = await inboxWatermark(pool, marker);
  const shuffled = () => [...ids.slice(0, 25)].sort(() => Math.random() - 0.5);
  const outcomes = await Promise.all([
    ...Array.from({ length: 5 }, () =>
      markNotificationsRead(pool, marker, { upTo }),
    ),
    ...Array.from({ length: 5 }, () =>
      markNotificationsRead(pool, marker, { ids: shuffled() }),
    ),
    ...Array.from({ length: 2 }, () =>
      markNotificationsRead(pool, marker, { upTo, category: "site" }),
    ),
  ]);
  assert.equal(
    outcomes.reduce((total, outcome) => total + outcome.marked, 0),
    40,
    "each notice is marked exactly once",
  );
  assert.equal(await unread(marker), 0);
  const stamps = await pool.query(
    "SELECT count(DISTINCT id)::int n FROM notifications WHERE recipient_id=$1 AND read_at IS NOT NULL",
    [marker],
  );
  assert.equal(stamps.rows[0].n, 40);

  // ---- Settings changed from several devices at once ----------------------
  // Different switches do not undo each other, and the first change of an
  // account (the rows do not exist yet) does not fail for the others.
  const patches = [
    { channels: { email: { enabled: true } } },
    { categories: [{ key: "rides", email: true }] },
    { categories: [{ key: "market", email: true }] },
    { reminders: false },
    { categories: [{ key: "rides", push: false }] },
  ];
  const saves = await Promise.allSettled(
    [...patches, ...patches].map((patch) =>
      transaction((q) => saveNotificationSettings(q, devices, patch, { env })),
    ),
  );
  assert.deepEqual(
    saves.filter((save) => save.status === "rejected").map((s) => s.reason),
    [],
    "no change fails",
  );
  const settings = await notificationSettings(pool, devices, { env });
  assert.equal(settings.channels.email.enabled, true);
  assert.deepEqual(
    Object.fromEntries(
      settings.categories.map((c) => [c.key, c.email.enabled]),
    ),
    {
      rides: true,
      discussions: false,
      market: true,
      plans: false,
      intents: false,
    },
  );
  assert.equal(
    settings.categories.find((c) => c.key === "rides").push.enabled,
    false,
  );
  assert.equal(settings.reminders, false);
  assert.equal(
    (
      await pool.query(
        "SELECT ride_reminders FROM notification_email_preferences WHERE user_id=$1",
        [devices],
      )
    ).rows[0].ride_reminders,
    false,
    "the old flag follows for one release",
  );
  // Now the same again: nothing changes, so nothing moves.
  const settled = await transaction((q) =>
    saveNotificationSettings(q, devices, patches[0], { env }),
  );
  assert.equal(settled.version, settings.version);

  // ---- A precondition is checked against the state that is changed --------
  // Two edits made on the same version: one applies, the other is told the
  // object has changed (If-Match), and nothing of it is stored.
  const seen = await notificationSettings(pool, guarded, { env });
  const stale = (version) => {
    if (version !== seen.version) throw new Error("stale");
  };
  const edits = await Promise.allSettled([
    transaction((q) =>
      saveNotificationSettings(
        q,
        guarded,
        { reminders: false },
        { env, precondition: stale },
      ),
    ),
    transaction((q) =>
      saveNotificationSettings(
        q,
        guarded,
        { categories: [{ key: "market", email: true }] },
        { env, precondition: stale },
      ),
    ),
  ]);
  assert.equal(edits.filter((e) => e.status === "fulfilled").length, 1);
  const refused = edits.find((e) => e.status === "rejected");
  assert.equal(refused.reason.message, "stale");
  const final = await notificationSettings(pool, guarded, { env });
  const reminded = final.reminders === false;
  const marketOn = final.categories.find((c) => c.key === "market").email
    .enabled;
  assert.equal(
    [reminded, marketOn].filter(Boolean).length,
    1,
    "exactly one of the two edits is stored",
  );

  console.log(
    "Notification state PostgreSQL: read-all against arrivals, competing marks, parallel settings and the If-Match precondition passed.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [reader, marker, devices, guarded],
  ]);
  await pool.end();
}
