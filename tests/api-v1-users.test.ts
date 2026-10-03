import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { followKeysetPage } from "../lib/follows.ts";
import { profileCounts, profileRow, profileRowById } from "../lib/profiles.ts";
import { visibleBikePage } from "../lib/showcase.ts";
import { toProfile, toUserSummary } from "../lib/api-v1/mappers.ts";
import {
  errorSchema,
  pageQuerySchema,
  parsePageQuery,
  profileSchema,
  userPageSchema,
  userRefSchema,
  userSummarySchema,
} from "../lib/api-v1/schemas.ts";
import { testDatabase } from "./support/database.ts";
import { bikeThroughWriter } from "./support/bikes.ts";
import { labelledUser } from "./support/people.ts";
import { decodeCursor, encodeCursor } from "../lib/api-v1/cursor.ts";

// API v1, people (#300): the profile and follow reads and their rules. The
// HTTP layer end to end is tests/api-v1-users-http.js.

type VisibleQuery = Parameters<typeof visibleBikePage>[2];
type FollowCursor = Parameters<typeof followKeysetPage>[5];
const db = await testDatabase();
after(() => db.close());

async function addUser(label: string, { blocked = false } = {}) {
  const row = await labelledUser(db, label, {
    blocked,
    bio: "О себе",
    location: "Тула",
  });
  return { id: row.id, username: row.username };
}
async function addBike(
  owner: { id: string },
  isPublic = true,
  createdAt: string | null = null,
) {
  const id = await bikeThroughWriter(db, owner.id, { is_public: isPublic });
  if (createdAt)
    await db.query("UPDATE bikes SET created_at=$1 WHERE id=$2", [
      createdAt,
      id,
    ]);
  return id;
}
const follow = (
  follower: { id: string },
  target: { id: string },
  at: string | null = null,
) =>
  db.query(
    "INSERT INTO user_follows(follower_id,following_id,created_at) VALUES($1,$2,coalesce($3::timestamptz,now()))",
    [follower.id, target.id, at],
  );

