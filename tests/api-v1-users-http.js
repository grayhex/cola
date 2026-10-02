// API v1, people (#300), through the real server and PostgreSQL: profiles,
// a person's public bikes and the follow lists, for guest, other, self and a
// blocked viewer or profile; keyset paging; refs; legacy answers unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  bikePageSchema,
  errorSchema,
  profileSchema,
  userPageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "users-http-password-123";

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
// A signed-in person: a cookie for the web API and for /api/v1.
async function member(label, { verified = false } = {}) {
  const email = `people-${label}-${run}@example.test`;
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
  // Publishing a bike needs a confirmed address (#139): use the real link.
  if (verified) await verifyCapturedEmail(email);
  const v1 = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    email,
    web,
    v1,
    cookie: () => cookie,
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
const hiddenKeys = [
  "email",
  "role",
  "preferences",
  "password_hash",
  "blocked",
  "avatar_id",
  "owner_id",
  "share_id",
  "public_id",
  "token_hash",
];
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
  for (const key of keysDeep(body)) {
    assert.doesNotMatch(key, /_/, `${label}: snake_case key ${key}`);
    assert.ok(!hiddenKeys.includes(key), `${label}: hidden key ${key}`);
  }
}
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert.ok(response.headers.get("x-request-id"), label + ": request id");
}

