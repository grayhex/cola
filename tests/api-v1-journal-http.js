// API v1, journal and comments (#301), through the real server and PostgreSQL:
// entries and their list per bike, comments of a bike and of an entry as one
// Comment, tombstones, deep links and keyset paging; legacy answers unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  commentPageSchema,
  errorSchema,
  journalEntrySchema,
  journalPageSchema,
  replyPageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "journal-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label) {
  const email = `journal-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: "Райдер " + label,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  await verifyCapturedEmail(email); // writing in public needs a confirmed address (#139)
  const v1 = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    web,
    v1,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const bikeBody = (name, isPublic = true) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: 9.5,
  is_public: isPublic,
});
const entryBody = (bikeId, extra = {}) => ({
  bikeId,
  kind: "build",
  title: "Запись " + run,
  body: "# Заголовок\n\nТекст **записи**.",
  status: "published",
  isPublic: true,
  eventDate: "2026-08-30",
  mileage: 1200,
  componentIds: [],
  ...extra,
});
const forbidden = /_|email|password|preferences|owner|share|blocked|"role"/;
const keysDeep = (value, found = new Set()) => {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, found);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysDeep(child, found);
    }
  return found;
};
function assertClean(label, body) {
  for (const key of keysDeep(body))
    assert.ok(
      !forbidden.test(key),
      `${label}: private or snake_case key ${key}`,
    );
}
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
}
const idsOf = (page) =>
  page.body.items.map((item) => item.comment?.id ?? item.id);

try {
  const owner = await member("owner");
  const reader = await member("reader");
  const barred = await member("barred");
  const stranger = await member("stranger");

  // ── Fixtures: bikes, entries, a component snapshot, likes, comments ────
  const publicBike = (
    await owner.web("/bikes", "POST", bikeBody("Публичный " + run))
  ).body.id;
  const closedBike = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;
  const component = randomUUID();
  await db.query(
    "INSERT INTO components(id,bike_id,section,category,name,price) VALUES($1,$2,'build','Рама','Frame X',1234.5)",
    [component, publicBike],
  );
  const create = async (body) => {
    const r = await owner.web("/journal", "POST", body);
    assert.equal(r.status, 201, r.text);
    return r.body.id ?? r.body.entry?.id;
  };
  const entries = [];
  for (const n of [1, 2, 3])
    entries.push(
      await create(
        entryBody(publicBike, {
          title: `Запись ${n} ${run}`,
          componentIds: n === 1 ? [component] : [],
        }),
      ),
    );
  const draft = await create(
    entryBody(publicBike, {
      title: "Черновик " + run,
      status: "draft",
      isPublic: false,
    }),
  );
  const closed = await create(
    entryBody(publicBike, { title: "Закрытая " + run, isPublic: false }),
  );
  const onClosedBike = await create(
    entryBody(closedBike, { title: "На закрытом " + run }),
  );
  assert.equal(
    (await reader.web(`/journal/${entries[0]}/like`, "PUT")).status,
    200,
  );

  // ── GET /journal/{id} ─────────────────────────────────────────────────
  const asGuest = await guest("/journal/" + entries[0]);
  assert.equal(asGuest.status, 200, asGuest.text);
  assert.deepEqual(journalEntrySchema.parse(asGuest.body), asGuest.body);
  assertClean("entry (guest)", asGuest.body);
  assert.equal(asGuest.body.id, entries[0]);
  assert.equal(asGuest.body.kind, "build");
  assert.equal(asGuest.body.status, "published");
  assert.match(asGuest.body.body, /^# Заголовок/);
  assert.equal(asGuest.body.author.id, owner.id);
  assert.equal(asGuest.body.bike.id, publicBike);
  assert.equal(asGuest.body.likes, 1);
  assert.equal(asGuest.body.liked, false, "a guest has liked nothing");
  assert.equal(asGuest.body.components.length, 1);
  assert.equal(asGuest.body.components[0].name, "Frame X");
  assert.equal(
    asGuest.body.components[0].price,
    null,
    "the owner does not show prices",
  );
  assert.ok(asGuest.body.components[0].capturedAt);
  assert.equal(asGuest.headers.get("cache-control"), "no-store");
  assert.ok(asGuest.headers.get("x-request-id"));
  const asReader = await reader.v1("/journal/" + entries[0]);
  assert.equal(asReader.body.liked, true);
  assert.equal(asReader.body.components[0].price, null);
  const asOwner = await owner.v1("/journal/" + entries[0]);
  assert.equal(
    asOwner.body.components[0].price,
    1234.5,
    "the owner sees their prices",
  );
  assert.equal(asOwner.body.liked, false);
  // Drafts, closed entries and entries of a closed bike are the owner's only.
  for (const [label, id] of [
    ["draft", draft],
    ["closed", closed],
    ["closed bike", onClosedBike],
  ]) {
    for (const viewer of [guest, reader.v1])
      assertError(await viewer("/journal/" + id), 404, "not_found", label);
    const mine = await owner.v1("/journal/" + id);
    assert.equal(mine.status, 200, label);
    assert.deepEqual(journalEntrySchema.parse(mine.body), mine.body);
  }
  assert.equal((await owner.v1("/journal/" + draft)).body.status, "draft");
  const missing = await guest("/journal/" + randomUUID());
  assertError(missing, 404, "not_found", "unknown id");
  for (const bad of ["not-a-uuid", "x".repeat(40), "%00"])
    assert.equal(
      (await guest("/journal/" + bad)).body.error.message,
      missing.body.error.message,
      "same answer for " + bad,
    );
  assert.equal(
    (await guest("/journal/" + draft)).body.error.message,
    missing.body.error.message,
    "a draft looks like a missing entry",
  );

  // ── GET /bikes/{id}/journal ───────────────────────────────────────────
  const list = await guest(`/bikes/${publicBike}/journal`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(journalPageSchema.parse(list.body), list.body);
  assertClean("journal list", list.body);
  assert.deepEqual(
    idsOf(list),
    [...entries].reverse(),
    "published public entries, newest first",
  );
  assert.ok(
    list.body.items.every(
      (item) => !("body" in item) && !("components" in item),
    ),
    "a list item has no full text",
  );
  assert.equal(list.body.nextCursor, null);
  assert.deepEqual(
    idsOf(await reader.v1(`/bikes/${publicBike}/journal`)),
    [...entries].reverse(),
  );
  const mine = await owner.v1(`/bikes/${publicBike}/journal`);
  assert.equal(
    mine.body.items.length,
    5,
    "the owner's drafts and closed entries too",
  );
  assert.ok(idsOf(mine).includes(draft) && idsOf(mine).includes(closed));
  // Pages of two, with a newer entry appearing mid-walk.
  const walk = async (midWalk) => {
    const seen = [];
    let cursor = null;
    let first = true;
    do {
      const page = await guest(
        `/bikes/${publicBike}/journal?limit=2${cursor ? "&cursor=" + cursor : ""}`,
      );
      assert.equal(page.status, 200, page.text);
      seen.push(...idsOf(page));
      if (first && midWalk) await midWalk();
      first = false;
      cursor = page.body.nextCursor;
    } while (cursor);
    return seen;
  };
  assert.deepEqual(await walk(), idsOf(list));
  assert.deepEqual(
    await walk(() => create(entryBody(publicBike, { title: "Свежая " + run }))),
    idsOf(list),
    "a new entry shifts nothing",
  );
  // A closed bike's journal is the owner's; everyone else sees a missing bike.
  assert.equal(
    (await owner.v1(`/bikes/${closedBike}/journal`)).body.items.length,
    1,
  );
  assertError(
    await guest(`/bikes/${closedBike}/journal`),
    404,
    "not_found",
    "closed bike",
  );
  assertError(
    await reader.v1(`/bikes/${closedBike}/journal`),
    404,
    "not_found",
    "closed bike / other",
  );
  assertError(
    await guest(`/bikes/${randomUUID()}/journal`),
    404,
    "not_found",
    "unknown bike",
  );
  assertError(
    await guest(`/bikes/${publicBike}/journal?scope=mine`),
    400,
    "invalid_request",
    "unknown parameter",
  );
  assertError(
    await guest(`/bikes/${publicBike}/journal?cursor=junk`),
    400,
    "invalid_request",
    "bad cursor",
  );

  // ── Comments of an entry and of a bike: one Comment for both ──────────
  const target = entries[1];
  const commentOn = async (
    who,
    body,
    parentId = null,
    path = `/journal/${target}/comments`,
  ) => {
    const r = await who.web(path, "POST", { body, parentId });
    assert.equal(r.status, 201, r.text);
    return r.body.comment?.id ?? r.body.id;
  };
  const root1 = await commentOn(reader, "Первый корень");
  const root2 = await commentOn(stranger, "Корень с ответами");
  const hiddenRoot = await commentOn(reader, "Будет удалён");
  const barredRoot = await commentOn(barred, "Заблокированного");
  const replies = [];
  for (const [i, who] of [owner, reader, owner, stranger].entries())
    replies.push(await commentOn(who, "Ответ " + (i + 1), root2));
  await commentOn(owner, "Ответ под удалённым", hiddenRoot);
  await commentOn(owner, "Ответ заблокированному", barredRoot);
  assert.equal(
    (await reader.web("/journal/comments/" + hiddenRoot, "DELETE")).status,
    200,
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  const comments = await guest(`/journal/${target}/comments`);
  assert.equal(comments.status, 200, comments.text);
  assert.deepEqual(commentPageSchema.parse(comments.body), comments.body);
  assertClean("comments", comments.body);
  assert.deepEqual(
    idsOf(comments),
    [root1, root2, hiddenRoot, barredRoot],
    "oldest first",
  );
  assert.deepEqual(comments.body.focusPath, []);
  const [t1, t2, tDeleted, tBlocked] = comments.body.items;
  assert.equal(t1.comment.body, "Первый корень");
  assert.equal(t1.comment.deleted, false);
  assert.equal(t1.comment.author.id, reader.id);
  assert.equal(t1.comment.parentId, null);
  assert.equal(t1.comment.editedAt, null);
  assert.deepEqual(t1.replies, []);
  assert.equal(t2.comment.replyCount, 4);
  assert.equal(t2.replies.length, 3, "a preview of three");
  assert.deepEqual(
    t2.replies.map((r) => r.id),
    replies.slice(0, 3),
  );
  assert.equal(t2.replies[0].parentId, root2);
  for (const tomb of [tDeleted, tBlocked]) {
    assert.equal(
      tomb.comment.deleted,
      true,
      "a tombstone while a reply remains",
    );
    assert.equal(tomb.comment.body, null);
    assert.equal(tomb.comment.author, null);
    assert.equal(tomb.comment.replyCount, 1);
  }
  const text = comments.text;
  assert.ok(
    !text.includes("Будет удалён") && !text.includes("Заблокированного"),
    "hidden text never leaves",
  );
  // The same reads by someone signed in; Bearer too.
  assert.deepEqual(
    (await reader.v1(`/journal/${target}/comments`)).body,
    comments.body,
    "comments are the same for every reader",
  );
  // Replies of one comment, paged.
  const allReplies = await guest(
    `/journal/${target}/comments/${root2}/replies`,
  );
  assert.deepEqual(replyPageSchema.parse(allReplies.body), allReplies.body);
  assert.deepEqual(idsOf(allReplies), replies);
  const r1 = await guest(
    `/journal/${target}/comments/${root2}/replies?limit=3`,
  );
  const r2 = await guest(
    `/journal/${target}/comments/${root2}/replies?limit=3&cursor=${r1.body.nextCursor}`,
  );
  assert.deepEqual([...idsOf(r1), ...idsOf(r2)], replies);
  assert.equal(r2.body.nextCursor, null);
  assertError(
    await guest(`/journal/${target}/comments/${randomUUID()}/replies`),
    404,
    "not_found",
    "unknown comment",
  );
  assertError(
    await guest(`/journal/${entries[2]}/comments/${root2}/replies`),
    404,
    "not_found",
    "comment of another entry",
  );
  // focus: the thread and the chain, no paging.
  const focused = await guest(
    `/journal/${target}/comments?focus=${replies[3]}`,
  );
  assert.equal(focused.status, 200, focused.text);
  assert.deepEqual(commentPageSchema.parse(focused.body), focused.body);
  assert.deepEqual(
    focused.body.focusPath.map((c) => c.id),
    [root2, replies[3]],
  );
  assert.deepEqual(idsOf(focused), [root2]);
  assert.ok(
    focused.body.items[0].replies.some((r) => r.id === replies[3]),
    "the focused reply is in its thread",
  );
  assert.equal(focused.body.nextCursor, null);
  assertError(
    await guest(`/journal/${target}/comments?focus=${hiddenRoot}`),
    404,
    "not_found",
    "focus on a deleted comment",
  );
  assertError(
    await guest(`/journal/${target}/comments?focus=${randomUUID()}`),
    404,
    "not_found",
    "focus on nothing",
  );
  assertError(
    await guest(`/journal/${target}/comments?focus=${root2}&cursor=abc`),
    400,
    "invalid_request",
    "focus with a cursor",
  );
  assertError(
    await guest(`/journal/${target}/comments?focus=junk`),
    400,
    "invalid_request",
    "bad focus",
  );
  // Paging of roots by position.
  const first = await guest(`/journal/${target}/comments?limit=2`);
  const second = await guest(
    `/journal/${target}/comments?limit=2&cursor=${first.body.nextCursor}`,
  );
  assert.deepEqual([...idsOf(first), ...idsOf(second)], idsOf(comments));
  assert.equal(second.body.nextCursor, null);
  // Comments exist only for public entries.
  for (const id of [draft, closed, onClosedBike])
    assertError(
      await owner.v1(`/journal/${id}/comments`),
      404,
      "not_found",
      "no comments for a closed entry, even the owner's",
    );

  // Bike comments are the same Comment.
  const bikeRoot = await commentOn(
    reader,
    "К велосипеду",
    null,
    `/community/bikes/${publicBike}/comments`,
  );
  await commentOn(
    owner,
    "Ответ владельца",
    bikeRoot,
    `/community/bikes/${publicBike}/comments`,
  );
  const bikeComments = await guest(`/bikes/${publicBike}/comments`);
  assert.equal(bikeComments.status, 200, bikeComments.text);
  assert.deepEqual(
    commentPageSchema.parse(bikeComments.body),
    bikeComments.body,
  );
  assert.equal(bikeComments.body.items[0].comment.body, "К велосипеду");
  assert.equal(bikeComments.body.items[0].replies[0].body, "Ответ владельца");
  assert.deepEqual(
    Object.keys(bikeComments.body.items[0].comment).sort(),
    Object.keys(t1.comment).sort(),
    "one Comment for every target",
  );
  const bikeReplies = await guest(
    `/bikes/${publicBike}/comments/${bikeRoot}/replies`,
  );
  assert.equal(bikeReplies.body.items.length, 1);
  const deepLink = await guest(
    `/bikes/${publicBike}/comments?focus=${bikeReplies.body.items[0].id}`,
  );
  assert.deepEqual(
    deepLink.body.focusPath.map((c) => c.id),
    [bikeRoot, bikeReplies.body.items[0].id],
  );
  assertError(
    await guest(`/bikes/${closedBike}/comments`),
    404,
    "not_found",
    "comments of a closed bike",
  );
  assertError(
    await owner.v1(`/bikes/${closedBike}/comments`),
    404,
    "not_found",
    "even for the owner",
  );

  // ── Credentials and methods ───────────────────────────────────────────
  assertError(
    await guest("/journal/" + entries[0], {
      headers: { authorization: "Bearer junk" },
    }),
    401,
    "invalid_token",
    "bad Bearer is not a guest",
  );
  assertError(
    await owner.v1(`/journal/${target}/comments`, {
      headers: { authorization: "Bearer junk" },
    }),
    400,
    "ambiguous_authentication",
    "cookie and Bearer",
  );
  const device = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email: `journal-reader-${run}@example.test`,
      password,
      device: { name: "Phone", platform: "ios" },
    },
  });
  assert.equal(device.status, 201, device.text);
  const viaBearer = await guest("/journal/" + entries[0], {
    headers: { authorization: "Bearer " + device.body.accessToken },
  });
  assert.equal(
    viaBearer.body.liked,
    true,
    "a device session is the same viewer",
  );
  for (const path of [
    `/journal/${target}`,
    `/journal/${target}/comments`,
    `/journal/${target}/comments/${root2}/replies`,
    `/bikes/${publicBike}/journal`,
    `/bikes/${publicBike}/comments`,
    `/bikes/${publicBike}/comments/${bikeRoot}/replies`,
  ])
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await guest(path, { method, origin: base });
      assertError(r, 405, "method_not_allowed", method + " " + path);
      assert.match(r.headers.get("allow"), /GET/);
    }

  // ── Legacy is unchanged ───────────────────────────────────────────────
  const legacyList = await http(`/api/journal?bikeId=${publicBike}`);
  assert.equal(legacyList.status, 200);
  assert.ok(
    Array.isArray(legacyList.body.entries),
    "legacy list keeps OFFSET shape",
  );
  const legacyComments = await http(
    `/api/community/bikes/${publicBike}/comments`,
  );
  assert.equal(legacyComments.status, 200);
  assert.ok(
    "comments" in legacyComments.body &&
      "page" in legacyComments.body &&
      "hasMore" in legacyComments.body,
    "legacy keeps OFFSET paging",
  );
  const document = (await guest("/openapi.json")).body;
  for (const path of [
    "/journal/{id}",
    "/bikes/{id}/journal",
    "/bikes/{id}/comments",
    "/journal/{id}/comments",
    "/bikes/{id}/comments/{commentId}/replies",
    "/journal/{id}/comments/{commentId}/replies",
  ])
    assert.ok(document.paths[path].get, path);
  console.log(
    "PASS: API v1 journal and comments: entries, lists, comments, tombstones, previews, deep links, paging and legacy unchanged.",
  );
} finally {
  await db.end();
}
