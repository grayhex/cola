// API v1, blocking people and reporting objects (#354), through the real server
// and PostgreSQL: who may do it, what a block cuts (follows, notices, search,
// the follow itself), that the blocked person is never told, what the list of
// the blocker shows, and the report that reaches the queue of the site.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  blockResultSchema,
  errorSchema,
  reportReceiptSchema,
  userPageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const run = randomUUID().slice(0, 8);
const password = "blocks-http-password-123";

async function http(
  path,
  { method = "GET", headers = {}, body, origin, raw } = {},
) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
  const email = `blocks-${label}-${run}@example.test`;
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
    // The surname is the one thing a search by this person can be told by.
    name: "Блоков" + label + run,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  await verifyCapturedEmail(email);
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  return {
    id: registered.body.user.id,
    name: "Блоков" + label + run,
    web,
    cookie: (path, options = {}) =>
      http("/api/v1" + path, {
        origin: base,
        ...options,
        headers: { cookie, ...(options.headers ?? {}) },
      }),
    // A native client: a Bearer token and no Origin at all.
    token: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: {
          authorization: "Bearer " + grant.body.accessToken,
          ...(options.headers ?? {}),
        },
      }),
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const bikeBody = (name) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: 9.5,
  is_public: true,
});
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
}
const count = async (sql, values = []) =>
  Number((await db.query(sql, values)).rows[0].count);
const notices = (recipient, actor, type = "like") =>
  count(
    "SELECT count(*) FROM notifications WHERE recipient_id=$1 AND actor_id=$2 AND type=$3",
    [recipient, actor, type],
  );

