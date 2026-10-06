// API v1, the first writing operations (#305), through the real server and
// PostgreSQL: the Origin rule by credential, idempotent switches (like, follow,
// save), their races and budgets, and permissions that match the site.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  bikeLikeSchema,
  errorSchema,
  followResultSchema,
  saveResultSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "write-http-password-123";

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
  const email = `write-${label}-${run}@example.test`;
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
  await verifyCapturedEmail(email);
  // A cookie request, with the Origin the site sends unless a test says otherwise.
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  // A native client: a device session, a Bearer token and no Origin at all.
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const withToken = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    web,
    cookie: withCookie,
    token: withToken,
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
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
}

try {
  const owner = await member("owner");
  const actor = await member("actor");
  const other = await member("other");
  const barred = await member("barred");
  const limiter = await member("limiter");
  const bike = (await owner.web("/bikes", "POST", bikeBody("Публичный " + run)))
    .body.id;
  const closedBike = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;

  // ── Like: the Origin rule follows the credential ──────────────────────
  const like = `/bikes/${bike}/like`;
  assertError(
    await guest(like, { method: "PUT", origin: base }),
    401,
    "unauthorized",
    "guest",
  );
  const noOrigin = await actor.cookie(like, {
    method: "PUT",
    origin: undefined,
  });
  assertError(noOrigin, 403, "forbidden", "cookie without Origin");
  assertError(
    await actor.cookie(like, { method: "PUT", origin: "https://evil.test" }),
    403,
    "forbidden",
    "cookie with a foreign Origin",
  );
  assertError(
    await actor.cookie(like, { method: "DELETE", origin: undefined }),
    403,
    "forbidden",
    "cookie DELETE without Origin",
  );
  // Nothing was changed by the refused requests.
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM bike_likes WHERE bike_id=$1",
        [bike],
      )
    ).rows[0].n,
    0,
  );
  const liked = await actor.cookie(like, { method: "PUT" });
  assert.equal(liked.status, 200, liked.text);
  assert.deepEqual(bikeLikeSchema.parse(liked.body), { liked: true, likes: 1 });
  assert.equal(liked.headers.get("cache-control"), "no-store");
  // A repeat changes nothing.
  assert.deepEqual((await actor.cookie(like, { method: "PUT" })).body, {
    liked: true,
    likes: 1,
  });
  // Bearer needs no Origin; a second person's like counts.
  const second = await other.token(like, { method: "PUT" });
  assert.deepEqual(second.body, { liked: true, likes: 2 });
  assert.deepEqual((await other.token(like, { method: "DELETE" })).body, {
    liked: false,
    likes: 1,
  });
  assert.deepEqual((await other.token(like, { method: "DELETE" })).body, {
    liked: false,
    likes: 1,
  });
  assert.deepEqual((await actor.cookie(like, { method: "DELETE" })).body, {
    liked: false,
    likes: 0,
  });
  // The reading side sees the state.
  assert.equal((await actor.token("/bikes/" + bike)).body.liked, false);
  await actor.token(like, { method: "PUT" });
  assert.equal((await actor.token("/bikes/" + bike)).body.liked, true);
  assert.equal((await actor.token("/bikes/" + bike)).body.likes, 1);

  // cookie and Bearer together are refused, as everywhere in v1
  const both = await actor.cookie(like, {
    method: "PUT",
    headers: { authorization: "Bearer cola_at_" + "A".repeat(43) },
  });
  assertError(both, 400, "ambiguous_authentication", "both credentials");
  assertError(
    await guest(like, {
      method: "PUT",
      headers: { authorization: "Bearer cola_at_" + "A".repeat(43) },
    }),
    401,
    "invalid_token",
    "unknown token",
  );

  // permissions are the site's
  assertError(
    await owner.token(like, { method: "PUT" }),
    403,
    "forbidden",
    "own bike",
  );
  assertError(
    await actor.token(`/bikes/${closedBike}/like`, { method: "PUT" }),
    404,
    "not_found",
    "private bike",
  );
  assertError(
    await actor.token(`/bikes/${randomUUID()}/like`, { method: "PUT" }),
    404,
    "not_found",
    "missing",
  );
  assertError(
    await actor.token(`/bikes/not-a-uuid/like`, { method: "PUT" }),
    404,
    "not_found",
    "bad id",
  );

  // a race of equal requests ends in one state
  await actor.token(like, { method: "DELETE" });
  const race = await Promise.all(
    Array.from({ length: 12 }, () => other.token(like, { method: "PUT" })),
  );
  for (const r of race) {
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { liked: true, likes: 1 });
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM bike_likes WHERE bike_id=$1 AND user_id=$2",
        [bike, other.id],
      )
    ).rows[0].n,
    1,
  );
  const opposite = await Promise.all(
    [..."PDPDPDPD"].map((letter) =>
      other.token(like, { method: letter === "P" ? "PUT" : "DELETE" }),
    ),
  );
  for (const r of opposite) assert.equal(r.status, 200, r.text);
  const final = await other.token("/bikes/" + bike);
  assert.equal(
    final.body.liked,
    (
      await db.query(
        "SELECT count(*)::int n FROM bike_likes WHERE bike_id=$1 AND user_id=$2",
        [bike, other.id],
      )
    ).rows[0].n === 1,
    "the answer and the row agree",
  );

  // other methods
  for (const method of ["GET", "POST", "PATCH"]) {
    const r = await actor.token(like, { method });
    assertError(r, 405, "method_not_allowed", method);
    assert.match(r.headers.get("allow"), /PUT/);
    assert.match(r.headers.get("allow"), /DELETE/);
  }

  // ── Follow ────────────────────────────────────────────────────────────
  const follow = (who) => `/users/${who}/follow`;
  assertError(
    await guest(follow(owner.username), { method: "PUT", origin: base }),
    401,
    "unauthorized",
    "guest follow",
  );
  assertError(
    await actor.cookie(follow(owner.username), {
      method: "PUT",
      origin: undefined,
    }),
    403,
    "forbidden",
    "follow cookie without Origin",
  );
  // The owner already follows the actor, so they become friends.
  assert.equal(
    (await owner.token(follow(actor.username), { method: "PUT" })).status,
    200,
  );
  const followed = await actor.token(follow(owner.username), { method: "PUT" });
  assert.equal(followed.status, 200, followed.text);
  assert.deepEqual(followResultSchema.parse(followed.body), {
    relationship: {
      isSelf: false,
      following: true,
      followedBy: true,
      friends: true,
      blockedByMe: false,
    },
    followers: 1,
  });
  // By id as well; a repeat is the same answer.
  assert.deepEqual(
    (await actor.token(follow(owner.id), { method: "PUT" })).body,
    followed.body,
  );
  const unfollowed = await actor.cookie(follow(owner.username), {
    method: "DELETE",
  });
  assert.deepEqual(unfollowed.body, {
    relationship: {
      isSelf: false,
      following: false,
      followedBy: true,
      friends: false,
      blockedByMe: false,
    },
    followers: 0,
  });
  assert.deepEqual(
    (await actor.token(follow(owner.username), { method: "DELETE" })).body,
    unfollowed.body,
  );
  assertError(
    await actor.token(follow(actor.username), { method: "PUT" }),
    400,
    "invalid_request",
    "self",
  );
  assertError(
    await actor.token(follow("nobody-" + run), { method: "PUT" }),
    404,
    "not_found",
    "unknown",
  );
  assertError(
    await actor.token(follow(randomUUID()), { method: "PUT" }),
    404,
    "not_found",
    "unknown id",
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  assertError(
    await actor.token(follow(barred.username), { method: "PUT" }),
    404,
    "not_found",
    "blocked target",
  );
  assertError(
    await actor.token(follow(barred.id), { method: "PUT" }),
    404,
    "not_found",
    "blocked target by id",
  );
  const raceFollow = await Promise.all(
    Array.from({ length: 8 }, () =>
      other.token(follow(owner.username), { method: "PUT" }),
    ),
  );
  for (const r of raceFollow) {
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.relationship.following, true);
    assert.equal(r.body.followers, 1);
  }
  for (const method of ["GET", "POST"])
    assertError(
      await actor.token(follow(owner.username), { method }),
      405,
      "method_not_allowed",
      method,
    );

  // ── Save a journal entry ──────────────────────────────────────────────
  const entry = async (extra = {}) => {
    const r = await owner.web("/journal", "POST", {
      bikeId: bike,
      kind: "build",
      title: "Запись " + run,
      body: "Текст",
      status: "published",
      isPublic: true,
      eventDate: "2026-08-30",
      mileage: 100,
      componentIds: [],
      ...extra,
    });
    assert.equal(r.status, 201, r.text);
    return r.body.id ?? r.body.entry?.id;
  };
  const published = await entry();
  const draft = await entry({ status: "draft", isPublic: false });
  const save = (id) => `/journal/${id}/save`;
  assertError(
    await guest(save(published), { method: "PUT", origin: base }),
    401,
    "unauthorized",
    "guest save",
  );
  assertError(
    await actor.cookie(save(published), { method: "PUT", origin: undefined }),
    403,
    "forbidden",
    "save cookie without Origin",
  );
  const saved = await actor.token(save(published), { method: "PUT" });
  assert.deepEqual(saveResultSchema.parse(saved.body), { saved: true });
  assert.deepEqual(
    (await actor.cookie(save(published), { method: "PUT" })).body,
    { saved: true },
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM journal_saves WHERE user_id=$1 AND entry_id=$2",
        [actor.id, published],
      )
    ).rows[0].n,
    1,
  );
  assert.deepEqual(
    (await actor.token(save(published), { method: "DELETE" })).body,
    { saved: false },
  );
  assert.deepEqual(
    (await actor.token(save(published), { method: "DELETE" })).body,
    { saved: false },
  );
  assertError(
    await actor.token(save(draft), { method: "PUT" }),
    404,
    "not_found",
    "draft",
  );
  assertError(
    await actor.token(save(randomUUID()), { method: "PUT" }),
    404,
    "not_found",
    "missing",
  );
  assertError(
    await actor.token(save("not-a-uuid"), { method: "PUT" }),
    404,
    "not_found",
    "bad id",
  );
  // removing always works, even for an entry that is no longer public
  await actor.token(save(published), { method: "PUT" });
  await db.query("UPDATE journal_entries SET is_public=false WHERE id=$1", [
    published,
  ]);
  assert.deepEqual(
    (await actor.token(save(published), { method: "DELETE" })).body,
    { saved: false },
  );
  assertError(
    await actor.token(save(published), { method: "PUT" }),
    404,
    "not_found",
    "now private",
  );

  // ── Budgets: 429 with Retry-After ─────────────────────────────────────
  let limitedAt = 0;
  let last = null;
  for (let step = 1; step <= 70 && !limitedAt; step++) {
    last = await limiter.token(follow(owner.username), {
      method: step % 2 ? "PUT" : "DELETE",
    });
    if (last.status === 429) limitedAt = step;
    else assert.equal(last.status, 200, last.text);
  }
  assert.equal(limitedAt, 61, "the budget of follows is 60 per window");
  assertError(last, 429, "rate_limited", "follows over the budget");
  const wait = Number(last.headers.get("retry-after"));
  assert.ok(
    Number.isInteger(wait) && wait >= 1 && wait <= 900,
    "Retry-After " + wait,
  );
  // The state did not change on the refused request.
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM user_follows WHERE follower_id=$1",
        [limiter.id],
      )
    ).rows[0].n,
    0, // sixty alternating PUT and DELETE end with DELETE; the 61st was refused
  );

  console.log(
    "PASS: API v1 writes: Origin by credential, idempotent like/follow/save, races, budgets with Retry-After.",
  );
} finally {
  await db.end();
}
