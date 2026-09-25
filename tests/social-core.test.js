import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  usernameInput,
  publicProfileInput,
  reservedUsernames,
} from "../lib/social-validation.js";
import { publicAuthor, publicProfile } from "../lib/profile-dto.js";
import { getProfile, updateProfile, accountOverview } from "../lib/profiles.js";
import { setFollow, followPage } from "../lib/follows.js";
import {
  prepareAvatar,
  replaceAvatar,
  avatarFilename,
} from "../lib/avatars.js";
import { checkPhotoQuota, limits } from "../lib/limits.js";
import { showcase } from "../lib/showcase.js";
import { insertBike } from "../lib/repository.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
const migrations = [
  "001_initial",
  "002_admin",
  "003_factory_spec",
  "004_garage_layout",
  "005_bike_wizard",
  "007_showcase",
  "008_beta_limits",
];
const sql = (name) =>
  readFile(new URL("../db/" + name + ".sql", import.meta.url), "utf8");
async function setup(social = true) {
  const db = new PGlite();
  for (const m of migrations) await db.exec(await sql(m));
  if (social) {
    await db.exec(await sql("009_social_core"));
    await db.exec(await sql("010_community"));
    await db.exec(await sql("011_gamification"));
    await db.exec(await sql("012_rides"));
    await db.exec(await sql("014_journal"));
    await db.exec(await sql("015_discovery"));
    await db.exec(await sql("016_product_ui"));
    await db.exec(await sql("017_rides_market"));
    await db.exec(await sql("018_articles_rsvp"));
    await db.exec(await sql("020_bike_classification"));
    await db.exec(await sql("027_game_rules"));
  }
  await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultCatalog),
  ]);
  return db;
}
async function user(db, username) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Имя Юникод','secret',$3)",
    [id, id + "@test.example", username],
  );
  return id;
}
const bike = {
  name: "Test bike",
  brand: "CUBE",
  model: "Travel",
  year: 2020,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: 14,
  is_public: true,
};
test("username migration preserves existing users, resolves UUID prefix collisions and keeps registration compatible", async () => {
  const db = await setup(false);
  try {
    for (const id of [
      "12345678-0000-4000-8000-000000000001",
      "12345678-0000-4000-8000-000000000002",
    ])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Existing','hash')",
        [id, id + "@test.example"],
      );
    await db.exec(await sql("009_social_core"));
    const rows = (
      await db.query(
        "SELECT username,name,password_hash FROM users ORDER BY id",
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.username),
      ["rider-12345678", "rider-12345678-1"],
    );
    assert(
      rows.every((r) => r.name === "Existing" && r.password_hash === "hash"),
    );
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'new@test.example','New','hash')",
      [randomUUID()],
    );
    assert.equal(
      (await db.query("SELECT count(DISTINCT username)::int n FROM users"))
        .rows[0].n,
      3,
    );
    await assert.rejects(
      db.query(
        "UPDATE users SET username='RIDER-12345678' WHERE username='rider-12345678-1'",
      ),
    );
    await assert.rejects(
      db.query(
        "UPDATE users SET username='rider-12345678' WHERE username='rider-12345678-1'",
      ),
      (e) => e.code === "23505",
    );
    for (const name of reservedUsernames)
      await assert.rejects(db.query("UPDATE users SET username=$1", [name]));
  } finally {
    await db.close();
  }
});
test("username normalization, reservations and strict public profile input", () => {
  assert.equal(usernameInput.parse(" Rider.X_Y-Z "), "rider.x_y-z");
  for (const s of [
    "a",
    "a".repeat(31),
    "a/b",
    "a b",
    "велосипед",
    "..",
    ...reservedUsernames,
    ...[...reservedUsernames].map((s) => s.toUpperCase()),
  ])
    assert(!usernameInput.safeParse(s).success, s);
  const profile = {
    username: "Rider",
    name: "Сергей 🚲",
    bio: "Люблю велосипеды",
    location: "Москва",
  };
  assert(publicProfileInput.safeParse(profile).success);
  for (const key of [
    "email",
    "role",
    "blocked",
    "preferences",
    "avatar",
    "avatar_id",
    "password_hash",
    "id",
  ])
    assert(
      !publicProfileInput.safeParse({ ...profile, [key]: "secret" }).success,
    );
});
test("public author/profile allowlists never spread operational columns", () => {
  const row = {
    id: "id",
    username: "rider",
    name: "Name",
    bio: "Bio",
    location: "City",
    created_at: "date",
    avatar_id: "uuid",
    email: "SECRET",
    role: "SECRET",
    blocked: "SECRET",
    preferences: { theme: "SECRET" },
    password_hash: "SECRET",
    session: "SECRET",
    future: "SECRET",
    is_following: true,
    followed_by: true,
  };
  assert.deepEqual(Object.keys(publicAuthor(row)).sort(), [
    "avatar",
    "id",
    "name",
    "username",
  ]);
  const profile = publicProfile(row, {
    bikes: "2",
    followers: "3",
    following: "1",
    friends: "1",
  });
  assert(!JSON.stringify(profile).includes("SECRET"));
  assert.equal(profile.relationship.friends, true);
  assert.deepEqual(profile.badges, []);
});
test("profiles, following, friendship, counters, pagination, blocking, private bikes and cascade", async () => {
  const db = await setup();
  try {
    const a = await user(db, "alice"),
      b = await user(db, "bobby"),
      c = await user(db, "carol");
    await insertBike(db, a, bike);
    await insertBike(db, a, { ...bike, is_public: false, name: "PRIVATE" });
    await insertBike(db, b, bike);
    assert.equal((await showcase(db, null, { ownerId: a })).total, 1);
    const follow = (id, name, on = true) =>
      db.transaction((q) => setFollow(q, id, name, on));
    assert.equal((await follow(a, "alice")).status, 400);
    assert.equal((await follow(a, "missing")).status, 404);
    assert.equal((await follow(a, "bobby")).relationship.following, true);
    assert.equal((await follow(a, "bobby")).relationship.following, true);
    assert.equal((await follow(b, "alice")).relationship.friends, true);
    await follow(c, "alice");
    let p = await getProfile(db, "ALICE", b);
    assert.equal(p.relationship.friends, true);
    assert.deepEqual(p.counts, {
      bikes: 1,
      followers: 2,
      following: 1,
      friends: 1,
    });
    let list = await followPage(db, "alice", b, "followers");
    assert.equal(list.total, 2);
    assert.equal(list.users.length, 2);
    assert(list.users.every((u) => !("email" in u) && !("preferences" in u)));
    assert.equal((await followPage(db, "alice", b, "friends")).total, 1);
    assert.equal(
      (await follow(a, "bobby", false)).relationship.following,
      false,
    );
    assert.equal(
      (await follow(a, "bobby", false)).relationship.following,
      false,
    );
    assert.equal((await getProfile(db, "alice", b)).counts.friends, 0);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [c]);
    assert.equal(await getProfile(db, "carol", a), null);
    assert.equal(await followPage(db, "carol", a, "following"), null);
    assert.equal((await getProfile(db, "alice", null)).counts.followers, 1);
    assert.equal((await followPage(db, "alice", a, "followers")).total, 1);
    assert.equal((await follow(a, "carol")).status, 404);
    assert.equal((await follow(c, "alice")).status, 404);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [a]);
    assert.equal((await showcase(db, null, { ownerId: a })).total, 0);
    assert.equal((await getProfile(db, "bobby", null)).counts.following, 0);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [a]);
    for (let i = 0; i < 21; i++) {
      const id = await user(db, "extra-" + i);
      await follow(id, "alice");
    }
    list = await followPage(db, "alice", null, "followers");
    assert.equal(list.total, 22);
    assert.equal(list.users.length, 20);
    const next = await followPage(db, "alice", null, "followers", 2);
    assert.equal(next.users.length, 2);
    assert.equal(
      new Set([...list.users, ...next.users].map((u) => u.id)).size,
      22,
    );
    await updateProfile(db, a, {
      username: "alice-new",
      name: "Алиса",
      bio: "Bio",
      location: "",
    });
    assert.equal(await getProfile(db, "alice"), null);
    assert.equal((await getProfile(db, "alice-new")).name, "Алиса");
    const overview = await accountOverview(db, {
      id: a,
      username: "alice-new",
      email: "private",
      preferences: { theme: "dark" },
    });
    assert.equal(overview.stats.private, 1);
    assert.equal(overview.stats.public, 1);
    assert.equal(overview.email, "private");
    await db.query("DELETE FROM users WHERE id=$1", [a]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM user_follows WHERE follower_id=$1 OR following_id=$1",
          [a],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("avatars decode to square metadata-free WebP, replace/delete atomically and share photo storage quota", async () => {
  const db = await setup(),
    dir = await mkdtemp(path.join(tmpdir(), "cola-avatar-"));
  try {
    const a = await user(db, "avatar-owner"),
      b = await user(db, "other-owner"),
      id = await insertBike(db, a, bike);
    const raw = await sharp({
        create: { width: 800, height: 600, channels: 3, background: "red" },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
      bytes = await prepareAvatar(raw),
      meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
    await assert.rejects(prepareAvatar(Buffer.from("<svg/>")));
    const tx = (fn) => db.transaction(fn),
      first = await replaceAvatar(tx, a, bytes, dir);
    assert(first.avatar.startsWith("/api/avatars/"));
    const old = (await readdir(dir))[0];
    const second = await replaceAvatar(tx, a, bytes, dir);
    assert.notEqual(first.avatar, second.avatar);
    assert(!(await readdir(dir)).includes(old));
    assert.equal((await readdir(dir)).length, 1);
    const row = (
      await db.query(
        "SELECT avatar_id,avatar_size_bytes FROM users WHERE id=$1",
        [a],
      )
    ).rows[0];
    assert.equal(Number(row.avatar_size_bytes), bytes.length);
    assert.equal((await readdir(dir))[0], avatarFilename(row.avatar_id));
    assert.equal(
      (await db.query("SELECT avatar_id FROM users WHERE id=$1", [b])).rows[0]
        .avatar_id,
      null,
    );
    await assert.rejects(
      checkPhotoQuota(db, a, id, [1], {
        ...limits,
        storageBytes: bytes.length,
      }),
      /места/,
    );
    await assert.rejects(
      replaceAvatar(
        (fn) =>
          db.transaction(async (q) => {
            await fn(q);
            throw new Error("rollback");
          }),
        a,
        bytes,
        dir,
      ),
      /rollback/,
    );
    assert.deepEqual(await readdir(dir), [avatarFilename(row.avatar_id)]);
    await db.query(
      "INSERT INTO photos(id,bike_id,filename,size_bytes) VALUES($1,$2,$3,$4)",
      [randomUUID(), id, "large.webp", limits.storageBytes],
    );
    await assert.rejects(replaceAvatar(tx, a, bytes, dir), /места/);
    assert.equal((await readdir(dir)).length, 1);
    await replaceAvatar(tx, a, null, dir);
    assert.deepEqual(await readdir(dir), []);
    await replaceAvatar(tx, a, null, dir);
    assert.equal(
      (await db.query("SELECT avatar_size_bytes FROM users WHERE id=$1", [a]))
        .rows[0].avatar_size_bytes,
      0,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
