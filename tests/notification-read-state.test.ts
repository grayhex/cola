import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  decodeWatermark,
  encodeWatermark,
  inboxState,
  inboxWatermark,
  inboxWatermarkOf,
  markNotificationsRead,
  notificationKeysetPage,
  readNotifications,
  unreadCount,
} from "../lib/notifications.ts";
import { encodeCursor } from "../lib/api-v1/cursor.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import { present } from "./support/assertions.ts";
import { testDatabase } from "./support/database.ts";
import { bikeCommentRow, noticeRow } from "./support/notifications.ts";
import { userRow } from "./support/people.ts";

// Read-state of the inbox (#341): what is marked, up to which mark, and what is
// left alone. Showing a list marks nothing; "read all" counts up to the mark of
// the list that was shown, so a notice that arrives later stays unread.

const db = await testDatabase();
after(() => db.close());

const at = (n: number, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label: string) {
  const id = randomUUID();
  return (
    await userRow(db, {
      id,
      name: "Имя " + label,
      username: (label + "-" + id.slice(0, 8)).toLowerCase(),
    })
  ).id;
}
async function addBike(owner: string, isPublic = true) {
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
/** A comment of `actor` on `bike` and the notice of it to the bike's owner. */
async function commentNotice(
  recipient: string,
  actor: string,
  bike: string,
  when: string,
  extra: { id?: string } = {},
) {
  const comment = (
    await bikeCommentRow(db, bike, actor, {
      created_at: when,
      updated_at: when,
    })
  ).id;
  return (
    await noticeRow(db, recipient, "comment", {
      ...(extra.id ? { id: extra.id } : {}),
      actor_id: actor,
      bike_id: bike,
      comment_id: comment,
      created_at: when,
    })
  ).id;
}
async function followNotice(recipient: string, actor: string, when: string) {
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [actor, recipient],
  );
  return (
    await noticeRow(db, recipient, "follow", {
      actor_id: actor,
      created_at: when,
    })
  ).id;
}
const unreadIds = async (user: string, filter = {}) =>
  (
    await notificationKeysetPage(db, user, 50, null, new Date(), {
      unread: true,
      ...filter,
    })
  ).items.map((item) => item.id);

test("a list and a count mark nothing, and the mark is the newest notice the person can see", async () => {
  const me = await addUser("me");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  const first = await commentNotice(me, actor, bike, at(1));
  const second = await commentNotice(me, actor, bike, at(2));
  const third = await commentNotice(me, actor, bike, at(3));
  const state = await inboxState(db, me);
  assert.equal(state.unread, 3);
  assert.equal(state.capped, false);
  const mark = decodeWatermark(present(state.watermark));
  assert.deepEqual(mark, { createdAt: at(3), id: third });
  // Fetching pages and counting again changes nothing.
  await notificationKeysetPage(db, me, 2, null);
  await unreadCount(db, me);
  assert.equal((await inboxState(db, me)).unread, 3);
  assert.deepEqual((await unreadIds(me)).sort(), [first, second, third].sort());
  // Nobody to read for: no notice, no mark.
  const nobody = await addUser("nobody");
  assert.deepEqual(await inboxState(db, nobody), {
    unread: 0,
    capped: false,
    watermark: null,
  });
});

test("read all counts up to the mark of the list that was shown; a later notice stays unread", async () => {
  const me = await addUser("me");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  await commentNotice(me, actor, bike, at(1));
  await commentNotice(me, actor, bike, at(2));
  const shown = present(await inboxWatermark(db, me));
  // It arrives after the list was drawn.
  const later = await commentNotice(me, actor, bike, at(5));
  const result = await markNotificationsRead(db, me, { upTo: shown });
  assert.equal(result.marked, 2);
  assert.deepEqual(await unreadIds(me), [later]);
  // Again: nothing more is marked (idempotent), the later one still waits.
  assert.equal(
    (await markNotificationsRead(db, me, { upTo: shown })).marked,
    0,
  );
  assert.deepEqual(await unreadIds(me), [later]);
  // The mark of a newer list reads it too.
  await markNotificationsRead(db, me, {
    upTo: present(await inboxWatermark(db, me)),
  });
  assert.deepEqual(await unreadIds(me), []);
});