try {
  const alice = await member("alice");
  const bob = await member("bob");
  const carol = await member("carol");
  const bike = (await alice.web("/bikes", "POST", bikeBody("Первый " + run)))
    .body.id;
  const second = (await alice.web("/bikes", "POST", bikeBody("Второй " + run)))
    .body.id;
  const block = (who) => `/users/${who.id}/block`;

  // ── Who may block ─────────────────────────────────────────────────────
  assertError(
    await guest(block(bob), { method: "PUT", origin: base }),
    401,
    "unauthorized",
    "guest",
  );
  assertError(await guest("/me/blocked"), 401, "unauthorized", "guest list");
  assertError(
    await alice.cookie(block(bob), { method: "PUT", origin: undefined }),
    403,
    "forbidden",
    "a cookie without the Origin of the site",
  );
  assertError(
    await alice.cookie(block(bob), {
      method: "PUT",
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "a cookie from a foreign origin",
  );
  assertError(
    await alice.token(block(alice), { method: "PUT" }),
    400,
    "invalid_request",
    "oneself",
  );
  assertError(
    await alice.token(`/users/${randomUUID()}/block`, { method: "PUT" }),
    404,
    "not_found",
    "an unknown person",
  );
  assertError(
    await alice.token("/users/not a ref!/block", { method: "PUT" }),
    404,
    "not_found",
    "a bad reference",
  );
  assertError(
    await alice.token(block(bob) + "?x=1", { method: "PUT" }),
    400,
    "invalid_request",
    "no parameters",
  );
  assert.equal((await alice.token(block(bob), { method: "POST" })).status, 405);

  // ── What is between them before the block ─────────────────────────────
  assert.equal(
    (await alice.token(`/users/${bob.id}/follow`, { method: "PUT" })).status,
    200,
  );
  assert.equal(
    (await bob.token(`/users/${alice.id}/follow`, { method: "PUT" })).status,
    200,
  );
  assert.equal(
    (await bob.token(`/bikes/${bike}/like`, { method: "PUT" })).status,
    200,
  );
  assert.equal(await notices(alice.id, bob.id), 1, "the like of Bob");
  const before = await alice.token("/me/notifications");
  assert.ok(
    before.body.items.some((n) => n.actor?.id === bob.id),
    "the notice is in the inbox",
  );
  assert.equal(
    (await alice.token("/experience/users?q=" + encodeURIComponent(bob.name)))
      .body.items.length,
    1,
    "Bob is found",
  );

  // ── Blocking ──────────────────────────────────────────────────────────
  const blocked = await alice.token(block(bob), { method: "PUT" });
  assert.equal(blocked.status, 200, blocked.text);
  assert.deepEqual(blockResultSchema.parse(blocked.body), { blocked: true });
  assert.equal(blocked.headers.get("cache-control"), "no-store");
  // Repeating it is the same state, not an error.
  const again = await alice.cookie(block(bob), { method: "PUT" });
  assert.equal(again.status, 200, again.text);
  assert.deepEqual(again.body, { blocked: true });
  assert.equal(
    await count("SELECT count(*) FROM user_blocks WHERE blocker_id=$1", [
      alice.id,
    ]),
    1,
  );

  // The follows are cut both ways, and the viewer's own view says so.
  const bobForAlice = await alice.token(`/users/${bob.id}`);
  assert.equal(bobForAlice.status, 200, bobForAlice.text);
  assert.deepEqual(bobForAlice.body.relationship, {
    isSelf: false,
    following: false,
    followedBy: false,
    friends: false,
    blockedByMe: true,
  });
  assert.equal(bobForAlice.body.counts.following, 0);
  assert.equal(
    await count(
      "SELECT count(*) FROM user_follows WHERE follower_id=ANY($1::uuid[]) AND following_id=ANY($1::uuid[])",
      [[alice.id, bob.id]],
    ),
    0,
  );

  // The list of the blocker, and nobody else's.
  const list = await alice.token("/me/blocked");
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(userPageSchema.parse(list.body), list.body);
  assert.deepEqual(
    list.body.items.map((u) => [u.id, u.relationship.blockedByMe]),
    [[bob.id, true]],
  );
  assert.equal(list.body.nextCursor, null);
  assert.deepEqual((await bob.token("/me/blocked")).body.items, []);
  assert.deepEqual((await carol.token("/me/blocked")).body.items, []);
  assertError(
    await alice.token("/me/blocked?limit=0"),
    400,
    "invalid_request",
    "a bad limit",
  );

  // The blocked person is not told: the profile is open, the block is not shown.
  const aliceForBob = await bob.token(`/users/${alice.id}`);
  assert.equal(aliceForBob.status, 200, aliceForBob.text);
  assert.deepEqual(aliceForBob.body.relationship, {
    isSelf: false,
    following: false,
    followedBy: false,
    friends: false,
    blockedByMe: false,
  });
  // …but neither can follow the other, and says only "unavailable".
  assertError(
    await bob.token(`/users/${alice.id}/follow`, { method: "PUT" }),
    404,
    "not_found",
    "the blocked one follows",
  );
  assertError(
    await alice.token(`/users/${bob.id}/follow`, { method: "PUT" }),
    404,
    "not_found",
    "the blocker follows",
  );
  // Unfollowing stays open (it changes nothing here, and never fails).
  assert.equal(
    (await bob.token(`/users/${alice.id}/follow`, { method: "DELETE" })).status,
    200,
  );

  // Notices: the old one is gone from the inbox, and a new one is never made.
  const after = await alice.token("/me/notifications");
  assert.ok(
    !after.body.items.some((n) => n.actor?.id === bob.id),
    "the notice of the blocked person is hidden",
  );
  assert.equal(
    (await bob.token(`/bikes/${second}/like`, { method: "PUT" })).status,
    200,
  );
  assert.equal(await notices(alice.id, bob.id), 1, "no new notice");
  assert.equal(await notices(bob.id, alice.id, "follow"), 1, "the old one");

  // Search hides them from each other, and from nobody else.
  const found = async (who, target) =>
    (await who.token("/experience/users?q=" + encodeURIComponent(target.name)))
      .body.items.length;
  assert.equal(await found(alice, bob), 0, "the blocker does not find them");
  assert.equal(await found(bob, alice), 0, "nor do they find the blocker");
  assert.equal(await found(carol, bob), 1, "others find Bob");
  assert.equal(await found(carol, alice), 1, "others find Alice");

  // ── Unblocking ────────────────────────────────────────────────────────
  const freed = await alice.token(block(bob), { method: "DELETE" });
  assert.equal(freed.status, 200, freed.text);
  assert.deepEqual(blockResultSchema.parse(freed.body), { blocked: false });
  assert.deepEqual(
    (await alice.cookie(block(bob), { method: "DELETE" })).body,
    { blocked: false },
    "a repeat",
  );
  assert.deepEqual((await alice.token("/me/blocked")).body.items, []);
  // The follows the block cut do not come back.
  const bobFree = await alice.token(`/users/${bob.id}`);
  assert.equal(bobFree.body.relationship.following, false);
  assert.equal(bobFree.body.relationship.blockedByMe, false);
  assert.equal(await found(alice, bob), 1, "found again");
  assert.equal(
    (await bob.token(`/users/${alice.id}/follow`, { method: "PUT" })).status,
    200,
    "Bob can follow again",
  );

  // ── A person the site has blocked ─────────────────────────────────────
  const barred = await member("barred");
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  assertError(
    await alice.token(block(barred), { method: "PUT" }),
    404,
    "not_found",
    "a person blocked by the site",
  );

  // ── The list pages by keyset, newest block first ──────────────────────
  const crowd = [];
  for (const label of ["c1", "c2", "c3"]) crowd.push(await member(label));
  for (const person of crowd)
    assert.equal(
      (await carol.token(block(person), { method: "PUT" })).status,
      200,
    );
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const response = await carol.token(
      "/me/blocked?limit=2" + (cursor ? "&cursor=" + cursor : ""),
    );
    assert.equal(response.status, 200, response.text);
    seen.push(...response.body.items.map((u) => u.id));
    cursor = response.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(
    seen,
    crowd.map((p) => p.id).reverse(),
    "newest first, every person once",
  );

  // ── Reports ───────────────────────────────────────────────────────────
  const report = (who, body, options = {}) =>
    who.token("/reports", { method: "POST", body, ...options });
  assertError(
    await guest("/reports", {
      method: "POST",
      origin: base,
      body: { entityType: "profile", targetId: bob.id, reason: "spam" },
    }),
    401,
    "unauthorized",
    "guest report",
  );
  assertError(
    await carol.cookie("/reports", {
      method: "POST",
      origin: undefined,
      body: { entityType: "profile", targetId: bob.id, reason: "spam" },
    }),
    403,
    "forbidden",
    "a cookie without the Origin",
  );
  for (const [label, body] of [
    [
      "an unknown kind",
      { entityType: "chat", targetId: bob.id, reason: "spam" },
    ],
    [
      "an unknown reason",
      { entityType: "profile", targetId: bob.id, reason: "x" },
    ],
    ["no id", { entityType: "profile", reason: "spam" }],
    ["a bad id", { entityType: "profile", targetId: "1", reason: "spam" }],
    [
      "a field that is not in the contract",
      { entityType: "profile", targetId: bob.id, reason: "spam", note: "x" },
    ],
  ])
    assertError(await report(carol, body), 400, "invalid_request", label);
  assert.equal(
    (
      await carol.token("/reports", {
        method: "POST",
        raw: "x".repeat(3000),
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await carol.token("/reports", {
        method: "POST",
        raw: "a=1",
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal((await carol.token("/reports")).status, 405);

  const first = await report(carol, {
    entityType: "profile",
    targetId: bob.id,
    reason: "abuse",
  });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(reportReceiptSchema.parse(first.body), { created: true });
  // The same person and the same object: a success that makes no second row.
  const repeat = await report(carol, {
    entityType: "profile",
    targetId: bob.id,
    reason: "spam",
  });
  assert.equal(repeat.status, 200, repeat.text);
  assert.deepEqual(repeat.body, { created: false });
  assert.equal(
    await count(
      "SELECT count(*) FROM community_reports WHERE reporter_id=$1 AND entity_type='profile' AND target_id=$2",
      [carol.id, bob.id],
    ),
    1,
  );
  // A bike of someone else, the same queue.
  assert.deepEqual(
    (
      await report(carol, {
        entityType: "bike",
        targetId: bike,
        reason: "inappropriate",
      })
    ).body,
    { created: true },
  );
  assert.equal(
    await count(
      "SELECT count(*) FROM community_reports WHERE reporter_id=$1 AND status='open'",
      [carol.id],
    ),
    2,
  );
  assertError(
    await report(alice, { entityType: "bike", targetId: bike, reason: "spam" }),
    400,
    "invalid_request",
    "one's own content",
  );
  assertError(
    await report(alice, {
      entityType: "profile",
      targetId: alice.id,
      reason: "spam",
    }),
    400,
    "invalid_request",
    "one's own profile",
  );
  assertError(
    await report(alice, {
      entityType: "ride",
      targetId: randomUUID(),
      reason: "spam",
    }),
    404,
    "not_found",
    "an object that is not there",
  );
  assertError(
    await report(alice, {
      entityType: "profile",
      targetId: barred.id,
      reason: "spam",
    }),
    404,
    "not_found",
    "a person blocked by the site",
  );

  // The budget is the site's: ten a window, then 429 with the wait.
  const eager = await member("eager");
  let limit = null;
  for (let i = 0; i < 12 && !limit; i++) {
    const response = await report(eager, {
      entityType: "profile",
      targetId: randomUUID(),
      reason: "spam",
    });
    if (response.status === 429) limit = response;
    else assert.equal(response.status, 404, response.text);
  }
  assert.ok(limit, "the budget of reports");
  assert.equal(limit.body.error.code, "rate_limited");
  assert.ok(Number(limit.headers.get("retry-after")) > 0);

  console.log("api v1 blocks http: ok");
} finally {
  await db.end();
}
