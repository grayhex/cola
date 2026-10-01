// Real PostgreSQL verifies overlap, not PGlite's serial connection.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  claimNotificationEmails,
  runNotificationEmailBatch,
} from "../lib/notification-email.ts";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
});
const recipient = randomUUID(),
  actor = randomUUID(),
  bike = randomUUID(),
  comment = randomUUID();
try {
  for (const id of [recipient, actor])
    await pool.query(
      "INSERT INTO users(id,email,username,name,password_hash,email_verified_at) VALUES($1,$2,$3,'Queue race','hash',now())",
      [id, id + "@example.test", "queue" + id.slice(0, 8)],
    );
  await pool.query(
    "INSERT INTO notification_email_preferences(user_id,enabled,discussions) VALUES($1,true,true)",
    [recipient],
  );
  await pool.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,weight,is_public) VALUES($1,$2,$1,'Queue bike','Cube','Travel',2020,'road',14,true)",
    [bike, recipient],
  );
  await pool.query(
    "INSERT INTO bike_comments(id,bike_id,author_id,body) VALUES($1,$2,$3,'Race')",
    [comment, bike, actor],
  );
  const a = await pool.connect(),
    b = await pool.connect();
  try {
    await a.query("BEGIN");
    const event = randomUUID();
    await a.query(
      "INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key) VALUES($1,$2,$3,'comment',$4,$5,$1::text)",
      [event, recipient, actor, bike, comment],
    );
    await a.query("SELECT cola_queue_notification_email($1,$2,'discussions')", [
      event,
      recipient,
    ]);
    await a.query("COMMIT");
    await a.query("BEGIN");
    const first = await claimNotificationEmails(a);
    assert.equal(first.length, 1);
    const second = await claimNotificationEmails(b);
    assert.equal(second.length, 0, "second worker skips a held job");
    await a.query("COMMIT");
    assert.equal(
      (await claimNotificationEmails(b)).length,
      0,
      "active lease/rate budget survives a restart",
    );
    await pool.query(
      "UPDATE notification_email_outbox SET lease_until=now()-interval '1 minute' WHERE notification_id=$1",
      [event],
    );
    await pool.query(
      "UPDATE notification_email_preferences SET next_delivery_at=now()-interval '1 minute' WHERE user_id=$1",
      [recipient],
    );
    const recovered = await claimNotificationEmails(b);
    assert.equal(recovered.length, 1);
    assert.notEqual(recovered[0].lease_token, first[0].lease_token);
    const stale = await a.query(
      "UPDATE notification_email_outbox SET status='sent' WHERE notification_id=$1 AND lease_token=$2 RETURNING notification_id",
      [event, first[0].lease_token],
    );
    assert.equal(stale.rowCount, 0);
    await pool.query(
      "UPDATE notification_email_outbox SET lease_until=now()-interval '1 minute' WHERE notification_id=$1",
      [event],
    );
    await pool.query(
      "UPDATE notification_email_preferences SET next_delivery_at=now()-interval '1 minute' WHERE user_id=$1",
      [recipient],
    );
    let sent = 0;
    const results = await Promise.all([
      runNotificationEmailBatch(a, {
        send: async () => {
          sent++;
        },
      }),
      runNotificationEmailBatch(b, {
        send: async () => {
          sent++;
        },
      }),
    ]);
    assert.equal(sent, 1);
    assert.equal(
      results.reduce((n, r) => n + r.sent, 0),
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT queued_count FROM notification_email_preferences WHERE user_id=$1",
          [recipient],
        )
      ).rows[0].queued_count,
      0,
    );
  } finally {
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
    a.release();
    b.release();
  }
  console.log(
    "Notification email PostgreSQL: held claims, competing workers, restart, expired lease and stale-token fencing passed.",
  );
} finally {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [recipient, actor],
  ]);
  await pool.end();
}
