import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { savedKeysetPage } from "../lib/journal-discovery.ts";
import {
  noticeExpiringListings,
  savedApiKeysetPage,
  savedListings,
} from "../lib/market.ts";
import {
  notificationKeysetPage,
  notificationPage,
  unreadCount,
} from "../lib/notifications.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import {
  toJournalSummary,
  toMarketListing,
  toNotification,
} from "../lib/api-v1/mappers.ts";
import {
  journalSummarySchema,
  marketListingSchema,
  notificationCountSchema,
  notificationSchema,
  parseNoQuery,
} from "../lib/api-v1/schemas.ts";

// API v1, personal reads (#321): notices and saved items of the person asking.
// The rules are the site's (visibility at read time), only the paging differs.
// The server end to end is tests/api-v1-personal-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

const day = (n, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label, blocked = false) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,$3,'hash',$4,$5)",
    [
      id,
      id + "@test.invalid",
      "Имя " + label,
      (label + "-" + id.slice(0, 8)).toLowerCase(),
      blocked,
    ],
  );
  return id;
}
async function addBike(owner, isPublic = true) {
  return insertBike(
    db,
    owner,
    bikeInput.parse({
      name: "Bike " + randomUUID().slice(0, 6),
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: isPublic,
    }),
  );
}
async function addComment(bike, author, at) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO bike_comments(id,bike_id,author_id,body,created_at,updated_at) VALUES($1,$2,$3,'Привет',$4,$4)",
    [id, bike, author, at],
  );
  return id;
}
async function notice(recipient, actor, type, extra, at) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$8,$7)",
    [
      id,
      recipient,
      actor,
      type,
      extra.bike ?? null,
      extra.comment ?? null,
      at,
      id,
    ],
  );
  return id;
}
async function addListing(
  owner,
  { status = "active", at = day(10), title } = {},
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,status,listing_type,published_at,expires_at)
     VALUES($1,$2,$3,$4,'Описание','components','used',100,'RUB',$5,'sale',$6,$7)`,
    [
      id,
      randomUUID(),
      owner,
      title ?? "Лот " + id.slice(0, 6),
      status,
      at,
      status === "active" ? "2099-01-01T00:00:00Z" : null,
    ],
  );
  return id;
}
async function addEntry(
  owner,
  bike,
  { status = "published", at = day(1) } = {},
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,components,created_at,updated_at)
     VALUES($1,$2,$3,$4,'build','Запись','Текст записи',$5,true,'2026-08-30',100,'[]'::jsonb,$6,$6)`,
    [id, randomUUID(), owner, bike, status, at],
  );
  return id;
}

const me = await addUser("me");
const actor = await addUser("actor");
const barred = await addUser("barred");
const bike = await addBike(me);
const their = await addBike(actor);

async function walk(limit) {
  const seen = [];
  let after = null;
  for (let guard = 0; guard < 30; guard++) {
    const page = await notificationKeysetPage(db, me, limit, after);
    seen.push(...page.items.map((item) => item.id));
    if (!page.next) return seen;
    after = page.next;
  }
  throw new Error("the walk does not end");
}

test("notices: the keyset walk is the site's order, ties and all", async () => {
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
    [actor, me],
  );
  const follow = await notice(me, actor, "follow", {}, day(1));
  const like = await notice(me, actor, "like", { bike }, day(2));
  await db.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
    bike,
    actor,
  ]);
  const comment = await addComment(bike, actor, day(3));
  const first = await notice(me, actor, "comment", { bike, comment }, day(3));
  const comment2 = await addComment(bike, actor, day(3));
  // The same instant: the id is the last word.
  const second = await notice(
    me,
    actor,
    "comment",
    { bike, comment: comment2 },
    day(3),
  );
  const legacy = (await notificationPage(db, me, 1)).notifications.map(
    (n) => n.id,
  );
  assert.deepEqual(new Set(legacy), new Set([follow, like, first, second]));
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), legacy, "limit " + limit);
  // Somebody else's notices are not ours.
  await notice(actor, me, "follow", {}, day(4));
  assert.deepEqual(await walk(50), legacy);
});

test("notices: what the person may no longer see is not shown", async () => {
  const page = async () =>
    (await notificationKeysetPage(db, me, 50, null)).items;
  const before = (await page()).map((item) => item.type).sort();
  assert.deepEqual(before, ["comment", "comment", "follow", "like"]);
  // An undone like leaves no notice.
  await db.query("DELETE FROM bike_likes WHERE bike_id=$1 AND user_id=$2", [
    bike,
    actor,
  ]);
  assert.ok(!(await page()).some((item) => item.type === "like"));
  await db.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
    bike,
    actor,
  ]);
  // A private bike hides the notices about it.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
  assert.deepEqual(
    (await page()).map((item) => item.type),
    ["follow"],
  );
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
  // A deleted comment leaves no notice.
  const [{ comment_id: gone }] = (
    await db.query(
      "SELECT comment_id FROM notifications WHERE recipient_id=$1 AND type='comment' AND comment_id IS NOT NULL ORDER BY created_at DESC,id LIMIT 1",
      [me],
    )
  ).rows;
  await db.query(
    "UPDATE bike_comments SET deleted_at=now(),body='' WHERE id=$1",
    [gone],
  );
  assert.equal(
    (await page()).filter((item) => item.type === "comment").length,
    1,
  );
  await db.query(
    "UPDATE bike_comments SET deleted_at=NULL,body='Привет' WHERE id=$1",
    [gone],
  );
  assert.equal((await page()).length, 4);
});

