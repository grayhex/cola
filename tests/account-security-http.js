// Account security and data (#70) through the real server: devices, password
// and address changes, export, and deletion with its cascade and file queues.
// The harness sets MAIL_CAPTURE_DIR, UPLOAD_DIR and DATABASE_URL.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { gpx, loop } from "./ride-fixtures.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const mailDir = process.env.MAIL_CAPTURE_DIR;
const uploadDir = process.env.UPLOAD_DIR;
assert.ok(mailDir && uploadDir, "the harness sets mail and upload folders");
const evil = "https://evil.test";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client(agent = "ColaBike HTTP test") {
  let cookie = "";
  const call = async (url, method = "GET", data, origin = base) => {
    const bytes = Buffer.isBuffer(data);
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin,
        "user-agent": agent,
        ...(cookie ? { cookie } : {}),
        ...(data
          ? {
              "Content-Type": bytes
                ? url.includes("photos")
                  ? "image/jpeg"
                  : "application/octet-stream"
                : "application/json",
            }
          : {}),
      },
      body: data ? (bytes ? data : JSON.stringify(data)) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: response.status, body, text, headers: response.headers };
  };
  return call;
}
const seen = new Set();
async function nextMail(to, subject) {
  for (let i = 0; i < 60; i++) {
    for (const file of (await readdir(mailDir).catch(() => [])).sort()) {
      if (seen.has(file)) continue;
      const mail = JSON.parse(await readFile(path.join(mailDir, file), "utf8"));
      if (mail.to === to && subject.test(mail.subject)) {
        seen.add(file);
        return mail;
      }
    }
    await sleep(100);
  }
  throw new Error(`No captured mail to ${to} matching ${subject}`);
}
const tokenFrom = (mail, route) => {
  const match = mail.text.match(new RegExp(`${route}#([A-Za-z0-9_-]{43})`));
  assert.ok(match, "mail contains a link to " + route);
  return match[1];
};

const nonce = randomUUID().slice(0, 8);
const bobEmail = `bob-${nonce}@example.test`,
  carolEmail = `carol-${nonce}@example.test`;
const bob = client("Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36"),
  phone = client("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1"),
  carol = client(),
  guest = client();
const register = (c, name, email) =>
  c("auth/register", "POST", {
    ...testConsents,
    name,
    email,
    password: "bob-first-secret-1",
  });
assert.equal((await register(bob, "Bob", bobEmail)).status, 201);
assert.equal((await register(carol, "Carol", carolEmail)).status, 201);
const login = (c, email, password) =>
  c("auth/login", "POST", { email, password });
assert.equal((await login(phone, bobEmail, "bob-first-secret-1")).status, 200);

// ── Devices ─────────────────────────────────────────────────────────────
assert.equal((await guest("account/sessions")).status, 401);
let sessions = (await bob("account/sessions")).body.sessions;
assert.equal(sessions.length, 2);
assert.equal(sessions.filter((s) => s.current).length, 1);
assert.ok(sessions[0].current, "this browser comes first");
assert.match(sessions[0].userAgent, /Macintosh/);
const phoneSession = sessions.find((s) => !s.current);
assert.match(phoneSession.userAgent, /iPhone/);
for (const key of ["token_hash", "tokenHash", "user_id"])
  assert.ok(!(key in phoneSession), "no secrets in the device list");
assert.equal(
  (await bob("account/sessions/" + phoneSession.id, "DELETE", null, evil))
    .status,
  403,
);
assert.equal(
  (await carol("account/sessions/" + phoneSession.id, "DELETE")).status,
  404,
  "another account cannot end the session",
);
assert.equal(
  (await bob("account/sessions/" + phoneSession.id, "DELETE")).status,
  200,
);
assert.equal((await phone("me")).body.user, null, "the phone is signed out");
assert.ok((await bob("me")).body.user, "this browser stays signed in");

// ── Password ────────────────────────────────────────────────────────────
assert.equal((await login(phone, bobEmail, "bob-first-secret-1")).status, 200);
const change = (c, currentPassword, password, origin) =>
  c("account/password", "POST", { currentPassword, password }, origin);
