import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import { runNotificationEmailBatch } from "../lib/notification-email.ts";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const q = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const users = [];
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const session = r.headers.get("set-cookie");
    if (session) cookie = session.split(";")[0];
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
}
const owner = client(),
  actor = client(),
  guest = client();
const on = { enabled: true, discussions: true, rides: true, market: true };
try {
  assert.equal((await guest("account/notifications")).status, 401);
  for (const c of [owner, actor]) {
    assert.equal(
      (
        await c("auth/register", "POST", {
          ...testConsents,
          name: "Email outbox",
          email: randomUUID() + "@example.test",
          password: "notification-secret-123",
        })
      ).status,
      201,
    );
    users.push((await c("me")).body.user);
  }
  let prefs = await owner("account/notifications");
  assert.equal(prefs.status, 200);
  assert.equal(prefs.body.enabled, false);
  assert.equal(prefs.headers.get("cache-control"), "no-store");
  assert(!JSON.stringify(prefs.body).includes("unsubscribe_key"));
  assert.equal(
    (await owner("account/notifications", "PATCH", on, "https://evil.test"))
      .status,
    403,
  );
  assert.equal(
    (
      await owner("account/notifications", "PATCH", {
        ...on,
        userId: users[1].id,
      })
    ).status,
    400,
  );
  assert.equal((await owner("account/notifications", "PATCH", on)).status, 200);
  assert.equal((await actor("account/notifications")).body.enabled, false);
  const bike = (
    await owner("bikes", "POST", {
      name: "Email bike",
      brand: "Cube",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      is_public: true,
    })
  ).body.id;
  const add = () =>
    actor("community/bikes/" + bike + "/comments", "POST", {
      body: "Private comment body",
    });
  assert.equal((await add()).status, 201);
  const mail = [];
  let result = await runNotificationEmailBatch(q, {
    send: async (m) => mail.push(m),
  });
  assert.equal(result.sent, 1);
  assert.equal(mail[0].to, users[0].email);
  assert(!mail[0].text.includes("Private comment body"));
  const token = mail[0].text.match(/\/unsubscribe#([A-Za-z0-9_.-]+)/)?.[1];
  assert(token);
  assert.equal(
    (
      await guest(
        "notification-email/unsubscribe",
        "POST",
        { token },
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await guest("notification-email/unsubscribe", "POST", {
        token: token + "x",
      })
    ).status,
    400,
  );
  assert.equal(
    (await guest("notification-email/unsubscribe", "POST", { token })).status,
    200,
  );
  assert.equal((await owner("account/notifications")).body.enabled, false);
  assert.equal((await owner("account/notifications", "PATCH", on)).status, 200);
  assert.equal(
    (await guest("notification-email/unsubscribe", "POST", { token })).status,
    400,
    "renewed consent rotates old links",
  );
  await q.query(
    "UPDATE notifications SET dedup_key=dedup_key||':old',group_key=NULL WHERE recipient_id=$1",
    [users[0].id],
  );
  await add();
  await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
  await q.query(
    "UPDATE notification_email_preferences SET next_delivery_at=now() WHERE user_id=$1",
    [users[0].id],
  );
  result = await runNotificationEmailBatch(q, {
    send: async () => assert.fail("hidden target"),
  });
  assert.equal(result.skipped, 1);
  await q.query("UPDATE users SET blocked=true WHERE id=$1", [users[0].id]);
  assert.equal((await owner("account/notifications")).status, 401);
  console.log(
    "Notification email HTTP: opt-in, ownership, Origin, signed unsubscribe, renewed consent and live privacy passed.",
  );
} finally {
  await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await q.end();
}