test("notices: the card is the contract's, with the site's paths", async () => {
  const items = (await notificationKeysetPage(db, me, 50, null)).items.map(
    toNotification,
  );
  for (const item of items) notificationSchema.parse(item);
  const byType = (type) => items.find((item) => item.type === type);
  assert.equal(byType("follow").target.type, "profile");
  assert.match(byType("follow").target.path, /^\/@/);
  assert.equal(byType("like").target.type, "bike");
  assert.match(byType("like").target.path, /^\/b\//);
  assert.match(byType("comment").target.path, /\?comment=.+#discussion$/);
  assert.equal(byType("like").actor.username.startsWith("actor-"), true);
  assert.ok(!JSON.stringify(items).includes("@test.invalid"));
  assert.ok(items.every((item) => item.readAt === null));
});

test("notices: the end of a listing's term and a security notice", async () => {
  const soon = await addListing(me, { title: "Скоро" });
  await db.query(
    "UPDATE market_listings SET expires_at=now()+interval '1 day' WHERE id=$1",
    [soon],
  );
  await noticeExpiringListings(db, me, false);
  await noticeExpiringListings(db, me, false);
  await db.query(
    "INSERT INTO notifications(id,recipient_id,actor_id,type,dedup_key,created_at) VALUES($1,$2,NULL,'session_reuse',$4,$3)",
    [randomUUID(), me, day(20), randomUUID()],
  );
  const items = (await notificationKeysetPage(db, me, 50, null)).items.map(
    toNotification,
  );
  for (const item of items) notificationSchema.parse(item);
  const market = items.filter((item) => item.type === "market_expiring");
  assert.equal(market.length, 1, "one notice per term");
  assert.equal(market[0].actor, null);
  assert.equal(market[0].target.state, "expiring");
  assert.ok(market[0].target.expiresAt);
  assert.equal(market[0].target.name, "Скоро");
  const reuse = items.find((item) => item.type === "session_reuse");
  assert.equal(reuse.actor, null);
  assert.equal(reuse.target.type, "account");
  assert.match(reuse.target.path, /^\/account/);
});

test("the count is the site's", async () => {
  const count = await unreadCount(db, me);
  notificationCountSchema.parse(count);
  assert.equal(count.unread, 6);
  await db.query(
    "UPDATE notifications SET read_at=now() WHERE recipient_id=$1 AND type='follow'",
    [me],
  );
  assert.equal((await unreadCount(db, me)).unread, 5);
});

test("saved entries: newest save first, only what is still public", async () => {
  const entries = [];
  for (let i = 0; i < 4; i++)
    entries.push(await addEntry(actor, their, { at: day(1 + i) }));
  const draft = await addEntry(actor, their, { status: "draft" });
  const save = (entry, at) =>
    db.query(
      "INSERT INTO journal_saves(user_id,entry_id,created_at) VALUES($1,$2,$3)",
      [me, entry, at],
    );
  await save(entries[0], day(5));
  await save(entries[1], day(6));
  // The same instant: the id is the last word.
  await save(entries[2], day(7));
  await save(entries[3], day(7));
  await save(draft, day(8));
  const walk = async (limit) => {
    const seen = [];
    let after = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await savedKeysetPage(db, me, limit, after);
      for (const row of page.rows)
        journalSummarySchema.parse(toJournalSummary(row, me));
      seen.push(...page.rows.map((row) => row.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  const expected = [entries[2], entries[3]]
    .sort()
    .concat([entries[1], entries[0]]);
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), expected, "limit " + limit);
  // Unpublished stays saved, not shown.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [their]);
  assert.deepEqual(await walk(50), []);
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [their]);
  assert.equal((await walk(50)).length, 4);
  // Nobody else's saves.
  assert.deepEqual((await savedKeysetPage(db, actor, 50, null)).rows, []);
});

test("saved listings: newest save first, only what is on the market", async () => {
  const live = [];
  for (let i = 0; i < 3; i++)
    live.push(await addListing(actor, { at: day(1 + i) }));
  const sold = await addListing(actor, { status: "sold" });
  const hidden = await addListing(barred);
  const save = (listing, at) =>
    db.query(
      "INSERT INTO market_saves(user_id,listing_id,created_at) VALUES($1,$2,$3)",
      [me, listing, at],
    );
  await save(live[0], day(5));
  await save(live[1], day(6));
  await save(live[2], day(6));
  await save(sold, day(9));
  await save(hidden, day(9));
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred]);
  const legacy = (await savedListings(db, me)).items.map((item) => item.id);
  const walk = async (limit) => {
    const seen = [];
    let after = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await savedApiKeysetPage(db, me, limit, after);
      for (const item of page.items)
        marketListingSchema.parse(toMarketListing(item));
      seen.push(...page.items.map((item) => item.id));
      if (!page.next) return seen;
      after = page.next;
    }
    throw new Error("the walk does not end");
  };
  assert.deepEqual(new Set(legacy), new Set(live));
  for (const limit of [1, 2, 3, 50])
    assert.deepEqual(await walk(limit), legacy, "limit " + limit);
  assert.deepEqual((await savedApiKeysetPage(db, actor, 50, null)).items, []);
});

test("an operation without parameters refuses every parameter", () => {
  assert.deepEqual(
    parseNoQuery(new URL("http://x/api/v1/me/notifications/count")),
    {},
  );
  for (const query of ["?limit=0", "?foo=bar", "?a=1&a=2"])
    assert.throws(() => parseNoQuery(new URL("http://x/m" + query)), {
      code: "invalid_request",
    });
});