assert.equal(
  (await change(guest, "bob-first-secret-1", "bob-second-secret-2")).status,
  401,
);
assert.equal(
  (await change(bob, "bob-first-secret-1", "bob-second-secret-2", evil)).status,
  403,
);
assert.equal(
  (await change(bob, "wrong-password-0", "bob-second-secret-2")).status,
  403,
);
assert.equal((await change(bob, "bob-first-secret-1", "short")).status, 400);
assert.equal(
  (await change(bob, "bob-first-secret-1", "bob-second-secret-2")).status,
  200,
);
assert.equal((await phone("me")).body.user, null, "other sessions end");
assert.ok(
  (await bob("me")).body.user,
  "the changing browser keeps its session",
);
assert.equal((await login(guest, bobEmail, "bob-first-secret-1")).status, 401);
assert.equal((await login(phone, bobEmail, "bob-second-secret-2")).status, 200);

// ── Address ─────────────────────────────────────────────────────────────
const newEmail = `bob-new-${nonce}@example.test`;
const move = (c, password, email, origin) =>
  c("account/email", "POST", { password, email }, origin);
assert.equal((await move(guest, "bob-second-secret-2", newEmail)).status, 401);
assert.equal(
  (await move(bob, "bob-second-secret-2", newEmail, evil)).status,
  403,
);
assert.equal((await move(bob, "wrong-password-0", newEmail)).status, 403);
assert.equal(
  (await move(bob, "bob-second-secret-2", carolEmail)).status,
  409,
  "an address of another account is refused",
);
assert.equal(
  (await move(bob, "bob-second-secret-2", "not-an-email")).status,
  400,
);
assert.equal((await move(bob, "bob-second-secret-2", newEmail)).status, 200);
const changeMail = await nextMail(newEmail, /новый адрес/);
const token = tokenFrom(changeMail, "/confirm-email");
assert.equal(
  (await bob("me")).body.user.email,
  bobEmail,
  "the address changes only after the link",
);
assert.equal(
  (await guest("account/email/confirm", "POST", { token }, evil)).status,
  403,
);
assert.equal(
  (await guest("account/email/confirm", "POST", { token: "x".repeat(43) })).body
    .code,
  "TOKEN_INVALID",
);
// The link works without a session: it may be opened on another device.
const confirmed = await guest("account/email/confirm", "POST", { token });
assert.equal(confirmed.status, 200);
assert.equal(confirmed.body.email, newEmail);
const me = (await bob("me")).body.user;
assert.equal(me.email, newEmail);
assert.ok(me.email_verified_at, "opening the link verifies the new address");
await nextMail(bobEmail, /изменён/);
assert.equal(
  (await guest("account/email/confirm", "POST", { token })).body.code,
  "TOKEN_INVALID",
  "a link works once",
);
assert.equal((await login(guest, bobEmail, "bob-second-secret-2")).status, 401);
assert.equal((await login(phone, newEmail, "bob-second-secret-2")).status, 200);

// ── Content for export and deletion ─────────────────────────────────────
const bike = {
  name: "Surly Straggler",
  brand: "Surly",
  model: "Straggler",
  year: 2022,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
};
const bikeId = (await bob("bikes", "POST", bike)).body.id;
assert.ok(bikeId);
assert.equal(
  (
    await bob("bikes/" + bikeId + "/components", "POST", {
      section: "build",
      category: "Рама",
      name: "Surly 4130 CroMoly",
      notes: "",
      price: null,
    })
  ).status,
  201,
);
const before = new Set(await readdir(uploadDir).catch(() => []));
const jpeg = await sharp({
  create: { width: 800, height: 600, channels: 3, background: "#6f7768" },
})
  .jpeg()
  .toBuffer();
assert.equal(
  (await bob("bikes/" + bikeId + "/photos", "POST", jpeg)).status,
  201,
);
const photoFiles = (await readdir(uploadDir)).filter((f) => !before.has(f));
assert.equal(photoFiles.length, 1, "the photo is stored on disk");
const preview = await bob("rides/preview", "POST", gpx([loop]));
assert.equal(preview.status, 201, JSON.stringify(preview.body));
const ride = await bob("rides", "POST", {
  previewId: preview.body.previewId,
  bikeId,
  title: "Export ride",
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
});
assert.equal(ride.status, 201, JSON.stringify(ride.body));
const { bike: saved } = (await bob("bikes/" + bikeId)).body;
// Carol follows Bob and comments on his bike; Bob comments on hers.
const { user: bobUser } = (await bob("me")).body;
assert.equal(
  (await carol("social/profiles/" + bobUser.username + "/follow", "PUT"))
    .status,
  200,
);
const carolBikeId = (
  await carol("bikes", "POST", { ...bike, name: "Carol bike" })
).body.id;
assert.equal(
  (
    await bob("community/bikes/" + carolBikeId + "/comments", "POST", {
      body: "Отличная сборка!",
    })
  ).status,
  201,
);
assert.ok(
  (await carol("community/notifications")).body.notifications.some(
    (n) => n.actor.username === bobUser.username,
  ),
);

