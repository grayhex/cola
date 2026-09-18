import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { commentInput, reportInput } from "../lib/community-validation.js";
import {
  createComment,
  changeComment,
  commentPage,
  replyPage,
  commentDto,
} from "../lib/comments.js";
import {
  notificationPage,
  unreadCount,
  readNotifications,
} from "../lib/notifications.js";
import { setFollow } from "../lib/follows.js";
import { showcase, vote } from "../lib/showcase.js";
import { createReport, reportPage, moderateReport } from "../lib/reports.js";
import { insertBike } from "../lib/repository.js";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.js";
async function setup() {
  const db = new PGlite();
  for (const f of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultCatalog),
  ]);
  return db;
}
async function rider(db, name, role = "user") {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,role) VALUES($1,$2,$3,'hash',$3,$4)",
    [id, name + "@example.test", name, role],
  );
  return { id, role, username: name };
}
const bike = {
  name: "Bicycle",
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
function privateFree(value) {
  if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      assert(
        ![
          "email",
          "role",
          "blocked",
          "password_hash",
          "preferences",
          "moderation",
          "dedup_key",
          "actor_id",
          "recipient_id",
        ].includes(k),
        "leak " + k,
      );
      privateFree(v);
    }
}
test("community input is bounded plain text and comment DTO has no hidden fields", () => {
  assert(
    commentInput.safeParse({ body: "<img src=x onerror=alert(1)>" }).success,
  );
  for (const body of ["", "  ", "x".repeat(1001), "x\0"])
    assert(!commentInput.safeParse({ body }).success);
  assert(
    !commentInput.safeParse({ body: "Hi", author_id: randomUUID() }).success,
  );
  assert(
    !reportInput.safeParse({
      entityType: "comment",
      targetId: randomUUID(),
      reason: "anything",
    }).success,
  );
  const dto = commentDto(
    {
      id: "id",
      body: "text",
      author_id: "u",
      username: "alice",
      name: "Alice",
      email: "SECRET",
      role: "SECRET",
      preferences: "SECRET",
      ip: "SECRET",
      moderation: "SECRET",
    },
    null,
  );
  privateFree(dto);
  assert(!JSON.stringify(dto).includes("SECRET"));
  const hidden = commentDto(
    { id: "id", body: "SECRET", author_id: "u", blocked: true, name: "SECRET" },
    null,
  );
  assert.equal(hidden.author, null);
  assert.equal(hidden.body, null);
});
test("comments support bounded threads, ownership, soft deletion, blocked authors and query limits", async () => {
  const db = await setup();
  try {
    const a = await rider(db, "alice"),
      b = await rider(db, "bobby"),
      c = await rider(db, "carol"),
      admin = await rider(db, "moderator", "admin");
    const id = await insertBike(db, a.id, bike),
      secret = await insertBike(db, a.id, { ...bike, is_public: false });
    const add = (user, body, parentId) =>
      db.transaction((q) => createComment(q, id, user, { body, parentId }));
    await assert.rejects(
      db.transaction((q) => createComment(q, secret, b, { body: "no" })),
      (e) => e.status === 404,
    );
    const top = await add(b, "Original"),
      reply = await add(a, "Answer", top.id);
    await assert.rejects(add(c, "Too deep", reply.id), /основной/);
    const other = await insertBike(db, a.id, bike);
    await assert.rejects(
      db.transaction((q) =>
        createComment(q, other, c, { body: "wrong bike", parentId: top.id }),
      ),
      (e) => e.status === 404,
    );
    await assert.rejects(
      db.transaction((q) => changeComment(q, top.id, c, "Steal")),
      (e) => e.status === 403,
    );
    await db.transaction((q) =>
      changeComment(q, top.id, b, "Edited <script>alert(1)</script>"),
    );
    let page = await commentPage(db, id, b);
    assert.equal(page.comments[0].canEdit, true);
    assert.equal(page.comments[0].body, "Edited <script>alert(1)</script>");
    assert.equal(page.comments[0].replyCount, 1);
    privateFree(page);
    for (let i = 0; i < 5; i++) await add(c, "Reply " + i, top.id);
    page = await commentPage(db, id, null);
    assert.equal(page.comments[0].replies.length, 3);
    assert.equal(page.comments[0].replyCount, 6);
    assert.equal((await replyPage(db, id, top.id, null)).comments.length, 6);
    const focus = await commentPage(db, id, null, 1, reply.id);
    assert(focus.focused);
    assert(focus.comments[0].replies.some((r) => r.id === reply.id));
    await db.transaction((q) => changeComment(q, top.id, b));
    await db.transaction((q) => changeComment(q, top.id, b));
    page = await commentPage(db, id, null);
    assert.equal(page.comments[0].body, null);
    assert.equal(page.comments[0].author, null);
    assert.equal(page.comments[0].replyCount, 6);
    assert.equal(
      (await db.query("SELECT body FROM bike_comments WHERE id=$1", [top.id]))
        .rows[0].body,
      "",
    );
    await assert.rejects(
      add(c, "Deleted root", top.id),
      (e) => e.status === 404,
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [c.id]);
    page = await commentPage(db, id, null);
    assert.equal(page.comments[0].replyCount, 1);
    assert.equal(page.comments[0].replies.length, 1);
    assert.equal(
      (await showcase(db, null)).bikes.find((b) => b.id === id).comments,
      1,
    );
    await db.transaction((q) => changeComment(q, reply.id, admin));
    assert.equal((await commentPage(db, id, null)).comments.length, 0);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [c.id]);
    for (let i = 0; i < 22; i++) await add(b, "Root " + i);
    let calls = 0;
    const q = {
      query: (...args) => {
        calls++;
        return db.query(...args);
      },
    };
    page = await commentPage(q, id, null);
    assert.equal(page.comments.length, 20);
    assert(page.hasMore);
    assert.equal(calls, 3);
    assert.equal((await commentPage(db, id, null, 2)).comments.length, 3);
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    await assert.rejects(commentPage(db, id, a), (e) => e.status === 404);
    await assert.rejects(add(b, "private"), (e) => e.status === 404);
    await assert.rejects(replyPage(db, id, top.id, a), (e) => e.status === 404);
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [a.id]);
    await assert.rejects(commentPage(db, id, null), (e) => e.status === 404);
  } finally {
    await db.close();
  }
});
test("notifications follow/like/comment/reply, dedup, self suppression, reads and live privacy", async () => {
  const db = await setup();
  try {
    const a = await rider(db, "alice"),
      b = await rider(db, "bobby");
    const id = await insertBike(db, a.id, bike);
    const follow = (yes) =>
      db.transaction((q) => setFollow(q, b.id, a.username, yes));
    const like = (yes) => db.transaction((q) => vote(q, id, b.id, yes));
    await follow(true);
    await follow(true);
    await follow(false);
    await follow(true);
    await like(true);
    await like(false);
    await like(true);
    let notifications = (await notificationPage(db, a.id)).notifications;
    assert.equal(notifications.length, 2);
    assert.deepEqual(
      new Set(notifications.map((n) => n.type)),
      new Set(["follow", "like"]),
    );
    assert.equal((await unreadCount(db, a.id)).unread, 2);
    privateFree(notifications);
    const top = await db.transaction((q) =>
      createComment(q, id, b, { body: "Question" }),
    );
    for (let i = 0; i < 4; i++)
      await db.transaction((q) =>
        createComment(q, id, b, { body: "More " + i }),
      );
    assert.equal((await unreadCount(db, a.id)).unread, 3);
    await db.transaction((q) => createComment(q, id, a, { body: "Self" }));
    assert.equal((await unreadCount(db, a.id)).unread, 3);
    const reply = await db.transaction((q) =>
      createComment(q, id, a, { body: "Response", parentId: top.id }),
    );
    const incoming = (await notificationPage(db, b.id)).notifications;
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].type, "reply");
    assert(incoming[0].target.href.includes(reply.id));
    assert.equal(await readNotifications(db, a.id, incoming[0].id), false);
    await readNotifications(db, b.id, incoming[0].id);
    await readNotifications(db, b.id, incoming[0].id);
    assert.equal((await unreadCount(db, b.id)).unread, 0);
    await readNotifications(db, a.id);
    assert.equal((await unreadCount(db, a.id)).unread, 0);
    await follow(false);
    await follow(true);
    await like(false);
    await like(true);
    assert.equal((await unreadCount(db, a.id)).unread, 0);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [b.id]);
    assert.equal((await notificationPage(db, a.id)).notifications.length, 0);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [b.id]);
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    notifications = (await notificationPage(db, a.id)).notifications;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, "follow");
    assert.equal((await notificationPage(db, b.id)).notifications.length, 0);
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
    await db.transaction((q) => changeComment(q, reply.id, a));
    assert.equal((await notificationPage(db, b.id)).notifications.length, 0);
  } finally {
    await db.close();
  }
});
test("subscription feed follows publication time and excludes private, blocked and unfollowed owners without N+1", async () => {
  const db = await setup();
  try {
    const a = await rider(db, "alice"),
      b = await rider(db, "bobby"),
      viewer = await rider(db, "viewer");
    const first = await insertBike(db, a.id, bike),
      unfollowed = await insertBike(db, b.id, bike),
      secret = await insertBike(db, a.id, { ...bike, is_public: false });
    await db.transaction((q) => setFollow(q, viewer.id, a.username, true));
    let calls = 0;
    const q = {
      query: (...args) => {
        calls++;
        return db.query(...args);
      },
    };
    let feed = await showcase(q, viewer.id, { followingId: viewer.id });
    assert.equal(calls, 6);
    assert.deepEqual(
      feed.bikes.map((b) => b.id),
      [first],
    );
    privateFree(feed);
    assert.equal(
      (await db.query("SELECT published_at FROM bikes WHERE id=$1", [secret]))
        .rows[0].published_at,
      null,
    );
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [secret]);
    feed = await showcase(db, viewer.id, { followingId: viewer.id });
    assert.equal(feed.bikes[0].id, secret);
    assert(!feed.bikes.some((b) => b.id === unfollowed));
    const time = (
      await db.query("SELECT published_at FROM bikes WHERE id=$1", [secret])
    ).rows[0].published_at;
    await db.query(
      "UPDATE bikes SET name='Edited',is_public=true WHERE id=$1",
      [secret],
    );
    assert.deepEqual(
      (await db.query("SELECT published_at FROM bikes WHERE id=$1", [secret]))
        .rows[0].published_at,
      time,
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [a.id]);
    assert.equal(
      (await showcase(db, viewer.id, { followingId: viewer.id })).total,
      0,
    );
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [a.id]);
    await db.transaction((q) => setFollow(q, viewer.id, a.username, false));
    assert.equal(
      (await showcase(db, viewer.id, { followingId: viewer.id })).total,
      0,
    );
  } finally {
    await db.close();
  }
});
test("reports deduplicate, validate public targets and support audited admin comment moderation", async () => {
  const db = await setup();
  try {
    const a = await rider(db, "alice"),
      b = await rider(db, "bobby"),
      admin = await rider(db, "moderator", "admin"),
      id = await insertBike(db, a.id, bike);
    const c = await db.transaction((q) =>
      createComment(q, id, a, { body: "Reported text" }),
    );
    for (const [entityType, targetId] of [
      ["bike", id],
      ["profile", a.id],
      ["comment", c.id],
    ]) {
      const input = { entityType, targetId, reason: "spam" };
      assert((await createReport(db, b, input)).created);
      assert(
        !(await createReport(db, b, { ...input, reason: "other" })).created,
      );
    }
    let queue = await reportPage(db);
    assert.equal(queue.reports.length, 3);
    const report = queue.reports.find((r) => r.entityType === "comment");
    assert.equal(report.target.username, a.username);
    await db.transaction((q) =>
      moderateReport(q, report.id, admin, "delete_comment"),
    );
    assert.equal((await commentPage(db, id, null)).comments.length, 0);
    assert.equal((await reportPage(db, 1, "closed")).reports.length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM admin_audit WHERE action='community.report.delete_comment'",
        )
      ).rows[0].n,
      1,
    );
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    await assert.rejects(
      createReport(db, b, { entityType: "bike", targetId: id, reason: "spam" }),
      (e) => e.status === 404,
    );
  } finally {
    await db.close();
  }
});
