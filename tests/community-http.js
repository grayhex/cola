import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3100",
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
function client() {
  let cookie = "";
  return async (url, method = "GET", data, origin = base) => {
    const r = await fetch(base + "/api/" + url, {
      method,
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const a = client(),
  b = client(),
  admin = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8),
  ids = [],
  who = [];
const input = {
  name: "Community " + nonce,
  brand: "Cube",
  model: "Travel",
  year: 2020,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: 14,
  is_public: true,
};
try {
  for (const [i, c] of [a, b, admin].entries()) {
    assert.equal(
      (
        await c("auth/register", "POST", {
      ...testConsents,
          name: "Community " + i,
          email: nonce + i + "@example.test",
          password: "community-secret-123",
        })
      ).status,
      201,
    );
    const u = (await c("me")).body.user;
    ids.push(u.id);
    who.push(u);
  }
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [ids[2]]);
  const id = (await a("bikes", "POST", input)).body.id,
    privateId = (await a("bikes", "POST", { ...input, is_public: false })).body
      .id;
  const comments = "community/bikes/" + id + "/comments";
  assert.equal(
    (await guest(comments, "POST", { body: "No auth" })).status,
    401,
  );
  assert.equal(
    (await b(comments, "POST", { body: "Bad origin" }, "https://evil.example"))
      .status,
    403,
  );
  assert.equal(
    (
      await b("community/bikes/" + privateId + "/comments", "POST", {
        body: "Private",
      })
    ).status,
    404,
  );
  assert.equal(
    (await guest("community/bikes/" + privateId + "/comments")).status,
    404,
  );
  assert.equal(
    (await b(comments, "POST", { body: "x".repeat(1001) })).status,
    400,
  );
  await b("social/profiles/" + who[0].username + "/follow", "PUT");
  await b("bikes/" + id + "/like", "PUT");
  await b("bikes/" + id + "/like", "DELETE");
  await b("bikes/" + id + "/like", "PUT");
  const c = (
    await b(comments, "POST", { body: "<img src=x onerror=alert(1)>" })
  ).body.id;
  assert(c);
  let page = (await guest(comments)).body;
  assert.equal(page.comments[0].body, "<img src=x onerror=alert(1)>");
  assert.deepEqual(Object.keys(page.comments[0].author).sort(), [
    "avatar",
    "id",
    "name",
    "username",
  ]);
  assert(!JSON.stringify(page).includes("@example.test"));
  assert.equal(
    (await a("community/comments/" + c, "PATCH", { body: "Not mine" })).status,
    403,
  );
  assert.equal(
    (await b("community/comments/" + c, "PATCH", { body: "Edited" })).status,
    200,
  );
  const reply = (await a(comments, "POST", { body: "Answer", parentId: c }))
    .body.id;
  assert(reply);
  assert.equal(
    (await b(comments, "POST", { body: "Nested", parentId: reply })).status,
    400,
  );
  let events = (await a("community/notifications")).body;
  assert.equal(events.unread, 3);
  assert.equal(events.notifications.length, 3);
  assert.deepEqual(
    new Set(events.notifications.map((n) => n.type)),
    new Set(["follow", "like", "comment"]),
  );
  const answer = (await b("community/notifications")).body.notifications[0];
  assert.equal(answer.type, "reply");
  assert(answer.target.href.includes(reply));
  assert.equal(
    (await a("community/notifications/" + answer.id + "/read", "PATCH")).status,
    404,
  );
  assert.equal(
    (
      await b(
        "community/notifications/" + answer.id + "/read",
        "PATCH",
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await b("community/notifications/" + answer.id + "/read", "PATCH")).status,
    200,
  );
  assert.equal((await b("community/notifications/count")).body.unread, 0);
  assert.equal((await guest("community/notifications")).status, 401);
  await a("community/notifications/read-all", "PATCH");
  assert.equal((await a("community/notifications/count")).body.unread, 0);
  let feed = (await b("community/feed")).body;
  assert.equal(feed.total, 1);
  assert.equal(feed.bikes[0].id, id);
  assert.equal(feed.bikes[0].comments, 2);
  assert.equal((await guest("community/feed")).status, 401);
  await a("bikes/" + privateId + "/share", "PATCH", { is_public: true });
  assert.equal((await b("community/feed")).body.bikes[0].id, privateId);
  await a("bikes/" + privateId + "/share", "PATCH", { is_public: false });
  for (const [entityType, targetId] of [
    ["comment", reply],
    ["bike", id],
    ["profile", ids[0]],
  ]) {
    const report = { entityType, targetId, reason: "spam" };
    assert.equal(
      (await b("community/reports", "POST", report)).body.created,
      true,
    );
    assert.equal(
      (await b("community/reports", "POST", report)).body.created,
      false,
    );
  }
  assert.equal((await b("community/admin/reports")).status, 403);
  assert.equal((await guest("community/admin/reports")).status, 401);
  assert.equal(
    (
      await b("community/reports", "POST", {
        entityType: "bike",
        targetId: privateId,
        reason: "spam",
      })
    ).status,
    404,
  );
  let queue = (await admin("community/admin/reports")).body;
  const report = queue.reports.find((r) => r.targetId === reply);
  assert(report);
  assert.equal(
    (
      await admin(
        "community/admin/reports/" + report.id,
        "PATCH",
        { action: "delete_comment" },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await admin("community/admin/reports/" + report.id, "PATCH", {
        action: "delete_comment",
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin("community/admin/reports?status=closed")).body.reports.length,
    1,
  );
  assert.equal(
    (await b("community/notifications")).body.notifications.length,
    0,
  );
  const r2 = (await a(comments, "POST", { body: "New answer", parentId: c }))
    .body.id;
  await b("community/comments/" + c, "DELETE");
  page = (await guest(comments)).body;
  assert.equal(page.comments[0].unavailable, true);
  assert.equal(page.comments[0].author, null);
  assert.equal(page.comments[0].replies[0].id, r2);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ids[0]]);
  assert.equal((await guest(comments)).status, 404);
  assert.equal((await b("community/feed")).body.total, 0);
  assert.equal(
    (await b("community/notifications")).body.notifications.length,
    0,
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [ids[0]]);
  await b("social/profiles/" + who[0].username + "/follow", "DELETE");
  assert.equal((await b("community/feed")).body.total, 0);
  let limited = false;
  for (let i = 0; i < 21; i++) {
    const r = await b(comments, "POST", { body: "Rate " + i });
    if (r.status === 429) {
      limited = true;
      break;
    }
    assert.equal(r.status, 201);
  }
  assert(limited);
  console.log(
    "Community HTTP: comments/replies/ownership/XSS text, notifications/dedup/reads, live privacy, feed publication, reports/admin/CSRF and rate limits passed.",
  );
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await db.end();
}
