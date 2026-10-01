import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { notify, notificationPage } from "../lib/notifications.ts";
import { insertBike } from "../lib/repository.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
import {
  notificationEmailSettings,
  saveNotificationEmail,
  notificationUnsubscribeToken,
  unsubscribeNotificationEmail,
} from "../lib/notification-preferences.ts";
import {
  runNotificationEmailBatch,
  claimNotificationEmails,
  pruneNotificationEmails,
  notificationMailFailure,
} from "../lib/notification-email.ts";
const env = {
  MAIL_CAPTURE_DIR: "/tmp/cola-email-test",
  APP_ORIGIN: "https://cola.example.test",
};
const on = { enabled: true, discussions: true, rides: true, market: true };
async function setup() {
  const db = new PGlite();
  for (const file of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
    );
  await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultCatalog),
  ]);
  const recipient = randomUUID(),
    actor = randomUUID();
  for (const [id, name] of [
    [recipient, "receiver"],
    [actor, "writer"],
  ])
    await db.query(
      "INSERT INTO users(id,email,name,username,password_hash,email_verified_at) VALUES($1,$2,$3,$3,'hash',now())",
      [id, name + "@example.test", name],
    );
  const bike = await insertBike(db, recipient, {
    name: "Public <bike>",
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight: 14,
    is_public: true,
  });
  await saveNotificationEmail(db, recipient, on, env);
  const add = async () => {
    const comment = randomUUID();
    await db.query(
      "INSERT INTO bike_comments(id,bike_id,author_id,body) VALUES($1,$2,$3,'PRIVATE MESSAGE')",
      [comment, bike, actor],
    );
    const original = process.env.MAIL_CAPTURE_DIR;
    process.env.MAIL_CAPTURE_DIR = env.MAIL_CAPTURE_DIR;
    try {
      await notify(db, { recipient, actor, type: "comment", bike, comment });
    } finally {
      if (original === undefined) delete process.env.MAIL_CAPTURE_DIR;
      else process.env.MAIL_CAPTURE_DIR = original;
    }
    return (
      await db.query("SELECT id FROM notifications WHERE comment_id=$1", [
        comment,
      ])
    ).rows[0]?.id;
  };
  return { db, recipient, actor, bike, add };
}
async function ready(db) {
  await db.query(
    "UPDATE notification_email_outbox SET available_at=now(),lease_until=now()-interval '1 minute'",
  );
  await db.query(
    "UPDATE notification_email_preferences SET next_delivery_at=now()-interval '1 minute'",
  );
}
test("email events are atomic, deduplicated, opt-in, bounded and SMTP-independent in-app", async () => {
  const s = await setup();
  try {
    const id = await s.add();
    assert(id);
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      1,
    );
    const n = (
      await s.db.query("SELECT * FROM notifications WHERE id=$1", [id])
    ).rows[0];
    const old = process.env.MAIL_CAPTURE_DIR;
    process.env.MAIL_CAPTURE_DIR = env.MAIL_CAPTURE_DIR;
    try {
      await notify(s.db, {
        recipient: s.recipient,
        actor: s.actor,
        type: "comment",
        bike: s.bike,
        comment: n.comment_id,
      });
    } finally {
      if (old === undefined) delete process.env.MAIL_CAPTURE_DIR;
      else process.env.MAIL_CAPTURE_DIR = old;
    }
    assert.equal(
      (
        await s.db.query(
          "SELECT queued_count FROM notification_email_preferences",
        )
      ).rows[0].queued_count,
      1,
    );
    await assert.rejects(
      s.db.transaction(async (q) => {
        const created = randomUUID();
        await q.query(
          "INSERT INTO notifications(id,recipient_id,actor_id,type,dedup_key) VALUES($1,$2,$3,'follow',$1)",
          [created, s.recipient, s.actor],
        );
        await q.query(
          "SELECT cola_queue_notification_email($1,$2,'discussions')",
          [created, s.recipient],
        );
        throw new Error("rollback");
      }),
    );
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      1,
    );
    await s.db.query("UPDATE notification_email_preferences SET enabled=false");
    await s.db.query("UPDATE notifications SET dedup_key=dedup_key||':old'");
    await s.add();
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      1,
    );
    assert(
      (await notificationPage(s.db, s.recipient)).notifications.length >= 2,
    );
    assert.equal(
      (await runNotificationEmailBatch(s.db, { env: {} })).disabled,
      true,
    );
    // No body/address/token snapshot in the queue.
    assert(
      !JSON.stringify(
        (await s.db.query("SELECT * FROM notification_email_outbox")).rows,
      ).includes("PRIVATE MESSAGE"),
    );
  } finally {
    await s.db.close();
  }
});
test("queue budget is atomic and released when an event is deleted", async () => {
  const s = await setup();
  try {
    const id = await s.add(),
      comment = (
        await s.db.query("SELECT comment_id FROM notifications WHERE id=$1", [
          id,
        ])
      ).rows[0].comment_id;
    await s.db.query(
      `WITH created AS (INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key)
      SELECT gen_random_uuid(),$1,$2,'comment',$3,$4,'budget:'||i FROM generate_series(1,110) i RETURNING id,recipient_id)
      SELECT cola_queue_notification_email(id,recipient_id,'discussions') FROM created`,
      [s.recipient, s.actor, s.bike, comment],
    );
    assert.equal(
      (
        await s.db.query(
          "SELECT queued_count FROM notification_email_preferences",
        )
      ).rows[0].queued_count,
      100,
    );
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      100,
    );
    assert.equal(
      (await s.db.query("SELECT count(*)::int n FROM notifications")).rows[0].n,
      111,
    );
    await s.db.query("DELETE FROM notifications WHERE recipient_id=$1", [
      s.recipient,
    ]);
    assert.equal(
      (
        await s.db.query(
          "SELECT queued_count FROM notification_email_preferences",
        )
      ).rows[0].queued_count,
      0,
    );
  } finally {
    await s.db.close();
  }
});
test("actual SMTP transient and permanent replies drive retry and failure", async () => {
  const s = await setup();
  let code = 451,
    accepted = 0;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 relay.test ESMTP\r\n");
    let buffer = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            accepted++;
            socket.write("250 queued\r\n");
          }
          continue;
        }
        if (/^EHLO/i.test(line))
          socket.write("250-relay.test\r\n250 8BITMIME\r\n");
        else if (/^RCPT/i.test(line))
          socket.write(code === 250 ? "250 OK\r\n" : code + " rejected\r\n");
        else if (/^DATA/i.test(line)) {
          data = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const smtp = {
    APP_ORIGIN: env.APP_ORIGIN,
    SMTP_URL: `smtp://127.0.0.1:${server.address().port}?tls=none`,
    MAIL_FROM: "ColaBike <noreply@example.test>",
  };
  try {
    await s.add();
    assert.equal(
      (await runNotificationEmailBatch(s.db, { env: smtp })).retry,
      1,
    );
    assert.equal(accepted, 0);
    await ready(s.db);
    code = 250;
    assert.equal(
      (await runNotificationEmailBatch(s.db, { env: smtp })).sent,
      1,
    );
    assert.equal(accepted, 1);
    await s.db.query("UPDATE notifications SET dedup_key=dedup_key||':old'");
    await s.add();
    await ready(s.db);
    code = 550;
    assert.equal(
      (await runNotificationEmailBatch(s.db, { env: smtp })).failed,
      1,
    );
    assert.equal(accepted, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await s.db.close();
  }
});
test("signed unsubscribe has no login dependency, expires, resists tampering and respects renewed consent", async () => {
  const s = await setup();
  try {
    assert.equal(
      (await notificationEmailSettings(s.db, s.actor, env)).enabled,
      false,
    );
    await s.db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
      s.actor,
    ]);
    await assert.rejects(
      saveNotificationEmail(s.db, s.actor, on, env),
      (e) => e.status === 403,
    );
    await assert.rejects(
      saveNotificationEmail(s.db, s.recipient, on, {}),
      (e) => e.status === 503,
    );
    const key = (
      await s.db.query(
        "SELECT unsubscribe_key FROM notification_email_preferences WHERE user_id=$1",
        [s.recipient],
      )
    ).rows[0].unsubscribe_key;
    const token = notificationUnsubscribeToken(s.recipient, key);
    assert.equal(
      await unsubscribeNotificationEmail(s.db, token.slice(0, -2) + "xx"),
      false,
    );
    assert.equal(
      await unsubscribeNotificationEmail(
        s.db,
        token,
        new Date(Date.now() + 366 * 86400000),
      ),
      false,
    );
    assert.equal(await unsubscribeNotificationEmail(s.db, token), true);
    assert.equal(
      (await notificationEmailSettings(s.db, s.recipient, env)).enabled,
      false,
    );
    await saveNotificationEmail(s.db, s.recipient, on, env);
    assert.equal(await unsubscribeNotificationEmail(s.db, token), false);
    assert(
      !JSON.stringify(
        await notificationEmailSettings(s.db, s.recipient, env),
      ).includes(key),
    );
  } finally {
    await s.db.close();
  }
});
test("revoked consent cannot revive pending or leased mail when enabled again", async () => {
  for (const revoke of ["master", "category", "unsubscribe"]) {
    const s = await setup();
    try {
      await s.add();
      await s.db.query("UPDATE notifications SET dedup_key=dedup_key||':old'");
      await s.add();
      assert.equal((await claimNotificationEmails(s.db)).length, 1);
      if (revoke === "unsubscribe") {
        const key = (
          await s.db.query(
            "SELECT unsubscribe_key FROM notification_email_preferences WHERE user_id=$1",
            [s.recipient],
          )
        ).rows[0].unsubscribe_key;
        assert.equal(
          await unsubscribeNotificationEmail(
            s.db,
            notificationUnsubscribeToken(s.recipient, key),
          ),
          true,
        );
      } else {
        await saveNotificationEmail(
          s.db,
          s.recipient,
          {
            ...on,
            ...(revoke === "master"
              ? { enabled: false }
              : { discussions: false }),
          },
          env,
        );
      }
      await saveNotificationEmail(s.db, s.recipient, on, env);
      await ready(s.db);
      const result = await runNotificationEmailBatch(s.db, {
        env,
        send: async () => assert.fail("consent was revoked"),
      });
      assert.equal(result.claimed, 0, revoke);
      assert.equal(
        (
          await s.db.query(
            "SELECT queued_count FROM notification_email_preferences",
          )
        ).rows[0].queued_count,
        0,
      );
      assert.equal(
        (
          await s.db.query(
            "SELECT count(*)::int n FROM notification_email_outbox WHERE status='skipped' AND lease_token IS NULL",
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (await notificationPage(s.db, s.recipient)).notifications.length,
        2,
      );
      await s.db.query(
        "UPDATE notifications SET dedup_key=dedup_key||':older'",
      );
      await s.add();
      assert.equal(
        (await runNotificationEmailBatch(s.db, { env, send: async () => {} }))
          .sent,
        1,
        "new consent permits new events",
      );
    } finally {
      await s.db.close();
    }
  }
});
test("delivery rechecks visibility, address, consent and blocking, and never sends comment bodies", async () => {
  const s = await setup();
  try {
    await s.add();
    await s.db.query("UPDATE users SET email='new@example.test' WHERE id=$1", [
      s.recipient,
    ]);
    const sent = [];
    let result = await runNotificationEmailBatch(s.db, {
      env,
      send: async (m) => sent.push(m),
    });
    assert.equal(result.sent, 1);
    assert.equal(sent[0].to, "new@example.test");
    assert(!sent[0].text.includes("PRIVATE MESSAGE"));
    assert(sent[0].html.includes("Public &lt;bike&gt;"));
    assert(sent[0].text.includes("/unsubscribe#"));
    assert.equal(
      (
        await s.db.query(
          "SELECT queued_count FROM notification_email_preferences",
        )
      ).rows[0].queued_count,
      0,
    );
    for (const update of [
      "UPDATE bikes SET is_public=false",
      "UPDATE users SET blocked=true WHERE username='writer'",
      "UPDATE users SET email_verified_at=NULL WHERE username='receiver'",
      "UPDATE notification_email_preferences SET enabled=false",
    ]) {
      await s.db.query("UPDATE bikes SET is_public=true");
      await s.db.query(
        "UPDATE users SET blocked=false,email_verified_at=now()",
      );
      await saveNotificationEmail(s.db, s.recipient, on, env);
      await s.db.query("UPDATE notifications SET dedup_key=dedup_key||':old'");
      await s.add();
      await ready(s.db);
      await s.db.query(update);
      result = await runNotificationEmailBatch(s.db, {
        env,
        send: async () => assert.fail("privacy revoked"),
      });
      assert.equal(result.skipped, 1);
    }
  } finally {
    await s.db.close();
  }
});
test("retry, permanent failure, attempts exhaustion, lease recovery and retention are durable", async () => {
  const s = await setup();
  try {
    const id = await s.add();
    let calls = 0;
    let result = await runNotificationEmailBatch(s.db, {
      env,
      send: async () => {
        calls++;
        throw Object.assign(new Error("SECRET"), { responseCode: 451 });
      },
    });
    assert.equal(result.retry, 1);
    assert.equal(calls, 1);
    assert.equal(
      (
        await s.db.query(
          "SELECT status,error_code FROM notification_email_outbox",
        )
      ).rows[0].status,
      "pending",
    );
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async () => assert.fail("rate/backoff"),
        })
      ).claimed,
      0,
    );
    await ready(s.db);
    const claim = (await claimNotificationEmails(s.db))[0];
    assert.equal(claim.notification_id, id);
    assert.equal((await claimNotificationEmails(s.db)).length, 0);
    await ready(s.db);
    result = await runNotificationEmailBatch(s.db, {
      env,
      send: async () => {
        throw { responseCode: 550 };
      },
    });
    assert.equal(result.failed, 1);
    assert.equal(
      (
        await s.db.query(
          "SELECT queued_count FROM notification_email_preferences",
        )
      ).rows[0].queued_count,
      0,
    );
    await s.db.query("UPDATE notifications SET dedup_key=dedup_key||':old'");
    await s.add();
    await ready(s.db);
    await s.db.query(
      "UPDATE notification_email_outbox SET attempts=7 WHERE status='pending'",
    );
    result = await runNotificationEmailBatch(s.db, {
      env,
      send: async () => {
        throw { code: "ETIMEDOUT" };
      },
    });
    assert.equal(result.failed, 1);
    assert(
      !JSON.stringify(
        (await s.db.query("SELECT * FROM notification_email_outbox")).rows,
      ).includes("SECRET"),
    );
    await s.db.query(
      "UPDATE notification_email_outbox SET finished_at=now()-interval '31 days'",
    );
    await pruneNotificationEmails(s.db);
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      notificationMailFailure({ responseCode: 550 }),
      "smtp_permanent",
    );
    assert.equal(notificationMailFailure("unknown"), "smtp_temporary");
  } finally {
    await s.db.close();
  }
});