try {
  const owner = await member("owner", { verified: true });
  const reader = await member("reader");
  const barred = await member("barred");
  const fans = [];
  for (let i = 1; i <= 5; i++) fans.push(await member("fan" + i));

  // ── Fixtures ───────────────────────────────────────────────────────────
  const publicBikes = [];
  for (const n of [1, 2, 3]) {
    const created = await owner.web(
      "/bikes",
      "POST",
      bikeBody(`Публичный ${n} ${run}`),
    );
    assert.equal(created.status, 201, created.text);
    publicBikes.push(created.body.id);
  }
  const secret = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;
  const follow = async (who, target) =>
    assert.equal(
      (await who.web(`/social/profiles/${target.username}/follow`, "PUT"))
        .status,
      200,
    );
  for (const fan of fans) await follow(fan, owner);
  await follow(barred, owner);
  await follow(reader, owner);
  await follow(owner, reader); // reader and owner follow each other
  await follow(owner, fans[0]);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);

  // ── GET /users/{ref} ───────────────────────────────────────────────────
  const asGuest = await guest("/users/" + owner.username);
  assert.equal(asGuest.status, 200, asGuest.text);
  assert.deepEqual(profileSchema.parse(asGuest.body), asGuest.body);
  assertClean("profile (guest)", asGuest.body);
  assert.equal(asGuest.body.id, owner.id);
  assert.equal(asGuest.body.username, owner.username);
  assert.equal(asGuest.body.relationship, null, "a guest has no relationship");
  assert.deepEqual(
    asGuest.body.counts,
    { bikes: 3, followers: 6, following: 2 },
    "public bikes; the blocked follower is not counted",
  );
  assert.equal(asGuest.headers.get("cache-control"), "no-store");
  assert.ok(asGuest.headers.get("x-request-id"));
  // Every way to name the same person.
  for (const ref of [
    owner.id,
    owner.id.toUpperCase(),
    owner.username.toUpperCase(),
  ]) {
    const same = await guest("/users/" + ref);
    assert.equal(same.status, 200, ref);
    assert.deepEqual(same.body, asGuest.body, ref);
  }
  const asReader = await reader.v1("/users/" + owner.username);
  assert.deepEqual(asReader.body.relationship, {
    isSelf: false,
    following: true,
    followedBy: true,
    friends: true,
  });
  assert.deepEqual((await owner.v1("/users/" + owner.id)).body.relationship, {
    isSelf: true,
    following: false,
    followedBy: false,
    friends: false,
  });
  assert.deepEqual(
    (await fans[1].v1("/users/" + owner.username)).body.relationship,
    { isSelf: false, following: true, followedBy: false, friends: false },
  );
  assertClean("profile (reader)", asReader.body);

  // ── Refs that name nobody all look alike ──────────────────────────────
  const missing = await guest("/users/" + randomUUID());
  assertError(missing, 404, "not_found", "unknown id");
  for (const ref of [
    "ab",
    "a".repeat(31),
    "a".repeat(36),
    "no such person",
    "x%2Fy",
    "кириллица",
    "nobody-" + run,
  ]) {
    const response = await guest("/users/" + ref);
    assertError(response, 404, "not_found", "ref " + ref);
    assert.equal(
      response.body.error.message,
      missing.body.error.message,
      "the same answer: " + ref,
    );
  }
  assertError(
    await guest("/users/" + barred.username),
    404,
    "not_found",
    "blocked by username",
  );
  assertError(
    await guest("/users/" + barred.id),
    404,
    "not_found",
    "blocked by id",
  );
  assert.equal(
    (await guest("/users/" + barred.id)).body.error.message,
    missing.body.error.message,
    "a blocked person looks like a missing one",
  );
  for (const tail of ["bikes", "followers", "following"])
    assertError(
      await guest(`/users/${barred.id}/${tail}`),
      404,
      "not_found",
      "blocked " + tail,
    );
  // A blocked viewer's session is gone: they are a guest, and see what a guest sees.
  const blockedViewer = await barred.v1("/users/" + owner.username);
  assert.equal(blockedViewer.status, 200);
  assert.equal(
    blockedViewer.body.relationship,
    null,
    "a blocked viewer is a guest",
  );

  // ── Old usernames are not refs; the id is the stable key ──────────────
  const renamer = await member("renamer");
  const oldName = renamer.username;
  const newName = "renamed-" + run;
  assert.equal(
    (
      await renamer.web("/social/me", "PATCH", {
        username: newName,
        name: "Новый",
        bio: "",
        location: "",
      })
    ).status,
    200,
  );
  assertError(
    await guest("/users/" + oldName),
    404,
    "not_found",
    "old username",
  );
  assert.equal((await guest("/users/" + newName)).body.id, renamer.id);
  assert.equal((await guest("/users/" + renamer.id)).body.username, newName);

  // ── GET /users/{ref}/bikes ─────────────────────────────────────────────
  for (const [label, viewer] of [
    ["guest", guest],
    ["reader", reader.v1],
    ["owner", owner.v1],
  ]) {
    const response = await viewer(`/users/${owner.username}/bikes`);
    assert.equal(response.status, 200, label + response.text);
    assert.deepEqual(bikePageSchema.parse(response.body), response.body, label);
    assertClean("bikes (" + label + ")", response.body);
    const ids = response.body.items.map((b) => b.id);
    assert.deepEqual([...ids].sort(), [...publicBikes].sort(), label);
    assert.ok(
      !ids.includes(secret),
      label + ": a private bike never appears on a profile",
    );
  }
  const firstPage = await guest(`/users/${owner.id}/bikes?limit=2`);
  assert.equal(firstPage.body.items.length, 2);
  assert.ok(firstPage.body.nextCursor);
  const secondPage = await guest(
    `/users/${owner.id}/bikes?limit=2&cursor=${firstPage.body.nextCursor}`,
  );
  assert.equal(secondPage.body.items.length, 1);
  assert.equal(secondPage.body.nextCursor, null);
  assert.deepEqual(
    [...firstPage.body.items, ...secondPage.body.items].map((b) => b.id),
    (await guest(`/users/${owner.id}/bikes`)).body.items.map((b) => b.id),
    "pages join up without repeats",
  );
  for (const query of [
    "?scope=mine",
    "?q=x",
    "?category=road",
    "?limit=0",
    "?limit=51",
    "?cursor=junk",
    "?limit=1&limit=2",
    "?page=2",
  ])
    assertError(
      await guest(`/users/${owner.id}/bikes${query}`),
      400,
      "invalid_request",
      "query " + query,
    );

  // ── Followers and following ────────────────────────────────────────────
  const everyone = await guest(`/users/${owner.id}/followers?limit=50`);
  assert.equal(everyone.status, 200, everyone.text);
  assert.deepEqual(userPageSchema.parse(everyone.body), everyone.body);
  assertClean("followers", everyone.body);
  const followerIds = everyone.body.items.map((u) => u.id);
  assert.equal(followerIds.length, 6, "five fans and the reader");
  assert.ok(
    !followerIds.includes(barred.id),
    "a blocked follower is not listed",
  );
  assert.ok(
    everyone.body.items.every((u) => u.relationship === null),
    "a guest sees no relationships",
  );
  assert.equal(everyone.body.nextCursor, null);
  const mine = await reader.v1(`/users/${owner.id}/followers?limit=50`);
  const me = mine.body.items.find((u) => u.id === reader.id);
  assert.deepEqual(me.relationship, {
    isSelf: true,
    following: false,
    followedBy: false,
    friends: false,
  });
  assert.deepEqual(
    mine.body.items.find((u) => u.id === fans[0].id).relationship,
    { isSelf: false, following: false, followedBy: false, friends: false },
  );
  // Newest first: the reader followed last.
  assert.equal(followerIds[0], reader.id);
  assert.equal(followerIds[followerIds.length - 1], fans[0].id);
  // Walk in pages of two while another person follows: nothing repeats or is lost.
  const walk = async (extraStep) => {
    const seen = [];
    let cursor = null;
    let step = 0;
    do {
      const page = await guest(
        `/users/${owner.id}/followers?limit=2${cursor ? "&cursor=" + cursor : ""}`,
      );
      assert.equal(page.status, 200, page.text);
      seen.push(...page.body.items.map((u) => u.id));
      if (step++ === 0 && extraStep) await extraStep();
      cursor = page.body.nextCursor;
    } while (cursor);
    return seen;
  };
  assert.deepEqual(
    await walk(),
    followerIds,
    "pages of two cover the list in order",
  );
  const latecomer = await member("latecomer");
  const during = await walk(() => follow(latecomer, owner));
  assert.deepEqual(
    during,
    followerIds,
    "a follow added mid-walk shifts nothing",
  );
  assert.equal(
    (await guest(`/users/${owner.id}/followers?limit=1`)).body.items[0].id,
    latecomer.id,
  );
  const following = await guest(`/users/${owner.id}/following`);
  assert.deepEqual(
    following.body.items.map((u) => u.id),
    [fans[0].id, reader.id],
    "who the owner follows, newest first",
  );
  assert.deepEqual(userPageSchema.parse(following.body), following.body);
  assertError(
    await guest(`/users/${owner.id}/followers?cursor=junk`),
    400,
    "invalid_request",
    "bad cursor",
  );
  assertError(
    await guest(`/users/${owner.id}/followers?scope=mine`),
    400,
    "invalid_request",
    "unknown parameter",
  );

  // ── Credentials and methods ───────────────────────────────────────────
  assertError(
    await guest("/users/" + owner.username, {
      headers: { authorization: "Bearer junk" },
    }),
    401,
    "invalid_token",
    "bad Bearer is not a guest",
  );
  assertError(
    await owner.v1("/users/" + owner.username, {
      headers: { authorization: "Bearer junk" },
    }),
    400,
    "ambiguous_authentication",
    "cookie and Bearer",
  );
  const device = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email: reader.email,
      password,
      device: { name: "Phone", platform: "ios" },
    },
  });
  assert.equal(device.status, 201, device.text);
  const viaBearer = await guest("/users/" + owner.username, {
    headers: { authorization: "Bearer " + device.body.accessToken },
  });
  assert.equal(viaBearer.status, 200);
  assert.deepEqual(
    viaBearer.body.relationship,
    asReader.body.relationship,
    "a device session is the same viewer",
  );
  for (const tail of ["", "/bikes", "/followers", "/following"])
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await guest(`/users/${owner.id}${tail}`, {
        method,
        origin: base,
      });
      assertError(r, 405, "method_not_allowed", method + " " + tail);
      assert.match(r.headers.get("allow"), /GET/);
    }

  // ── The legacy API is untouched ────────────────────────────────────────
  const legacy = await http("/api/social/profiles/" + owner.username);
  assert.equal(legacy.status, 200);
  assert.ok(
    legacy.body.profile.counts.friends !== undefined,
    "legacy profile keeps its friends count and shape",
  );
  const legacyFollowers = await http(
    `/api/social/profiles/${owner.username}/followers`,
  );
  assert.ok(
    "total" in legacyFollowers.body &&
      "page" in legacyFollowers.body &&
      "pageSize" in legacyFollowers.body,
    "legacy keeps OFFSET paging with a total",
  );

  // ── The document knows the operations ─────────────────────────────────
  const document = (await guest("/openapi.json")).body;
  for (const path of [
    "/users/{ref}",
    "/users/{ref}/bikes",
    "/users/{ref}/followers",
    "/users/{ref}/following",
  ])
    assert.ok(document.paths[path].get, path);
  console.log(
    "PASS: API v1 people: profiles, bikes, follows, refs, visibility, paging and legacy unchanged.",
  );
} finally {
  await db.end();
}