test("equal times are ordered by id: a notice that sorts above the mark is newer and stays unread", async () => {
  const me = await addUser("me");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  await commentNotice(me, actor, bike, at(4, 7), { id: ids[1] });
  await commentNotice(me, actor, bike, at(4, 7), { id: ids[2] });
  const mark = present(await inboxWatermark(db, me));
  // The list is `created_at DESC, id`: the first of equals is the smallest id.
  assert.deepEqual(mark, { createdAt: at(4, 7), id: ids[1] });
  // The same time, a smaller id: above the mark in the list, so newer.
  await commentNotice(me, actor, bike, at(4, 7), { id: ids[0] });
  assert.equal((await markNotificationsRead(db, me, { upTo: mark })).marked, 2);
  assert.deepEqual(await unreadIds(me), [ids[0]]);
});

test("what the person cannot see is not read, and is still new when it appears", async () => {
  const me = await addUser("me");
  const actor = await addUser("actor");
  const open = await addBike(me);
  const hidden = await addBike(me, false);
  await commentNotice(me, actor, open, at(1));
  const secret = await commentNotice(me, actor, hidden, at(2));
  const mark = present(await inboxWatermark(db, me));
  assert.equal((await markNotificationsRead(db, me, { upTo: mark })).marked, 1);
  // The bike becomes public: the notice, older than the mark, was never shown.
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [hidden]);
  assert.deepEqual(await unreadIds(me), [secret]);
  assert.equal(
    (await inboxState(db, me)).unread,
    1,
    "the count and the list agree",
  );
});

test("a selection marks only the person's own notices, once", async () => {
  const me = await addUser("me");
  const other = await addUser("other");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  const theirs = await addBike(other);
  const mine = await commentNotice(me, actor, bike, at(1));
  const mine2 = await commentNotice(me, actor, bike, at(2));
  const notMine = await commentNotice(other, actor, theirs, at(1));
  const result = await markNotificationsRead(db, me, {
    ids: [mine, notMine, mine, randomUUID()],
  });
  assert.deepEqual(result, { marked: 1, found: 1 });
  assert.deepEqual(await unreadIds(me), [mine2]);
  assert.deepEqual(await unreadIds(other), [notMine], "not touched");
  assert.deepEqual(
    await markNotificationsRead(db, me, { ids: [mine] }),
    { marked: 0, found: 1 },
    "again: found, nothing new to mark",
  );
});

test("a category filter selects the stored types of the category, for the list and for read all", async () => {
  const me = await addUser("me");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  const comment = await commentNotice(me, actor, bike, at(1));
  const follow = await followNotice(me, actor, at(2));
  assert.deepEqual(await unreadIds(me, { category: "discussions" }), [comment]);
  assert.deepEqual(await unreadIds(me, { category: "reactions" }), [follow]);
  assert.deepEqual(await unreadIds(me, { category: "rides" }), []);
  const mark = present(await inboxWatermark(db, me));
  assert.equal(
    (await markNotificationsRead(db, me, { upTo: mark, category: "reactions" }))
      .marked,
    1,
  );
  assert.deepEqual(await unreadIds(me), [comment]);
  // The filter of the unread keeps read ones in the plain list.
  const all = (await notificationKeysetPage(db, me, 50, null)).items;
  assert.equal(all.length, 2);
  assert.equal(all.filter((item) => item.readAt !== null).length, 1);
  assert.deepEqual(all.map((item) => item.category).sort(), [
    "discussions",
    "reactions",
  ]);
});