// ── Export ──────────────────────────────────────────────────────────────
assert.equal((await guest("account/export", "POST")).status, 401);
assert.equal((await bob("account/export", "POST", null, evil)).status, 403);
const exported = await bob("account/export", "POST");
assert.equal(exported.status, 200);
assert.match(
  exported.headers.get("content-disposition"),
  /^attachment; filename="colabike-.+\.json"$/,
);
const data = exported.body;
assert.equal(data.format, "colabike-export");
assert.equal(data.profile.email, newEmail);
assert.ok(!("password_hash" in data.profile));
const exportedBike = data.bikes.find((b) => b.id === bikeId);
assert.equal(exportedBike.components[0].name, "Surly 4130 CroMoly");
assert.equal(exportedBike.photos.length, 1);
assert.match(exportedBike.photos[0], /\/api\/photos\/[0-9a-f-]{36}$/);
assert.ok(!JSON.stringify(data).includes("password_hash"));
const exportedRide = data.rides.find((r) => r.id === ride.body.id);
assert.ok(exportedRide.track, "the ride links its original track");
const track = await fetch(
  exportedRide.track.replace(/^https?:\/\/[^/]+/, base),
  {
    headers: { cookie: "" },
  },
);
assert.equal(track.status, 401, "tracks need the owner's session");
const trackPath = exportedRide.track.replace(/^https?:\/\/[^/]+\/api\//, "");
const own = await bob(trackPath);
assert.equal(own.status, 200);
assert.match(own.text, /<gpx/);
assert.equal((await carol(trackPath)).status, 404, "only the owner reads it");

// ── Deletion ────────────────────────────────────────────────────────────
const erase = (c, password, confirm = "УДАЛИТЬ", origin) =>
  c("account/delete", "POST", { password, confirm }, origin);
assert.equal((await erase(guest, "bob-second-secret-2")).status, 401);
assert.equal(
  (await erase(bob, "bob-second-secret-2", "УДАЛИТЬ", evil)).status,
  403,
);
assert.equal((await erase(bob, "wrong-password-0")).status, 403);
assert.equal((await erase(bob, "bob-second-secret-2", "удалить")).status, 400);
assert.ok((await bob("me")).body.user, "nothing changed yet");
const erased = await erase(bob, "bob-second-secret-2");
assert.equal(erased.status, 200);
assert.equal((await bob("me")).body.user, null, "this browser is signed out");
assert.equal((await phone("me")).body.user, null, "every session ended");
assert.equal((await login(guest, newEmail, "bob-second-secret-2")).status, 401);
// Public pages answer 404.
assert.equal((await guest("social/profiles/" + bobUser.username)).status, 404);
assert.equal((await guest("shared/" + saved.share_id)).status, 404);
// His comments leave the discussion (a thread with live replies would keep
// an «unavailable» placeholder); notifications with him go.
const comments = (await carol("community/bikes/" + carolBikeId + "/comments"))
  .body.comments;
assert.equal(comments.length, 0);
assert.ok(
  !(await carol("community/notifications")).body.notifications.some(
    (n) => n.actor?.username === bobUser.username,
  ),
);
// Files: the photo leaves the disk now, the ride track waits in its queue.
assert.ok(
  !(await readdir(uploadDir)).includes(photoFiles[0]),
  "the bike photo is removed",
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE id=$1", [bobUser.id])).rowCount,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM ride_file_gc WHERE id=$1 AND kind='ride'", [
        ride.body.id,
      ])
    ).rowCount,
    1,
    "the ride file is queued for removal",
  );
} finally {
  await db.end();
}
console.log(
  "Account security HTTP: devices, password and address changes, export with tracks, deletion with cascade and file queues passed.",
);
