import test, { after } from "node:test";
import assert from "node:assert/strict";
import { exportAccount } from "../lib/account-data.ts";
import { chatPeople } from "../lib/chat-people.ts";
import { setFollow } from "../lib/follows.ts";
import { notify } from "../lib/notifications.ts";
import { experienceUserKeyset } from "../lib/search.ts";
import {
  blockedBetween,
  blockedKeysetPage,
  setBlock,
} from "../lib/user-blocks.ts";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { insertRow } from "./support/rows.ts";

// Blocking a person (#354): what the block cuts, in which direction, what it
// leaves alone, and that a person who was blocked cannot tell from the answers.

const db = await testDatabase();
after(() => db.close());

const person = (overrides = {}) =>
  userRow(db, { email_verified_at: new Date(), ...overrides });
const follow = (a: string, b: string) =>
  db.query("INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)", [
    a,
    b,
  ]);
const follows = async (a: string, b: string) =>
  (
    await db.query(
      "SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2",
      [a, b],
    )
  ).rowCount === 1;
const jobs = async (blocker: string, blocked: string) =>
  (
    await db.query<{ op: string }>(
      "SELECT op FROM chat_block_jobs WHERE blocker_id=$1 AND blocked_id=$2",
      [blocker, blocked],
    )
  ).rows[0]?.op ?? null;
const inChat = (...ids: string[]) =>
  Promise.all(
    ids.map((user_id) => insertRow(db, "chat_identities", { user_id })),
  );

test("a block cuts the follows both ways and is idempotent", async () => {
  const a = await person(),
    b = await person();
  await follow(a.id, b.id);
  await follow(b.id, a.id);
  assert.deepEqual(await setBlock(db, a.id, b.id, true), { blocked: true });
  assert.equal(await follows(a.id, b.id), false);
  assert.equal(await follows(b.id, a.id), false);
  assert.equal(await blockedBetween(db, a.id, b.id), true);
  assert.equal(await blockedBetween(db, b.id, a.id), true, "either way");
  assert.deepEqual(await setBlock(db, a.id, b.id, true), { blocked: true });
  assert.equal(
    (await db.query("SELECT 1 FROM user_blocks WHERE blocker_id=$1", [a.id]))
      .rowCount,
    1,
  );
  assert.deepEqual(await setBlock(db, a.id, b.id, false), { blocked: false });
  assert.equal(await blockedBetween(db, a.id, b.id), false);
  assert.equal(await follows(a.id, b.id), false, "nothing comes back");
  assert.deepEqual(await setBlock(db, a.id, b.id, false), { blocked: false });
});

test("oneself and a person the site has blocked cannot be blocked", async () => {
  const a = await person(),
    barred = await person({ blocked: true });
  assert.deepEqual(await setBlock(db, a.id, a.id, true), {
    error: "Нельзя заблокировать себя",
    status: 400,
  });
  assert.deepEqual(await setBlock(db, a.id, barred.id, true), {
    error: "Профиль недоступен",
    status: 404,
  });
  assert.equal(
    (await setBlock(db, a.id, "00000000-0000-4000-8000-000000000000", true))
      .status,
    404,
  );
});

test("a follow is refused while a block stands, either way, as an unavailable profile", async () => {
  const a = await person(),
    b = await person();
  await setBlock(db, a.id, b.id, true);
  const byBlocked = await setFollow(db, b.id, a.username, true);
  const byBlocker = await setFollow(db, a.id, b.username, true);
  for (const result of [byBlocked, byBlocker])
    assert.deepEqual(result, { error: "Профиль недоступен", status: 404 });
  assert.equal(await follows(b.id, a.id), false);
  assert.equal(await follows(a.id, b.id), false);
  // Unfollowing is never refused.
  assert.ok((await setFollow(db, b.id, a.username, false)).relationship);
  await setBlock(db, a.id, b.id, false);
  assert.ok((await setFollow(db, b.id, a.username, true)).relationship);
});

test("a notice is never made between two people one of whom blocked the other", async () => {
  const a = await person(),
    b = await person(),
    c = await person();
  await setBlock(db, a.id, b.id, true);
  await notify(db, { recipient: a.id, actor: b.id, type: "follow" });
  await notify(db, { recipient: b.id, actor: a.id, type: "follow" });
  await notify(db, { recipient: a.id, actor: c.id, type: "follow" });
  const rows = (
    await db.query<{ recipient_id: string; actor_id: string }>(
      "SELECT recipient_id,actor_id FROM notifications WHERE recipient_id=ANY($1::uuid[])",
      [[a.id, b.id]],
    )
  ).rows;
  assert.deepEqual(rows, [{ recipient_id: a.id, actor_id: c.id }]);
});