test("{ref}: a UUID or a username, never both, nothing else", () => {
  const id = randomUUID();
  assert.deepEqual(userRefSchema.parse(id), { id });
  assert.deepEqual(userRefSchema.parse(id.toUpperCase()), { id });
  assert.deepEqual(userRefSchema.parse("ivan.petrov-1"), {
    username: "ivan.petrov-1",
  });
  assert.deepEqual(userRefSchema.parse("abc"), { username: "abc" });
  assert.deepEqual(userRefSchema.parse("a".repeat(30)), {
    username: "a".repeat(30),
  });
  for (const bad of [
    "",
    "ab",
    "a".repeat(31),
    "a".repeat(36), // as long as a UUID, but not one
    "has space",
    "кириллица",
    "x/../y",
    id + "x",
    "%00abc",
  ])
    assert.equal(
      userRefSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
});

test("a profile is found by id or current username, never when blocked or renamed away", async () => {
  const person = await addUser("rider");
  const byName = await profileRow(db, person.username.toUpperCase(), null);
  const byId = await profileRowById(db, person.id, null);
  assert.equal(byName.id, person.id);
  assert.equal(byId.id, person.id);
  assert.equal(await profileRowById(db, randomUUID(), null), null);
  // An old username from the rename history does not resolve.
  const renamed = person.username + "-new";
  await db.query("UPDATE users SET username=$2 WHERE id=$1", [
    person.id,
    renamed,
  ]);
  assert.equal(await profileRow(db, person.username, null), null);
  assert.equal((await profileRow(db, renamed, null)).id, person.id);
  assert.equal((await profileRowById(db, person.id, null)).username, renamed);
  // A blocked person has no profile, by either key.
  const barred = await addUser("barred", { blocked: true });
  assert.equal(await profileRow(db, barred.username, null), null);
  assert.equal(await profileRowById(db, barred.id, null), null);
});

test("the relationship belongs to the viewer: guest none, other, self, mutual", async () => {
  const a = await addUser("a");
  const b = await addUser("b");
  const asGuest = toProfile(
    await profileRowById(db, a.id, null),
    await profileCounts(db, a.id),
    false,
  );
  assert.equal(asGuest.relationship, null);
  const self = toProfile(
    await profileRowById(db, a.id, a.id),
    await profileCounts(db, a.id),
    true,
  );
  assert.deepEqual(self.relationship, {
    isSelf: true,
    following: false,
    followedBy: false,
    friends: false,
  });
  await follow(b, a);
  const asB = toProfile(
    await profileRowById(db, a.id, b.id),
    await profileCounts(db, a.id),
    true,
  );
  assert.deepEqual(asB.relationship, {
    isSelf: false,
    following: true,
    followedBy: false,
    friends: false,
  });
  await follow(a, b);
  const mutual = toProfile(
    await profileRowById(db, a.id, b.id),
    await profileCounts(db, a.id),
    true,
  );
  assert.deepEqual(mutual.relationship, {
    isSelf: false,
    following: true,
    followedBy: true,
    friends: true,
  });
});

test("counts: public bikes only, followers and following without blocked people", async () => {
  const person = await addUser("counted");
  await addBike(person, true);
  await addBike(person, true);
  await addBike(person, false);
  const f1 = await addUser("f1");
  const f2 = await addUser("f2");
  const gone = await addUser("gone", { blocked: true });
  const target = await addUser("target");
  await follow(f1, person);
  await follow(f2, person);
  await follow(gone, person);
  await follow(person, target);
  await follow(person, gone);
  const counts = toProfile(
    await profileRowById(db, person.id, null),
    await profileCounts(db, person.id),
    false,
  ).counts;
  assert.deepEqual(counts, { bikes: 2, followers: 2, following: 1 });
});

test("DTOs are strict and carry no private field", async () => {
  const person = await addUser("strict");
  const viewer = await addUser("viewer");
  const row = await profileRowById(db, person.id, viewer.id);
  const profile = toProfile(row, await profileCounts(db, person.id), true);
  assert.deepEqual(profileSchema.parse(profile), profile);
  const summary = toUserSummary(row, true);
  assert.deepEqual(userSummarySchema.parse(summary), summary);
  // Whatever a row carries, only the named fields reach the DTO.
  const leaky = {
    ...row,
    email: "x@y.z",
    password_hash: "h",
    preferences: { a: 1 },
    role: "admin",
    blocked: false,
  };
  for (const dto of [
    toProfile(leaky, await profileCounts(db, person.id), true),
    toUserSummary(leaky, true),
  ]) {
    const text = JSON.stringify(dto);
    assert.doesNotMatch(
      text,
      /x@y\.z|password|preferences|"role"|blocked|admin/,
    );
    const keys: string[] = [];
    JSON.stringify(dto, (key, value) => (keys.push(key), value));
    assert.ok(
      keys.every((key) => !key.includes("_")),
      "camelCase only: " + keys.filter((k) => k.includes("_")),
    );
  }
  assert.throws(
    () => profileSchema.parse({ ...profile, email: "x" }),
    "strict",
  );
});

test("a person's bikes: public ones of that owner only, private never, blocked owner none", async () => {
  const owner = await addUser("owner");
  const other = await addUser("other");
  const publicBike = await addBike(owner, true);
  const privateBike = await addBike(owner, false);
  const othersBike = await addBike(other, true);
  const page = (viewerId: string | null, extra: Partial<VisibleQuery> = {}) =>
    visibleBikePage(db, viewerId, {
      scope: "public",
      categories: [],
      search: "",
      limit: 50,
      after: null,
      ownerId: owner.id,
      ...extra,
    });
  for (const viewer of [null, other.id, owner.id]) {
    const ids = (await page(viewer)).bikes.map((b) => b.id);
    assert.deepEqual(
      ids,
      [publicBike],
      "viewer " + (viewer ? "signed in" : "guest"),
    );
    assert.ok(!ids.includes(privateBike) && !ids.includes(othersBike));
  }
  // The owner's own full list is still /bikes?scope=mine.
  const mine = await visibleBikePage(db, owner.id, {
    scope: "mine",
    categories: [],
    search: "",
    limit: 50,
    after: null,
  });
  assert.ok(mine.bikes.some((b) => b.id === privateBike));
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner.id]);
  assert.deepEqual(
    (await page(null)).bikes,
    [],
    "a blocked owner's bikes are not served",
  );
});

test("a person's bikes page without repeats or gaps while new ones appear", async () => {
  const owner = await addUser("pager");
  const ids = [];
  for (let i = 0; i < 7; i++)
    ids.push(await addBike(owner, true, `2026-09-0${i + 1}T10:00:00.000100Z`));
  const newestFirst = [...ids].reverse();
  const seen = [];
  let after = null;
  let inserted = false;
  for (;;) {
    const page = await visibleBikePage(db, null, {
      scope: "public",
      categories: [],
      search: "",
      limit: 3,
      after,
      ownerId: owner.id,
    });
    seen.push(...page.bikes.map((b) => b.id));
    if (!inserted) {
      // A newer bike appears between pages: it sorts before the cursor.
      await addBike(owner, true, "2026-10-01T10:00:00.000100Z");
      inserted = true;
    }
    if (!page.next) break;
    after = decodeCursor(encodeCursor(page.next));
  }
  assert.deepEqual(seen, newestFirst);
});