test("the legacy read routes keep their answers: one id says whether it is the person's, none reads what exists now", async () => {
  const me = await addUser("me");
  const other = await addUser("other");
  const actor = await addUser("actor");
  const bike = await addBike(me);
  const first = await commentNotice(me, actor, bike, at(1));
  assert.equal(await readNotifications(db, other, first), false);
  assert.equal(await readNotifications(db, me, first), true);
  assert.equal(await readNotifications(db, me, first), true, "idempotent");
  const second = await commentNotice(me, actor, bike, at(2));
  assert.equal(await readNotifications(db, me), true);
  assert.deepEqual(await unreadIds(me), []);
  assert.equal((await unreadCount(db, me)).unread, 0);
  void second;
  // Nothing to read is not an error.
  assert.equal(await readNotifications(db, await addUser("empty")), true);
});

test("a mark is a boundary only for the person it was given to: made up, foreign and gone ones are refused", async () => {
  const owner = await addUser("mark-owner");
  const other = await addUser("mark-other");
  const actor = await addUser("mark-actor");
  const bike = await addBike(owner);
  const mine = await commentNotice(owner, actor, bike, at(4, 111111));
  const theirs = await followNotice(other, actor, at(4, 222222));
  await commentNotice(owner, actor, await addBike(owner), at(5, 333333));
  const text = present((await inboxState(db, owner)).watermark);
  const own = await inboxWatermarkOf(db, owner, text);
  assert.ok(own, "the mark the server gave is accepted");
  assert.equal(own?.createdAt, at(5, 333333));
  // Another account's mark, kept by an app after the account was switched.
  const foreign = present((await inboxState(db, other)).watermark);
  assert.equal(await inboxWatermarkOf(db, owner, foreign), null);
  // Made up: the right shape, a time that has not come, an id nobody has.
  const madeUp = encodeWatermark({
    createdAt: "2099-01-01T00:00:00.000000Z",
    id: randomUUID(),
  });
  assert.equal(await inboxWatermarkOf(db, owner, madeUp), null);
  // The person's own notice with a time it does not have is not that notice either.
  assert.equal(
    await inboxWatermarkOf(
      db,
      owner,
      encodeWatermark({ createdAt: "2099-01-01T00:00:00.000000Z", id: mine }),
    ),
    null,
  );
  // A notice of somebody else, named with its own time, is not this person's.
  assert.equal(
    await inboxWatermarkOf(
      db,
      owner,
      encodeWatermark({ createdAt: at(4, 222222), id: theirs }),
    ),
    null,
  );
  // And the shape still counts.
  assert.equal(await inboxWatermarkOf(db, owner, "garbage"), null);
  assert.equal(await inboxWatermarkOf(db, owner, encodeCursor(own)), null);
  // A notice that is gone no longer names a boundary: the app asks again.
  await db.query("DELETE FROM notifications WHERE id=$1", [mine]);
  const gone = encodeWatermark({ createdAt: at(4, 111111), id: mine });
  assert.equal(await inboxWatermarkOf(db, owner, gone), null);
  assert.ok(await inboxWatermarkOf(db, owner, text), "the others still do");
});

test("the watermark is opaque, versioned and not a page cursor", () => {
  const mark = { createdAt: at(3, 123456), id: randomUUID() };
  const text = encodeWatermark(mark);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeWatermark(text), mark);
  // A cursor of the same list is not a watermark, and the other way round.
  assert.equal(decodeWatermark(encodeCursor(mark)), null);
  for (const bad of [
    "",
    "x",
    Buffer.from("{}").toString("base64url"),
    Buffer.from(
      JSON.stringify({ w: 2, t: mark.createdAt, i: mark.id }),
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({ w: 1, t: "2026-09-03T10:00:00Z", i: mark.id }),
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({ w: 1, t: mark.createdAt, i: "not-a-uuid" }),
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({ w: 1, t: mark.createdAt, i: mark.id, extra: 1 }),
    ).toString("base64url"),
  ])
    assert.equal(decodeWatermark(bad), null, bad);
});