test("search and the people of a chat leave out a pair that blocked", async () => {
  const a = await person({ name: "Ищущий" }),
    b = await person({ name: "Скрытыйблок" + Date.now() }),
    c = await person({ name: "Видимыйблок" + Date.now() });
  await setBlock(db, a.id, b.id, true);
  const find = async (viewer: string, text: string) =>
    (await experienceUserKeyset(db, viewer, text, 10, null)).rows.map(
      (r) => r.id,
    );
  assert.deepEqual(await find(a.id, b.name), [], "the blocker");
  assert.deepEqual(await find(b.id, a.name), [], "the blocked");
  assert.deepEqual(await find(c.id, b.name), [b.id], "a third person");
  assert.deepEqual(
    await find(null as unknown as string, b.name),
    [b.id],
    "a guest",
  );
  const people = async (viewer: string, text: string) =>
    (await chatPeople(db, viewer, text)).people.map((p) => p.id);
  assert.deepEqual(await people(a.id, b.name.slice(0, 8)), []);
  assert.deepEqual(await people(b.id, a.name), []);
  assert.deepEqual(await people(c.id, b.name.slice(0, 8)), [b.id]);
});

test("the Stream side is a job only for people who have both been in chat", async () => {
  const a = await person(),
    b = await person(),
    c = await person();
  await inChat(a.id, b.id);
  await setBlock(db, a.id, b.id, true);
  assert.equal(await jobs(a.id, b.id), "block");
  // The last intention of the pair wins, and the job is due again at once.
  await db.query(
    "UPDATE chat_block_jobs SET attempts=3,next_attempt_at=now()+interval '1 hour' WHERE blocker_id=$1",
    [a.id],
  );
  await setBlock(db, a.id, b.id, false);
  assert.equal(await jobs(a.id, b.id), "unblock");
  const row = (
    await db.query<{ attempts: number; due: boolean }>(
      "SELECT attempts,next_attempt_at<=now() AS due FROM chat_block_jobs WHERE blocker_id=$1",
      [a.id],
    )
  ).rows[0];
  assert.deepEqual(row, { attempts: 0, due: true });
  // Someone who was never in chat has no Stream user to block.
  await setBlock(db, a.id, c.id, true);
  assert.equal(await jobs(a.id, c.id), null);
  // A job goes with the account it is about.
  await db.query("DELETE FROM users WHERE id=$1", [b.id]);
  assert.equal(await jobs(a.id, b.id), null);
});

test("the list is the blocker's own, newest first, by keyset, without people the site blocked", async () => {
  const a = await person(),
    first = await person(),
    second = await person(),
    third = await person();
  for (const [who, at] of [
    [first, "2026-01-01T10:00:00Z"],
    [second, "2026-01-02T10:00:00Z"],
    [third, "2026-01-03T10:00:00Z"],
  ] as const) {
    await setBlock(db, a.id, who.id, true);
    await db.query(
      "UPDATE user_blocks SET created_at=$3 WHERE blocker_id=$1 AND blocked_id=$2",
      [a.id, who.id, at],
    );
  }
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [second.id]);
  const one = await blockedKeysetPage(db, a.id, 1, null);
  assert.deepEqual(
    one.rows.map((r) => [r.id, r.blocked_by_me]),
    [[third.id, true]],
  );
  assert.ok(one.next);
  const two = await blockedKeysetPage(db, a.id, 1, one.next);
  assert.deepEqual(
    two.rows.map((r) => r.id),
    [first.id],
    "the barred is skipped",
  );
  assert.equal(two.next, null);
  assert.deepEqual((await blockedKeysetPage(db, first.id, 5, null)).rows, []);
});

test("the export of the account carries its own list", async () => {
  const a = await person(),
    b = await person();
  await setBlock(db, a.id, b.id, true);
  const data = await exportAccount(db, a.id, "https://colabike.test");
  assert.deepEqual(
    data.blockedUsers.map((u) => [u.id, u.username]),
    [[b.id, b.username]],
  );
  const other = await exportAccount(db, b.id, "https://colabike.test");
  assert.deepEqual(other.blockedUsers, [], "the blocked person learns nothing");
});
