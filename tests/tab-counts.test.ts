// #378: the numbers in the titles of a bike's tabs come from the same data as
// the lists they stand for — the whole number of entries a reader may see, and
// the discussion's own count with its replies — not from a preview or a page.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bikeCommentTotal,
  changeComment,
  commentPage,
  createComment,
} from "../lib/comments.ts";
import { journalInput, journalList, saveJournal } from "../lib/journal.ts";
import { showcase } from "../lib/showcase.ts";
import { bikeRow } from "./support/bikes.ts";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";

const entry = (bikeId: string, title: string, published: boolean) =>
  journalInput.parse({
    bikeId,
    kind: "story",
    title,
    body: "Короткая запись для счётчика вкладки.",
    status: published ? "published" : "draft",
    isPublic: published,
  });

test("the journal says how many entries a reader may see, not how many came on the page", async () => {
  const db = await testDatabase();
  try {
    const owner = await userRow(db, { username: "tabs-owner" });
    const reader = await userRow(db, { username: "tabs-reader" });
    const bike = await bikeRow(db, owner.id);
    for (let n = 1; n <= 22; n++)
      await db.transaction((q) =>
        saveJournal(q, owner.id, entry(bike.id, "Запись " + n, true)),
      );
    await db.transaction((q) =>
      saveJournal(q, owner.id, entry(bike.id, "Черновик", false)),
    );

    // A guest and another rider see the 22 published entries: the second page
    // of 20 does not change the whole.
    for (const viewer of [null, reader.id]) {
      const first = await journalList(db, bike.id, viewer);
      assert.equal(first.total, 22);
      assert.equal(first.entries.length, 20);
      assert.equal((await journalList(db, bike.id, viewer, 2)).total, 22);
    }
    // The owner has the draft among them.
    assert.equal((await journalList(db, bike.id, owner.id)).total, 23);

    // A closed bike has nothing to count for anyone but its owner.
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike.id]);
    assert.equal((await journalList(db, bike.id, null)).total, 0);
    assert.equal((await journalList(db, bike.id, reader.id)).total, 0);
    assert.equal((await journalList(db, bike.id, owner.id)).total, 23);
  } finally {
    await db.close();
  }
});

test("the discussion's total is the bike's own counter: replies included, a blocked author and a removed comment not", async () => {
  const db = await testDatabase();
  try {
    const owner = await userRow(db, { username: "talk-owner" });
    const guest = await userRow(db, { username: "talk-guest" });
    const other = await userRow(db, { username: "talk-other" });
    const bike = await bikeRow(db, owner.id);
    const add = (
      author: { id: string },
      body: string,
      parentId: string | null = null,
    ) =>
      db.transaction((q) =>
        createComment(
          q,
          bike.id,
          { id: author.id, role: "user" },
          { body, parentId },
        ),
      );
    const counter = async () =>
      (await showcase(db, null)).bikes.find((b) => b.id === bike.id)?.comments;

    assert.equal(await bikeCommentTotal(db, bike.id), 0);
    const first = await add(guest, "Первый");
    const reply = await add(owner, "Ответ", first.id);
    await add(other, "Ответ на ответ", reply.id);
    await add(other, "Второй");
    // Four comments in all, the replies among them, as the bike counts them.
    assert.equal(await bikeCommentTotal(db, bike.id), 4);
    assert.equal(await counter(), 4);

    // A blocked author's comments are not counted, here or in the counter.
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [other.id]);
    assert.equal(await bikeCommentTotal(db, bike.id), 2);
    assert.equal(await counter(), 2);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [other.id]);
    assert.equal(await bikeCommentTotal(db, bike.id), 4);

    // A removed comment (its author takes it back) leaves the number, and the
    // page of the discussion itself has not changed its shape for it.
    await db.transaction((q) =>
      changeComment(q, first.id, { id: guest.id, role: "user" }),
    );
    assert.equal(await bikeCommentTotal(db, bike.id), 3);
    assert.equal(await counter(), 3);
    const page = await commentPage(db, bike.id, null);
    assert.deepEqual(Object.keys(page).sort(), [
      "comments",
      "focusPath",
      "focused",
      "hasMore",
      "page",
    ]);
  } finally {
    await db.close();
  }
});
