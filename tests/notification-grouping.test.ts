import test, { after } from "node:test";
import assert from "node:assert/strict";
import { notify } from "../lib/notifications.ts";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { bikeCommentRow } from "./support/notifications.ts";

// One event is told from a group of events (#341). An event is identified by
// its comment: repeating it changes nothing. A group is what one author does
// to one object in a quarter of an hour. Events of a group add nothing while the
// notice of the group is unread (it opens the first unread comment) and, once
// that notice has been read, the next event gets a notice of its own, so that a
// direct reply after the previous one was read is not lost.

const db = await testDatabase();
after(() => db.close());

async function scene() {
  const owner = (await userRow(db)).id;
  const author = (await userRow(db)).id;
  const bike = (await bikeRow(db, owner)).id;
  const comment = async () => (await bikeCommentRow(db, bike, author)).id;
  const notices = async () =>
    (
      await db.query<{
        id: string;
        comment_id: string;
        read_at: Date | null;
        dedup_key: string;
        group_key: string | null;
      }>(
        "SELECT id,comment_id,read_at,dedup_key,group_key FROM notifications WHERE recipient_id=$1 ORDER BY created_at,id",
        [owner],
      )
    ).rows;
  const say = (commentId: string, type = "comment") =>
    notify(db, {
      recipient: owner,
      actor: author,
      type,
      bike,
      comment: commentId,
    });
  return { owner, author, bike, comment, notices, say };
}

test("events of one group add nothing to the unread notice, which opens the first comment", async () => {
  const s = await scene();
  const first = await s.comment();
  const second = await s.comment();
  const third = await s.comment();

  await s.say(first);
  await s.say(second);
  await s.say(third);

  const rows = await s.notices();
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].comment_id,
    first,
    "the notice opens the first unread comment; the rest is under it",
  );
  assert.equal(rows[0].read_at, null);
  assert.ok(
    rows[0].group_key,
    "a new notice of a discussion carries its group",
  );
});

test("repeating one event changes nothing", async () => {
  const s = await scene();
  const first = await s.comment();

  await s.say(first);
  await s.say(first);
  const [before] = await s.notices();
  await s.say(first);

  const rows = await s.notices();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].comment_id, first);
  assert.deepEqual(rows[0], before);
});

test("a reply after the previous one was read is a notice of its own, and the read one stays read", async () => {
  const s = await scene();
  const first = await s.comment();
  await s.say(first);
  const [seen] = await s.notices();
  await db.query("UPDATE notifications SET read_at=now() WHERE id=$1", [
    seen.id,
  ]);

  const second = await s.comment();
  await s.say(second);

  const rows = await s.notices();
  assert.equal(rows.length, 2, "the new reply is not lost");
  assert.notEqual(rows[0].read_at, null, "the old notice keeps its read state");
  assert.equal(rows[0].comment_id, first, "and its comment");
  assert.equal(rows[1].read_at, null);
  assert.equal(rows[1].comment_id, second);
  assert.equal(rows[1].group_key, rows[0].group_key ?? rows[0].dedup_key);
});

test("the new notice of a read group is itself folded into until it is read, and one event is never doubled", async () => {
  const s = await scene();
  const first = await s.comment();
  await s.say(first);
  await db.query("UPDATE notifications SET read_at=now()");

  const second = await s.comment();
  const third = await s.comment();
  await s.say(second);
  await s.say(second);
  await s.say(third);

  const rows = await s.notices();
  assert.equal(rows.length, 2);
  assert.equal(
    rows[1].comment_id,
    second,
    "the unread notice of the group opens the first unread comment",
  );
});

test("another author or another object is another group", async () => {
  const s = await scene();
  const other = (await userRow(db)).id;
  const second = (await bikeRow(db, s.owner)).id;
  const first = await s.comment();
  await s.say(first);
  const byOther = (await bikeCommentRow(db, s.bike, other)).id;
  await notify(db, {
    recipient: s.owner,
    actor: other,
    type: "comment",
    bike: s.bike,
    comment: byOther,
  });
  const elsewhere = (await bikeCommentRow(db, second, s.author)).id;
  await notify(db, {
    recipient: s.owner,
    actor: s.author,
    type: "comment",
    bike: second,
    comment: elsewhere,
  });

  assert.equal((await s.notices()).length, 3);
});

test("a reply and a comment are different events of different groups", async () => {
  const s = await scene();
  const first = await s.comment();
  const reply = await s.comment();
  await s.say(first, "comment");
  await s.say(reply, "reply");

  assert.equal((await s.notices()).length, 2);
});

test("likes and follows keep their single lifetime notice", async () => {
  const owner = (await userRow(db)).id;
  const fan = (await userRow(db)).id;
  const bike = (await bikeRow(db, owner)).id;
  await notify(db, { recipient: owner, actor: fan, type: "follow" });
  await notify(db, { recipient: owner, actor: fan, type: "follow" });
  await notify(db, { recipient: owner, actor: fan, type: "like", bike });
  await notify(db, { recipient: owner, actor: fan, type: "like", bike });

  const rows = (
    await db.query<{ type: string; group_key: string | null }>(
      "SELECT type,group_key FROM notifications WHERE recipient_id=$1 ORDER BY type",
      [owner],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.type),
    ["follow", "like"],
  );
  assert.ok(rows.every((r) => r.group_key === null));
});
