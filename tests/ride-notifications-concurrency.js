// Real PostgreSQL: workers cannot observe an uncommitted RSVP or duplicate its reminder.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  planInput,
  planRide,
  rideDefaults,
  respondRide,
  cancelPlannedRide,
} from "../lib/rides.ts";
import { releaseRideReminders } from "../lib/ride-notifications.ts";
import {
  claimNotificationEmails,
  runNotificationEmailBatch,
} from "../lib/notification-email.ts";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
  statement_timeout: 10000,
});
const owner = randomUUID(),
  rider = randomUUID(),
  bike = randomUUID();
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
try {
  for (const id of [owner, rider])
    await pool.query(
      "INSERT INTO users(id,email,username,name,password_hash,email_verified_at) VALUES($1,$2,$3,'Reminder race','hash',now())",
      [id, id + "@example.test", "rem" + id.slice(0, 8)],
    );
  await pool.query(
    "INSERT INTO notification_email_preferences(user_id,enabled,rides) VALUES($1,true,true)",
    [rider],
  );
  await pool.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,weight,is_public) VALUES($1,$2,$1,'Reminder bike','Cube','Travel',2020,'road',14,true)",
    [bike, owner],
  );
  const start = new Date(
    Math.ceil((Date.now() + 2 * 3600000) / 60000) * 60000,
  ).toISOString();
  const create = () =>
    tx((q) =>
      planRide(
        q,
        owner,
        planInput.parse({
          bikeId: bike,
          title: "Race",
          scheduledAt: start,
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
        }),
        rideDefaults,
      ),
    );
  const ride = await create(),
    a = await pool.connect(),
    b = await pool.connect();
  try {
    await a.query("BEGIN");
    await respondRide(a, ride.id, rider, "accepted", start);
    await releaseRideReminders(b);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM notifications WHERE ride_id=$1 AND type='ride_reminder'",
          [ride.id],
        )
      ).rows[0].n,
      0,
      "uncommitted schedule is invisible to workers",
    );
    await a.query("COMMIT");
    await Promise.all([releaseRideReminders(a), releaseRideReminders(b)]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.ride_id=$1 AND n.type='ride_reminder'",
          [ride.id],
        )
      ).rows[0].n,
      1,
    );
    let sent = 0;
    await Promise.all(
      [a, b].map((q) =>
        runNotificationEmailBatch(q, {
          send: async () => {
            sent++;
          },
        }),
      ),
    );
    assert.equal(
      sent,
      1,
      "competing workers share one occurrence/revision event",
    );
    assert.equal(
      (
        await runNotificationEmailBatch(b, {
          send: async () => assert.fail("restart duplicate"),
        })
      ).sent,
      0,
    );
    // A domain mutation holds users before notifications. The worker must
    // skip that recipient before inserting FK-bound events/outbox, not hold a
    // notice and wait for the user's lock while the mutation waits for it.
    const withdrawing = await create();
    await tx((q) => respondRide(q, withdrawing.id, rider, "accepted", start));
    await a.query("BEGIN");
    await a.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [rider]);
    await releaseRideReminders(b);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.ride_id=$1",
          [withdrawing.id],
        )
      ).rows[0].n,
      0,
    );
    await respondRide(a, withdrawing.id, rider, "declined", start);
    await a.query("COMMIT");
    await releaseRideReminders(b);
    assert.equal(
      (
        await b.query(
          "SELECT count(*)::int n FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.ride_id=$1",
          [withdrawing.id],
        )
      ).rows[0].n,
      0,
    );
    // Domain cancellation fences an already claimed lease. A stale worker has
    // no notification to send, and cannot acknowledge with its old token.
    const cancelled = await create();
    await tx((q) => respondRide(q, cancelled.id, rider, "accepted", start));
    await releaseRideReminders(b);
    await pool.query(
      "UPDATE notification_email_preferences SET next_delivery_at=now() WHERE user_id=$1",
      [rider],
    );
    const [lease] = await claimNotificationEmails(b);
    assert(lease);
    await tx((q) => cancelPlannedRide(q, cancelled.id, owner));
    const job = (
      await pool.query(
        "SELECT status,lease_token FROM notification_email_outbox WHERE notification_id=$1",
        [lease.notification_id],
      )
    ).rows[0];
    assert.equal(job.status, "skipped");
    assert.equal(job.lease_token, null);
    assert.equal(
      (
        await a.query(
          "UPDATE notification_email_outbox SET status='sent' WHERE notification_id=$1 AND lease_token=$2 RETURNING notification_id",
          [lease.notification_id, lease.lease_token],
        )
      ).rowCount,
      0,
    );
    await pool.query(
      "UPDATE notification_email_preferences SET next_delivery_at=now() WHERE user_id=$1",
      [rider],
    );
    const messages = [];
    await runNotificationEmailBatch(b, { send: async (m) => messages.push(m) });
    assert.equal(messages.length, 1);
    assert(messages[0].subject.includes("отменена"));
  } finally {
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
    a.release();
    b.release();
  }
  console.log(
    "Ride notification PostgreSQL: uncommitted RSVP, two schedulers, competing senders, restart, recipient lock vs withdrawal and cancellation of a leased reminder passed.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner, rider],
  ]);
  await pool.end();
}