test("followers and following: keyset, ties by id, no repeats when a follow is added mid-walk", async () => {
  const target = await addUser("celebrity");
  const fans = [];
  for (let i = 0; i < 6; i++) fans.push(await addUser("fan" + i));
  // Three follows share one instant: only the id breaks the tie.
  const instants = [
    "2026-09-01T10:00:00.000100Z",
    "2026-09-02T10:00:00.000100Z",
    "2026-09-02T10:00:00.000100Z",
    "2026-09-02T10:00:00.000100Z",
    "2026-09-03T10:00:00.000100Z",
    "2026-09-03T10:00:00.000200Z",
  ];
  for (const [i, fan] of fans.entries()) await follow(fan, target, instants[i]);
  const walk = async (limit: number, midWalk?: () => Promise<unknown>) => {
    const seen: string[] = [];
    let after: FollowCursor = null;
    let step = 0;
    for (;;) {
      const page = await followKeysetPage(
        db,
        target.id,
        null,
        "followers",
        limit,
        after,
      );
      seen.push(...page.rows.map((r) => r.id));
      if (step++ === 0 && midWalk) await midWalk();
      if (!page.next) return seen;
      after = decodeCursor(encodeCursor(page.next));
    }
  };
  const whole = await walk(50);
  assert.equal(whole.length, 6);
  assert.equal(new Set(whole).size, 6);
  // Newest first; among equal instants the larger id first.
  const tied = fans
    .slice(1, 4)
    .map((f) => f.id)
    .sort()
    .reverse();
  assert.deepEqual(whole.slice(whole.length - 4, whole.length - 1), tied);
  for (const limit of [1, 2, 3, 5])
    assert.deepEqual(await walk(limit), whole, "limit " + limit);
  const late = await addUser("late");
  const during = await walk(2, () => follow(late, target));
  assert.deepEqual(
    during,
    whole,
    "a new follow sorts before the cursor and shifts nothing",
  );
  assert.equal(
    (await followKeysetPage(db, target.id, null, "followers", 50, null)).rows[0]
      .id,
    late.id,
  );
  // Following is the other direction.
  const followingOf = await followKeysetPage(
    db,
    fans[0].id,
    null,
    "following",
    50,
    null,
  );
  assert.deepEqual(
    followingOf.rows.map((r) => r.id),
    [target.id],
  );
  assert.equal(followingOf.next, null);
});

test("lists hide blocked people and show relationships to the viewer", async () => {
  const target = await addUser("subject");
  const fine = await addUser("fine");
  const barred = await addUser("barred2");
  const viewer = await addUser("viewing");
  await follow(fine, target);
  await follow(barred, target);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  await follow(viewer, fine);
  await follow(fine, viewer);
  const asGuest = await followKeysetPage(
    db,
    target.id,
    null,
    "followers",
    50,
    null,
  );
  assert.deepEqual(
    asGuest.rows.map((r) => r.id),
    [fine.id],
  );
  assert.equal(toUserSummary(asGuest.rows[0], false).relationship, null);
  const asViewer = await followKeysetPage(
    db,
    target.id,
    viewer.id,
    "followers",
    50,
    null,
  );
  assert.deepEqual(toUserSummary(asViewer.rows[0], true).relationship, {
    isSelf: false,
    following: true,
    followedBy: true,
    friends: true,
  });
  const page = {
    items: asViewer.rows.map((r) => toUserSummary(r, true)),
    nextCursor: null,
  };
  assert.deepEqual(userPageSchema.parse(page), page);
});

test("the page query is limit and cursor only; the error code set is open", () => {
  assert.deepEqual(Object.keys(pageQuerySchema.shape).sort(), [
    "cursor",
    "limit",
  ]);
  assert.equal(parsePageQuery(new URL("http://x.test/?limit=7")).limit, 7);
  for (const query of [
    "?scope=mine",
    "?q=x",
    "?category=road",
    "?limit=0",
    "?limit=51",
    "?cursor=",
    "?limit=1&limit=2",
  ])
    assert.throws(
      () => parsePageQuery(new URL("http://x.test/" + query)),
      { code: "invalid_request" },
      query,
    );
  // A client written today must parse an error with a code added tomorrow.
  const future = { error: { code: "quota_exceeded", message: "позже" } };
  assert.deepEqual(errorSchema.parse(future), future);
});
