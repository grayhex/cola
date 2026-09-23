import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
function client() {
  let cookie = "";
  return async (url, method = "GET", data, origin = base, type) => {
    const r = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": type || "application/json" } : {}),
      },
      body: data ? (type ? data : JSON.stringify(data)) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      headers: r.headers,
      body: r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  };
}
const a = client(),
  b = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8),
  alice = "alice-" + nonce,
  bobby = "bobby-" + nonce,
  ids = [];
const form = (username) => ({
  username,
  name: "Rider " + username,
  bio: "Люблю велосипеды",
  location: "Москва",
});
function privateFree(value) {
  const forbidden = [
    "email",
    "role",
    "blocked",
    "preferences",
    "password_hash",
    "session",
    "avatar_id",
    "avatar_size_bytes",
  ];
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      assert(!forbidden.includes(key), "Leaked " + key);
      privateFree(v);
    }
}
try {
  for (const [who, name] of [
    [a, alice],
    [b, bobby],
  ]) {
    const r = await who("auth/register", "POST", {
      ...testConsents,
      name,
      email: name + "@example.test",
      password: "colabike-social-test-123",
    });
    assert.equal(r.status, 201);
    const me = (await who("me")).body.user;
    ids.push(me.id);
    // Without a chosen username the server derives one from the name (#71).
    assert.equal(me.username, name);
    assert.equal((await who("social/me", "PATCH", form(name))).status, 200);
  }
  const check = async (candidate) =>
    (await guest("social/usernames/" + encodeURIComponent(candidate))).body;
  assert.deepEqual(await check(alice.toUpperCase()), {
    username: alice,
    available: false,
    suggestion: alice + "-2",
  });
  assert.equal((await check("free-" + nonce)).available, true);
  assert.deepEqual(await check("admin"), {
    available: false,
    reason: "reserved",
  });
  assert.deepEqual(await check("имя"), { available: false, reason: "format" });
  const chosen = "Carol." + nonce;
  for (const [who, username, status] of [
    [client(), chosen, 201],
    [client(), chosen.toLowerCase(), 409],
    [client(), "", 201],
  ]) {
    const r = await who("auth/register", "POST", {
      ...testConsents,
      name: "Кэрол",
      email: randomUUID() + "@example.test",
      password: "colabike-social-test-123",
      username,
    });
    assert.equal(r.status, status);
    if (status === 409) {
      assert.equal(r.body.code, "username_taken");
      continue;
    }
    ids.push(r.body.user.id);
    if (username) assert.equal(r.body.user.username, chosen.toLowerCase());
    else assert.match(r.body.user.username, /^kerol(-\d+)?$/);
  }
  assert.equal((await guest("social/account")).status, 401);
  assert.equal(
    (await guest("social/me", "PATCH", form("visitor"))).status,
    401,
  );
  assert.equal(
    (await a("social/me", "PATCH", form(alice), "https://evil.example")).status,
    403,
  );
  assert.equal((await a("social/me", "PATCH", form("admin"))).status, 400);
  assert.equal(
    (await b("social/me", "PATCH", form(alice.toUpperCase()))).status,
    409,
  );
  for (const extra of [
    { email: "hacker@example.test" },
    { role: "admin" },
    { avatar: "https://example.test/a.png" },
    { id: ids[1] },
  ])
    assert.equal(
      (await a("social/me", "PATCH", { ...form(alice), ...extra })).status,
      400,
    );
  const bike = {
    name: "Public " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "red",
    size: "M",
    weight: 14,
    is_public: true,
  };
  const publicId = (await a("bikes", "POST", bike)).body.id;
  assert(publicId);
  await a("bikes", "POST", {
    ...bike,
    name: "SECRET " + nonce,
    is_public: false,
  });
  let p = (await guest("social/profiles/" + alice)).body.profile;
  privateFree(p);
  assert.equal(p.counts.bikes, 1);
  assert.deepEqual(p.badges, []);
  assert(!p.relationship.isSelf);
  const feed = (await guest("social/profiles/" + alice + "/bikes")).body;
  assert.equal(feed.total, 1);
  assert.equal(feed.bikes[0].id, publicId);
  privateFree(feed);
  assert.deepEqual(Object.keys(feed.bikes[0].author).sort(), [
    "avatar",
    "id",
    "name",
    "username",
  ]);
  assert.equal(feed.bikes[0].author.username, alice);
  assert.equal(
    (await guest("social/profiles/" + alice + "/followers?page=-1")).status,
    400,
  );
  assert.equal(
    (await guest("social/profiles/" + alice + "/follow", "PUT")).status,
    401,
  );
  assert.equal(
    (await a("social/profiles/" + alice + "/follow", "PUT")).status,
    400,
  );
  assert.equal(
    (
      await b(
        "social/profiles/" + alice + "/follow",
        "PUT",
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await b("social/profiles/" + alice + "/follow", "PUT")).body.relationship
      .following,
    true,
  );
  assert.equal(
    (await b("social/profiles/" + alice + "/follow", "PUT")).body.relationship
      .following,
    true,
  );
  p = (await b("social/profiles/" + alice)).body.profile;
  assert.equal(p.counts.followers, 1);
  assert(!p.relationship.friends);
  assert.equal(
    (await a("social/profiles/" + bobby + "/follow", "PUT")).body.relationship
      .friends,
    true,
  );
  p = (await b("social/profiles/" + alice)).body.profile;
  assert.equal(p.relationship.friends, true);
  assert.equal(p.counts.friends, 1);
  const followers = (await guest("social/profiles/" + alice + "/followers"))
    .body;
  privateFree(followers);
  assert.equal(followers.total, 1);
  assert.equal(followers.users[0].username, bobby);
  await b("bikes/" + publicId + "/like", "PUT");
  const overview = (await a("social/account")).body;
  assert.equal(overview.stats.bikes, 2);
  assert.equal(overview.stats.private, 1);
  assert.equal(overview.stats.likes, 1);
  assert.equal(overview.email, alice + "@example.test");
  const image = await sharp({
    create: { width: 90, height: 60, channels: 3, background: "red" },
  })
    .withMetadata()
    .png()
    .toBuffer();
  assert.equal(
    (await guest("social/me/avatar", "PUT", image, base, "image/png")).status,
    401,
  );
  assert.equal(
    (
      await a(
        "social/me/avatar",
        "PUT",
        image,
        "https://evil.example",
        "image/png",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await a(
        "social/me/avatar",
        "PUT",
        Buffer.from("<svg/>"),
        base,
        "image/png",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await a(
        "social/me/avatar",
        "PUT",
        Buffer.alloc(2 * 1024 * 1024 + 1),
        base,
        "image/png",
      )
    ).status,
    413,
  );
  const first = await a("social/me/avatar", "PUT", image, base, "image/png");
  assert.equal(first.status, 200);
  const old = first.body.avatar;
  assert(old);
  let photo = await guest(old.slice(5));
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/webp");
  assert.equal((await sharp(photo.body).metadata()).width, 512);
  assert.equal(
    (await b("social/profiles/" + alice + "/avatar", "DELETE")).status,
    404,
  );
  assert.equal(
    (await b("social/me/avatar", "PUT", { avatar: old })).status,
    400,
  );
  assert.equal((await guest(old.slice(5))).status, 200);
  const current = (await a("social/me/avatar", "PUT", image, base, "image/png"))
    .body.avatar;
  assert.notEqual(current, old);
  assert.equal((await guest(old.slice(5))).status, 404);
  const profileAvatar = (await guest("social/profiles/" + alice)).body.profile
    .avatar;
  assert.equal(profileAvatar, current);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ids[0]]);
  assert.equal((await guest("social/profiles/" + alice)).status, 404);
  assert.equal(
    (await guest("social/profiles/" + alice + "/bikes")).status,
    404,
  );
  assert.equal(
    (await guest("social/profiles/" + alice + "/followers")).status,
    404,
  );
  assert.equal((await guest(current.slice(5))).status, 404);
  assert.equal(
    (await b("social/profiles/" + alice + "/follow", "PUT")).status,
    404,
  );
  const blockedCounts = (await guest("social/profiles/" + bobby)).body.profile
    .counts;
  assert.equal(blockedCounts.following, 0);
  assert.equal(blockedCounts.followers, 0);
  assert.equal(
    (await guest("social/profiles/" + bobby + "/following")).body.total,
    0,
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [ids[0]]);
  assert.equal((await guest(current.slice(5))).status, 200);
  assert.equal((await a("social/me/avatar", "DELETE")).status, 200);
  assert.equal((await guest(current.slice(5))).status, 404);
  assert.equal((await a("social/me/avatar", "DELETE")).status, 200);
  assert.equal(
    (await b("social/profiles/" + alice + "/follow", "DELETE")).body
      .relationship.following,
    false,
  );
  assert.equal(
    (await b("social/profiles/" + alice + "/follow", "DELETE")).body
      .relationship.following,
    false,
  );
  p = (await guest("social/profiles/" + alice)).body.profile;
  assert.equal(p.counts.followers, 0);
  assert.equal(p.counts.friends, 0);
  const newName = alice + "-new";
  assert.equal(
    (await a("social/me", "PATCH", form(newName.toUpperCase()))).status,
    200,
  );
  assert.equal((await guest("social/profiles/" + alice)).status, 404);
  assert.equal(
    (await guest("social/profiles/" + newName)).body.profile.username,
    newName,
  );
  let limited = false;
  for (let i = 0; i < 61; i++) {
    const r = await b("social/profiles/" + newName + "/follow", "PUT");
    if (r.status === 429) {
      limited = true;
      break;
    }
    assert.equal(r.status, 200);
  }
  assert(limited, "follow rate limit must apply");
  console.log(
    "Social HTTP: profiles, DTO privacy, usernames, origin/auth, private bikes, avatars, blocking, follows, friends, counters and rate limit passed.",
  );
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await db.end();
}
