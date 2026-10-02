import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commentKeysetPage, replyKeysetPage } from "../lib/comments.ts";
import { entitySocial } from "../lib/entity-social.ts";
import {
  journalKeysetPage,
  journalPhotos,
  journalRow,
} from "../lib/journal.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import {
  toComment,
  toJournalEntry,
  toJournalSummary,
} from "../lib/api-v1/mappers.ts";
import { decodeCursor, encodeCursor } from "../lib/api-v1/cursor.ts";
import {
  commentSchema,
  commentsQuerySchema,
  journalEntrySchema,
  journalSummarySchema,
  parseCommentsQuery,
} from "../lib/api-v1/schemas.ts";

// API v1, journal and comments (#301): visibility, the one Comment for every
// target, tombstones, previews, deep links and keyset paging. The HTTP layer
// end to end is tests/api-v1-journal-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

const stamp = (n, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label, { blocked = false } = {}) {
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
async function addBike(owner, { isPublic = true, prices = false } = {}) {
  const id = await insertBike(
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
  if (prices)
    await db.query(
      "UPDATE bikes SET show_component_prices=true,show_accessory_prices=true WHERE id=$1",
      [id],
    );
  return id;
}
const snapshot = [
  {
    id: randomUUID(),
    model_id: null,
    section: "build",
    category: "Рама",
    name: "Frame X",
    notes: "",
    url: "",
    group_id: "frame",
    sort_order: 0,
    price: "1234.50",
    capturedAt: "2026-09-01T10:00:00.000Z",
  },
  {
    id: randomUUID(),
    model_id: null,
    section: "accessories",
    category: "Звонок",
    name: "Bell",
    notes: "n",
    url: "",
    group_id: "",
    sort_order: 1,
    price: "99",
    capturedAt: "2026-09-01T10:00:00.000Z",
  },
];
async function addEntry(
  owner,
  bike,
  {
    status = "published",
    isPublic = true,
    kind = "build",
    at = stamp(1),
    components = snapshot,
    title = "Запись",
  } = {},
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,components,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-08-30',1200,$10::jsonb,$11,$11)`,
    [
      id,
      randomUUID(),
      owner,
      bike,
      kind,
      title,
      "# Заголовок\n\nТекст **записи**.",
      status,
      isPublic,
      JSON.stringify(components),
      at,
    ],
  );
  return id;
}
async function addComment(
  table,
  target,
  author,
  body,
  { parent = null, at = stamp(2), deleted = false } = {},
) {
  const id = randomUUID();
  const column = table === "bike_comments" ? "bike_id" : "entry_id";
  await db.query(
    `INSERT INTO ${table}(id,${column},author_id,parent_id,body,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`,
    [id, target, author, parent, deleted ? "" : body, at, deleted ? at : null],
  );
  return id;
}
const forbiddenKey = /_|email|password|preferences|owner|share|blocked|role/;
function keysOf(value) {
  const keys = [];
  JSON.stringify(value, (key, child) => (keys.push(key), child));
  return keys.filter(Boolean);
}

test("an entry: owner sees drafts and closed entries, everyone else only published public ones of a public bike", async () => {
  const owner = await addUser("owner");
  const other = await addUser("other");
  const publicBike = await addBike(owner);
  const privateBike = await addBike(owner, { isPublic: false });
  const open = await addEntry(owner, publicBike);
  const draft = await addEntry(owner, publicBike, {
    status: "draft",
    isPublic: false,
  });
  const closed = await addEntry(owner, publicBike, { isPublic: false });
  const onPrivate = await addEntry(owner, privateBike);
  const seen = async (id, viewer) => !!(await journalRow(db, id, viewer, "id"));
  for (const viewer of [null, other, owner])
    assert.equal(await seen(open, viewer), true, "open");
  for (const [label, id] of [
    ["draft", draft],
    ["closed", closed],
    ["private bike", onPrivate],
  ]) {
    assert.equal(await seen(id, null), false, label + " / guest");
    assert.equal(await seen(id, other), false, label + " / other");
    assert.equal(await seen(id, owner), true, label + " / owner");
  }
  assert.equal(await journalRow(db, randomUUID(), owner, "id"), null);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
  for (const viewer of [null, other, owner])
    assert.equal(
      await seen(open, viewer),
      false,
      "a blocked author's entry is nobody's",
    );
});

test("JournalEntry: strict, camelCase, prices by the bike's settings, liked by the viewer", async () => {
  const owner = await addUser("writer");
  const reader = await addUser("reader");
  const hidden = await addBike(owner);
  const shown = await addBike(owner, { prices: true });
  const hiddenEntry = await addEntry(owner, hidden);
  const shownEntry = await addEntry(owner, shown);
  await db.query("INSERT INTO journal_likes(entry_id,user_id) VALUES($1,$2)", [
    hiddenEntry,
    reader,
  ]);
  const read = async (id, viewer) => {
    const row = await journalRow(db, id, viewer, "id");
    return toJournalEntry(row, await journalPhotos(db, id), viewer);
  };
  const asGuest = await read(hiddenEntry, null);
  assert.deepEqual(journalEntrySchema.parse(asGuest), asGuest);
  assert.deepEqual(
    asGuest.components.map((c) => c.price),
    [null, null],
    "a guest sees no price the owner hides",
  );
  assert.equal(asGuest.liked, false);
  assert.equal(asGuest.likes, 1);
  assert.equal((await read(hiddenEntry, reader)).liked, true);
  assert.deepEqual(
    (await read(hiddenEntry, owner)).components.map((c) => c.price),
    [1234.5, 99],
    "the owner sees their prices",
  );
  assert.deepEqual(
    (await read(shownEntry, reader)).components.map((c) => c.price),
    [1234.5, 99],
    "shown when the owner shows them",
  );
  assert.equal(
    asGuest.body.startsWith("# Заголовок"),
    true,
    "the Markdown source",
  );
  assert.equal(asGuest.eventDate, "2026-08-30");
  assert.equal(asGuest.mileage, 1200);
  assert.equal(asGuest.components[0].capturedAt, "2026-09-01T10:00:00.000Z");
  assert.deepEqual(asGuest.photos, []);
  assert.equal(asGuest.status, "published");
  const keys = keysOf(asGuest);
  assert.ok(
    keys.every((key) => !forbiddenKey.test(key)),
    "private or snake_case key in " + keys.filter((k) => forbiddenKey.test(k)),
  );
  const summary = toJournalSummary(
    await journalRow(db, hiddenEntry, null, "id"),
    null,
  );
  assert.deepEqual(journalSummarySchema.parse(summary), summary);
  assert.match(summary.excerpt, /Заголовок/);
  assert.ok(
    !("body" in summary) && !("components" in summary),
    "a list item carries no full text",
  );
});

test("a bike's journal pages by position without repeats while entries appear", async () => {
  const owner = await addUser("pager");
  const other = await addUser("pager2");
  const bike = await addBike(owner);
  const ids = [];
  // Three entries share one instant: only the id breaks the tie.
  for (const at of [stamp(1), stamp(2), stamp(2), stamp(2), stamp(3), stamp(4)])
    ids.push(await addEntry(owner, bike, { at }));
  const draft = await addEntry(owner, bike, {
    status: "draft",
    isPublic: false,
    at: stamp(5),
  });
  const walk = async (viewer, limit, midWalk) => {
    const seen = [];
    let after = null;
    let first = true;
    for (;;) {
      const page = await journalKeysetPage(db, bike, viewer, limit, after);
      seen.push(...page.rows.map((r) => r.id));
      if (first && midWalk) await midWalk();
      first = false;
      if (!page.next) return seen;
      after = decodeCursor(encodeCursor(page.next));
    }
  };
  const asOther = await walk(other, 50);
  assert.equal(asOther.length, 6);
  assert.ok(!asOther.includes(draft), "a draft is the owner's only");
  const asOwner = await walk(owner, 50);
  assert.equal(asOwner.length, 7);
  assert.equal(asOwner[0], draft, "newest first");
  for (const limit of [1, 2, 3])
    assert.deepEqual(await walk(other, limit), asOther, "limit " + limit);
  const during = await walk(other, 2, () =>
    addEntry(owner, bike, { at: stamp(20) }),
  );
  assert.deepEqual(
    during,
    asOther,
    "a newer entry sorts before the cursor and shifts nothing",
  );
});

for (const [name, table, make, social] of [
  ["a bike", "bike_comments", async (owner) => addBike(owner), null],
  [
    "a journal entry",
    "journal_comments",
    async (owner) => addEntry(owner, await addBike(owner)),
    entitySocial("journal"),
  ],
]) {
  const roots = (id, options) =>
    social
      ? social.keysetPage(db, id, options)
      : commentKeysetPage(db, id, options);
  const replies = (id, parent, options) =>
    social
      ? social.keysetReplies(db, id, parent, options)
      : replyKeysetPage(db, id, parent, options);
  const plain = { limit: 50, cursor: null, focus: null };

  test(`comments of ${name}: one Comment, tombstones only above readable replies, previews of three`, async () => {
    const owner = await addUser("host");
    const a = await addUser("alice");
    const b = await addUser("bob");
    const barred = await addUser("barred", { blocked: true });
    const target = await make(owner);
    const c1 = await addComment(table, target, a, "Первый", { at: stamp(1) });
    const c2 = await addComment(table, target, a, "Удалённый с ответом", {
      at: stamp(2),
      deleted: true,
    });
    const c3 = await addComment(
      table,
      target,
      barred,
      "Заблокированного с ответом",
      { at: stamp(3) },
    );
    await addComment(table, target, a, "Удалённый без ответов", {
      at: stamp(4),
      deleted: true,
    });
    const c5 = await addComment(table, target, b, "С пятью ответами", {
      at: stamp(5),
    });
    await addComment(table, target, b, "Ответ под удалённым", {
      parent: c2,
      at: stamp(6),
    });
    await addComment(table, target, a, "Ответ заблокированному", {
      parent: c3,
      at: stamp(7),
    });
    const replyIds = [];
    for (let i = 1; i <= 5; i++)
      replyIds.push(
        await addComment(table, target, i % 2 ? a : b, "Ответ " + i, {
          parent: c5,
          at: stamp(10 + i),
        }),
      );
    // A blocked person's reply and a deleted reply do not count.
    await addComment(table, target, barred, "Скрытый ответ", {
      parent: c5,
      at: stamp(20),
    });
    await addComment(table, target, a, "Удалённый ответ", {
      parent: c5,
      at: stamp(21),
      deleted: true,
    });
    const page = await roots(target, plain);
    const items = page.roots.map((t) => ({
      comment: toComment(t.comment),
      replies: t.replies.map(toComment),
    }));
    assert.deepEqual(
      items.map((t) => t.comment.id),
      [c1, c2, c3, c5],
      "roots without readable content are not listed",
    );
    for (const thread of items)
      for (const c of [thread.comment, ...thread.replies])
        assert.deepEqual(commentSchema.parse(c), c);
    const [first, deleted, blocked, five] = items;
    assert.deepEqual(
      { ...first.comment, createdAt: undefined },
      {
        id: c1,
        parentId: null,
        author: first.comment.author,
        body: "Первый",
        createdAt: undefined,
        editedAt: null,
        deleted: false,
        replyCount: 0,
      },
    );
    assert.equal(first.comment.author.username.startsWith("alice"), true);
    for (const tomb of [deleted, blocked]) {
      assert.equal(tomb.comment.deleted, true);
      assert.equal(tomb.comment.body, null);
      assert.equal(tomb.comment.author, null);
      assert.equal(tomb.comment.editedAt, null);
      assert.equal(tomb.comment.replyCount, 1);
      assert.equal(tomb.replies.length, 1);
    }
    assert.equal(five.comment.replyCount, 5, "readable replies only");
    assert.deepEqual(
      five.replies.map((r) => r.id),
      replyIds.slice(0, 3),
      "a preview of the first three",
    );
    assert.equal(five.replies[0].parentId, c5);
    // The rest are one call away.
    const more = await replies(target, c5, { limit: 2, cursor: null });
    assert.deepEqual(
      more.replies.map((r) => r.id),
      replyIds.slice(0, 2),
    );
    const next = await replies(target, c5, {
      limit: 2,
      cursor: decodeCursor(encodeCursor(more.next)),
    });
    assert.deepEqual(
      next.replies.map((r) => r.id),
      replyIds.slice(2, 4),
    );
    const last = await replies(target, c5, { limit: 2, cursor: next.next });
    assert.deepEqual(
      last.replies.map((r) => r.id),
      replyIds.slice(4),
    );
    assert.equal(last.next, null);
    const text = JSON.stringify(items);
    assert.ok(
      !text.includes("Скрытый ответ") &&
        !text.includes("Удалённый ответ") &&
        !text.includes("Заблокированного с ответом"),
    );
    assert.ok(keysOf(items).every((key) => !forbiddenKey.test(key)));
  });

  test(`comments of ${name}: roots page by position, ties by id, without repeats`, async () => {
    const owner = await addUser("host2");
    const a = await addUser("carol");
    const target = await make(owner);
    const ids = [];
    // Three roots share one instant.
    for (const at of [
      stamp(1),
      stamp(2),
      stamp(2),
      stamp(2),
      stamp(3),
      stamp(4),
      stamp(5),
    ])
      ids.push(await addComment(table, target, a, "К " + ids.length, { at }));
    const walk = async (limit, midWalk) => {
      const seen = [];
      let cursor = null;
      let first = true;
      for (;;) {
        const page = await roots(target, { limit, cursor, focus: null });
        seen.push(...page.roots.map((t) => t.comment.id));
        if (first && midWalk) await midWalk();
        first = false;
        if (!page.next) return seen;
        cursor = decodeCursor(encodeCursor(page.next));
      }
    };
    const whole = await walk(50);
    assert.equal(whole.length, 7);
    assert.equal(new Set(whole).size, 7);
    assert.equal(whole[0], ids[0]);
    assert.deepEqual(
      whole.slice(1, 4),
      ids.slice(1, 4).sort(),
      "equal instants: by id",
    );
    for (const limit of [1, 2, 3, 6])
      assert.deepEqual(await walk(limit), whole, "limit " + limit);
    const late = [];
    const during = await walk(2, async () =>
      late.push(await addComment(table, target, a, "Позже", { at: stamp(25) })),
    );
    assert.deepEqual(
      during,
      [...whole, late[0]],
      "nothing repeats or is skipped; the new comment is last",
    );
  });

  test(`comments of ${name}: focus returns the thread and the chain, hidden or foreign ids are not found`, async () => {
    const owner = await addUser("host3");
    const a = await addUser("dave");
    const target = await make(owner);
    await addComment(table, target, a, "Первый корень", { at: stamp(1) });
    const root = await addComment(table, target, a, "Ветка", { at: stamp(2) });
    const replyIds = [];
    for (let i = 1; i <= 5; i++)
      replyIds.push(
        await addComment(table, target, a, "Ответ " + i, {
          parent: root,
          at: stamp(10 + i),
        }),
      );
    const deep = replyIds[4]; // past the preview of three
    const page = await roots(target, { limit: 20, cursor: null, focus: deep });
    assert.deepEqual(
      page.roots.map((t) => t.comment.id),
      [root],
      "the thread of the root only",
    );
    assert.deepEqual(
      page.focusPath.map((r) => r.id),
      [root, deep],
      "root first, the comment last",
    );
    assert.ok(
      page.roots[0].replies.some((r) => r.id === deep),
      "the focused reply is inside its thread",
    );
    assert.equal(page.next, null);
    assert.deepEqual(
      (
        await roots(target, { limit: 20, cursor: null, focus: root })
      ).focusPath.map((r) => r.id),
      [root],
    );
    const gone = await addComment(table, target, a, "", {
      at: stamp(30),
      deleted: true,
    });
    for (const bad of [gone, randomUUID()])
      await assert.rejects(
        roots(target, { limit: 20, cursor: null, focus: bad }),
        (e) => e.status === 404,
        "focus " + bad,
      );
    const other = await make(owner);
    const foreign = await addComment(table, other, a, "Чужое", {
      at: stamp(2),
    });
    await assert.rejects(
      roots(target, { limit: 20, cursor: null, focus: foreign }),
      (e) => e.status === 404,
      "a comment of another target",
    );
    await assert.rejects(
      replies(target, foreign, { limit: 20, cursor: null }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      replies(target, randomUUID(), { limit: 20, cursor: null }),
      (e) => e.status === 404,
    );
    const noCommentsOnPlain = await roots(target, plain);
    assert.deepEqual(noCommentsOnPlain.focusPath, [], "no focus, no chain");
  });
}

test("comments need a public target: closed bikes, drafts and blocked owners have none", async () => {
  const owner = await addUser("closed");
  const a = await addUser("erin");
  const closedBike = await addBike(owner, { isPublic: false });
  await addComment("bike_comments", closedBike, a, "x");
  await assert.rejects(
    commentKeysetPage(db, closedBike, { limit: 5, cursor: null, focus: null }),
    (e) => e.status === 404,
  );
  const bike = await addBike(owner);
  const draft = await addEntry(owner, bike, {
    status: "draft",
    isPublic: false,
  });
  const hiddenEntry = await addEntry(owner, bike, { isPublic: false });
  const social = entitySocial("journal");
  for (const entry of [draft, hiddenEntry, randomUUID()])
    await assert.rejects(
      social.keysetPage(db, entry, { limit: 5, cursor: null, focus: null }),
      (e) => e.status === 404,
    );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
  await assert.rejects(
    commentKeysetPage(db, bike, { limit: 5, cursor: null, focus: null }),
    (e) => e.status === 404,
  );
});

test("an edited comment says so; an unedited one does not", async () => {
  const owner = await addUser("host4");
  const a = await addUser("frank");
  const bike = await addBike(owner);
  const id = await addComment("bike_comments", bike, a, "Правка", {
    at: stamp(2),
  });
  const fresh = (
    await commentKeysetPage(db, bike, { limit: 5, cursor: null, focus: null })
  ).roots[0].comment;
  assert.equal(toComment(fresh).editedAt, null);
  await db.query(
    "UPDATE bike_comments SET body='Правка 2',updated_at=$2 WHERE id=$1",
    [id, stamp(3)],
  );
  const edited = (
    await commentKeysetPage(db, bike, { limit: 5, cursor: null, focus: null })
  ).roots[0].comment;
  assert.equal(toComment(edited).editedAt, new Date(stamp(3)).toISOString());
  assert.equal(toComment(edited).body, "Правка 2");
});

test("the comments query: limit, cursor and focus; focus replaces the cursor", () => {
  const focus = randomUUID();
  assert.deepEqual(Object.keys(commentsQuerySchema.shape).sort(), [
    "cursor",
    "focus",
    "limit",
  ]);
  assert.equal(
    parseCommentsQuery(new URL("http://x.test/?focus=" + focus)).focus,
    focus,
  );
  for (const query of [
    "?focus=junk",
    `?focus=${focus}&cursor=abc`,
    "?scope=mine",
    "?limit=0",
    "?focus=" + focus + "&focus=" + focus,
  ])
    assert.throws(
      () => parseCommentsQuery(new URL("http://x.test/" + query)),
      (e) => e.code === "invalid_request",
      query,
    );
});
