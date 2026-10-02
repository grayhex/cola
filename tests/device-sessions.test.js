import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFRESH_GRACE_SECONDS,
  accessHash,
  accessTokenPattern,
  bearerFailure,
  createDeviceSession,
  deviceSessionConfig,
  endDeviceSession,
  refreshDeviceSession,
  refreshTokenPattern,
  sessionOfRefreshToken,
} from "../lib/device-sessions.ts";
import { notificationPage, unreadCount } from "../lib/notifications.ts";
import { sessionHashOf, viewerFromCredential } from "../lib/viewer-session.ts";
import { scrub } from "../lib/observability.ts";
import { digest } from "../lib/password.ts";

// Device sessions (#303, ADR in #156): token shape, the scheme in the lookup,
// expiry, rotation, the lost-response grace period and replay detection.
// The same rules end to end, with real HTTP, are tests/device-sessions-http.js;
// true parallelism on PostgreSQL is tests/device-sessions-concurrency.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

// PGlite reports affected rows under another name than pg does.
const adapt = (d) => ({
  async query(text, values) {
    const result = await d.query(text, values);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  },
});
const q = adapt(db);
const transaction = (fn) => db.transaction((tx) => fn(adapt(tx)));

async function addUser({ blocked = false } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,'Rider','hash',$3,$4)",
    [id, id + "@test.invalid", "u" + id.slice(0, 12), blocked],
  );
  return id;
}
const device = { name: "iPhone Ивана", platform: "ios", appVersion: "1.4.0" };
const create = (userId, info = device) =>
  transaction((t) => createDeviceSession(t, userId, info, "ColaBike/1.4 iOS"));
const asBearer = (grant) => ({ scheme: "bearer", token: grant.accessToken });
const row = async (grant) =>
  (await db.query("SELECT * FROM sessions WHERE id=$1", [grant.sessionId]))
    .rows[0];
const refresh = (token) => refreshDeviceSession(transaction, token);

test("configuration: the owner's defaults, env overrides, bad values fall back", () => {
  assert.deepEqual(deviceSessionConfig({}), {
    accessMinutes: 15,
    idleDays: 60,
    absoluteDays: 180,
    limit: 20,
  });
  assert.deepEqual(
    deviceSessionConfig({
      DEVICE_ACCESS_TOKEN_MINUTES: "5",
      DEVICE_REFRESH_IDLE_DAYS: "30",
      DEVICE_REFRESH_ABSOLUTE_DAYS: "90",
    }),
    { accessMinutes: 5, idleDays: 30, absoluteDays: 90, limit: 20 },
  );
  const bad = deviceSessionConfig({
    DEVICE_ACCESS_TOKEN_MINUTES: "0",
    DEVICE_REFRESH_IDLE_DAYS: "-1",
    DEVICE_REFRESH_ABSOLUTE_DAYS: "forever",
  });
  assert.equal(bad.accessMinutes, 15);
  assert.equal(bad.idleDays, 60);
  assert.equal(bad.absoluteDays, 180);
  assert.equal(
    deviceSessionConfig({
      DEVICE_REFRESH_IDLE_DAYS: "300",
      DEVICE_REFRESH_ABSOLUTE_DAYS: "100",
    }).idleDays,
    100,
    "the idle limit never exceeds the absolute one",
  );
});

test("a new session: prefixed tokens, only digests stored, owner's lifetimes", async () => {
  const user = await addUser();
  const grant = await create(user);
  assert.match(grant.accessToken, accessTokenPattern);
  assert.match(grant.refreshToken, refreshTokenPattern);
  const stored = await row(grant);
  assert.equal(stored.kind, "device");
  assert.equal(stored.token_hash, accessHash(grant.accessToken));
  assert.notEqual(stored.refresh_hash, grant.refreshToken);
  assert.equal(stored.device_name, device.name);
  assert.equal(stored.platform, "ios");
  assert.equal(stored.app_version, "1.4.0");
  // No raw token anywhere in the row.
  const text = JSON.stringify(stored);
  assert.ok(
    !text.includes(grant.accessToken) && !text.includes(grant.refreshToken),
  );
  const minutes = (a, b) => Math.round((a - b) / 60000);
  assert.equal(minutes(stored.access_expires_at, stored.created_at), 15);
  const days = (a, b) => Math.round((a - b) / 86400000);
  assert.equal(days(stored.expires_at, stored.created_at), 60);
  assert.equal(days(stored.absolute_expires_at, stored.created_at), 180);
  assert.equal(
    grant.accessTokenExpiresAt.getTime(),
    stored.access_expires_at.getTime(),
  );
  assert.equal(
    grant.refreshTokenExpiresAt.getTime(),
    stored.expires_at.getTime(),
  );
});

test("the scheme is part of the lookup: access as cookie and cookie as Bearer open nothing", async () => {
  const user = await addUser();
  const grant = await create(user);
  assert.equal((await viewerFromCredential(q, asBearer(grant)))?.id, user);
  // The access token, however it arrives, never opens a browser session.
  assert.equal(
    await viewerFromCredential(q, {
      scheme: "cookie",
      token: grant.accessToken,
    }),
    null,
  );
  // A browser session token never opens a device session.
  const browser = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [sessionHashOf({ scheme: "cookie", token: browser }), user],
  );
  assert.equal(
    await viewerFromCredential(q, { scheme: "cookie", token: browser }).then(
      (v) => v?.id,
    ),
    user,
  );
  assert.equal(
    await viewerFromCredential(q, { scheme: "bearer", token: browser }),
    null,
  );
  // A refresh token is not an access token.
  assert.equal(
    await viewerFromCredential(q, {
      scheme: "bearer",
      token: grant.refreshToken,
    }),
    null,
  );
});

test("expiry: access, idle and absolute limits, and a blocked account", async () => {
  const user = await addUser();
  const grant = await create(user);
  const hash = accessHash(grant.accessToken);
  assert.ok((await viewerFromCredential(q, asBearer(grant)))?.id);
  // The access token ran out: the client is told to refresh.
  await db.query(
    "UPDATE sessions SET access_expires_at=now()-interval '1 second' WHERE id=$1",
    [grant.sessionId],
  );
  assert.equal(await viewerFromCredential(q, asBearer(grant)), null);
  assert.equal(await bearerFailure(q, hash), "token_expired");
  assert.equal(
    (await refresh(grant.refreshToken)).ok,
    true,
    "and refreshing works",
  );
  // Idle limit passed: sign in again.
  const idle = await create(user);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [idle.sessionId],
  );
  assert.equal(await viewerFromCredential(q, asBearer(idle)), null);
  assert.equal(
    await bearerFailure(q, accessHash(idle.accessToken)),
    "invalid_token",
  );
  assert.deepEqual(await refresh(idle.refreshToken), {
    ok: false,
    reason: "invalid",
  });
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE id=$1", [idle.sessionId]))
      .rows.length,
    0,
  );
  // Absolute limit passed, although the idle one has not.
  const old = await create(user);
  await db.query(
    "UPDATE sessions SET absolute_expires_at=now()-interval '1 second' WHERE id=$1",
    [old.sessionId],
  );
  assert.equal(await viewerFromCredential(q, asBearer(old)), null);
  assert.deepEqual(await refresh(old.refreshToken), {
    ok: false,
    reason: "invalid",
  });
  // A blocked account: neither the access token nor the refresh token works.
  const blocked = await addUser();
  const mine = await create(blocked);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
  assert.equal(await viewerFromCredential(q, asBearer(mine)), null);
  assert.equal(
    await bearerFailure(q, accessHash(mine.accessToken)),
    "invalid_token",
  );
  assert.deepEqual(await refresh(mine.refreshToken), {
    ok: false,
    reason: "invalid",
  });
  // Unknown tokens.
  assert.equal(
    await bearerFailure(q, accessHash("cola_at_" + "x".repeat(43))),
    "invalid_token",
  );
});

test("rotation: a new pair, the old one is dead, the row is updated, not replaced", async () => {
  const user = await addUser();
  // A chat identity exists, so deleting a session would queue a token revocation.
  await db.query("INSERT INTO chat_identities(user_id) VALUES($1)", [user]);
  const first = await create(user);
  const result = await refresh(first.refreshToken);
  assert.equal(result.ok, true);
  assert.equal(result.userId, user);
  const next = result.grant;
  assert.equal(next.sessionId, first.sessionId, "the same session, rotated");
  assert.notEqual(next.accessToken, first.accessToken);
  assert.notEqual(next.refreshToken, first.refreshToken);
  assert.equal(
    await viewerFromCredential(q, asBearer(first)),
    null,
    "the old access token is dead",
  );
  assert.equal((await viewerFromCredential(q, asBearer(next)))?.id, user);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM chat_jobs WHERE user_id=$1", [
        user,
      ])
    ).rows[0].n,
    0,
    "a refresh must not revoke the chat tokens (UPDATE, not DELETE + INSERT)",
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM sessions WHERE user_id=$1", [
        user,
      ])
    ).rows[0].n,
    1,
  );
  // A refresh pushes the idle limit forward and never past the absolute one.
  const stored = await row(next);
  assert.ok(stored.expires_at <= stored.absolute_expires_at);
  // Tokens of the wrong shape and unknown tokens find nothing.
  assert.deepEqual(await refresh("cola_rt_" + "y".repeat(43)), {
    ok: false,
    reason: "invalid",
  });
  assert.deepEqual(
    await refresh(next.accessToken),
    { ok: false, reason: "invalid" },
    "access as refresh",
  );
  assert.deepEqual(await refresh("garbage"), { ok: false, reason: "invalid" });
  assert.equal(
    await sessionOfRefreshToken(q, next.refreshToken),
    next.sessionId,
  );
  assert.equal(
    await sessionOfRefreshToken(q, first.refreshToken),
    next.sessionId,
    "the previous token still names its session",
  );
  assert.equal(await sessionOfRefreshToken(q, "nope"), null);
});

test("a lost response: the previous token within the grace period replaces the unclaimed pair", async () => {
  const user = await addUser();
  const first = await create(user);
  const lost = (await refresh(first.refreshToken)).grant; // the client never saw this
  const rotatedAt = (await row(first)).rotated_at;
  // The client retries with the token it still holds.
  const retry = await refresh(first.refreshToken);
  assert.equal(retry.ok, true, "not a theft");
  assert.equal(retry.grant.sessionId, first.sessionId);
  assert.equal(
    await viewerFromCredential(q, asBearer(lost)),
    null,
    "the unclaimed access token is revoked",
  );
  assert.deepEqual(
    await refresh(lost.refreshToken),
    { ok: false, reason: "invalid" },
    "and so is its refresh token",
  );
  assert.equal(
    (await viewerFromCredential(q, asBearer(retry.grant)))?.id,
    user,
  );
  // The grace period is measured from the original rotation: it is not extended,
  // and the replayed token stays the previous one.
  const stored = await row(retry.grant);
  assert.equal(stored.previous_refresh_hash, digest(first.refreshToken));
  assert.equal(stored.rotated_at.getTime(), rotatedAt.getTime());
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM notifications WHERE type='session_reuse' AND recipient_id=$1",
        [user],
      )
    ).rows[0].n,
    0,
    "a lost response is not a theft alarm",
  );
});

test("a replay of the previous token after the grace period ends the session and tells the owner", async () => {
  const user = await addUser();
  await db.query("INSERT INTO chat_identities(user_id) VALUES($1)", [user]);
  const first = await create(user);
  const second = (await refresh(first.refreshToken)).grant;
  await db.query(
    "UPDATE sessions SET rotated_at=now()-make_interval(secs=>$2) WHERE id=$1",
    [first.sessionId, REFRESH_GRACE_SECONDS + 1],
  );
  const replay = await refresh(first.refreshToken);
  assert.deepEqual(replay, {
    ok: false,
    reason: "reuse",
    userId: user,
    sessionId: first.sessionId,
  });
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE id=$1", [first.sessionId]))
      .rows.length,
    0,
    "the whole session is gone",
  );
  assert.equal(await viewerFromCredential(q, asBearer(second)), null);
  assert.deepEqual(await refresh(second.refreshToken), {
    ok: false,
    reason: "invalid",
  });
  // The owner finds a notice, with no actor and no token in it.
  const notices = await notificationPage(q, user);
  assert.equal(notices.notifications.length, 1);
  assert.equal(notices.notifications[0].type, "session_reuse");
  assert.equal(notices.notifications[0].actor, null);
  assert.ok(!JSON.stringify(notices).includes("cola_"));
  assert.equal((await unreadCount(q, user)).unread, 1);
  // Another person sees nothing of it.
  const other = await addUser();
  assert.equal((await notificationPage(q, other)).notifications.length, 0);
  // Ending a session by theft does revoke the chat tokens, as any removal does.
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM chat_jobs WHERE user_id=$1", [
        user,
      ])
    ).rows[0].n,
    1,
  );
});

test("a replay once the new access token has been used is theft, even within the grace period", async () => {
  const user = await addUser();
  const first = await create(user);
  const second = (await refresh(first.refreshToken)).grant;
  assert.equal(
    (await viewerFromCredential(q, asBearer(second)))?.id,
    user,
    "the client received it and used it",
  );
  assert.notEqual((await row(second)).access_used_at, null);
  const replay = await refresh(first.refreshToken);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "reuse");
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE id=$1", [first.sessionId]))
      .rows.length,
    0,
  );
});

test("the first use of an access token is recorded for a device only", async () => {
  const user = await addUser();
  const grant = await create(user);
  assert.equal((await row(grant)).access_used_at, null);
  await viewerFromCredential(q, asBearer(grant));
  const used = (await row(grant)).access_used_at;
  assert.notEqual(used, null);
  await viewerFromCredential(q, asBearer(grant));
  assert.equal(
    (await row(grant)).access_used_at.getTime(),
    used.getTime(),
    "recorded once",
  );
  // A refresh makes the next access token unused again.
  const next = (await refresh(grant.refreshToken)).grant;
  assert.equal((await row(next)).access_used_at, null);
  // A browser row keeps its columns untouched.
  const browser = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [sessionHashOf({ scheme: "cookie", token: browser }), user],
  );
  await viewerFromCredential(q, { scheme: "cookie", token: browser });
  const stored = (
    await db.query(
      "SELECT kind,access_used_at FROM sessions WHERE token_hash=$1",
      [sessionHashOf({ scheme: "cookie", token: browser })],
    )
  ).rows[0];
  assert.deepEqual({ ...stored }, { kind: "browser", access_used_at: null });
});

test("parallel refreshes with one token end in a single live chain", async () => {
  const user = await addUser();
  const first = await create(user);
  const results = await Promise.all([
    refresh(first.refreshToken),
    refresh(first.refreshToken),
  ]);
  // Neither is a false theft alarm: one rotates, the other is a lost-response retry.
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true],
  );
  assert.equal(
    (await db.query("SELECT 1 FROM sessions WHERE id=$1", [first.sessionId]))
      .rows.length,
    1,
  );
  const live = [];
  for (const { grant } of results)
    if (await viewerFromCredential(q, asBearer(grant))) live.push(grant);
  assert.equal(live.length, 1, "exactly one chain stays valid");
  assert.equal((await refresh(live[0].refreshToken)).ok, true);
});

test("at most 20 devices per person: the least recently used is signed out", async () => {
  const user = await addUser();
  const other = await addUser();
  const keep = await create(other);
  const grants = [];
  for (let i = 0; i < 20; i++)
    grants.push(await create(user, { ...device, name: "Phone " + i }));
  // Phone 0 was used most recently, so it must survive; phone 1 is the idlest.
  await db.query(
    "UPDATE sessions SET last_seen_at=now()-interval '3 days' WHERE id=$1",
    [grants[1].sessionId],
  );
  await db.query(
    "UPDATE sessions SET last_seen_at=now()-interval '1 day' WHERE id=$1",
    [grants[2].sessionId],
  );
  const extra = await create(user, { ...device, name: "Phone 20" });
  const names = (
    await db.query(
      "SELECT device_name FROM sessions WHERE user_id=$1 AND kind='device'",
      [user],
    )
  ).rows.map((r) => r.device_name);
  assert.equal(names.length, 20);
  assert.ok(!names.includes("Phone 1"), "the least recently used is gone");
  assert.ok(names.includes("Phone 0") && names.includes("Phone 20"));
  assert.equal(await viewerFromCredential(q, asBearer(grants[1])), null);
  assert.ok(await viewerFromCredential(q, asBearer(extra)));
  assert.ok(
    await viewerFromCredential(q, asBearer(keep)),
    "another person's devices are not touched",
  );
  // Browser sessions do not count against the limit.
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [randomBytes(32).toString("hex"), user],
  );
  await create(user, { ...device, name: "Phone 21" });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND kind='device'",
        [user],
      )
    ).rows[0].n,
    20,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND kind='browser'",
        [user],
      )
    ).rows[0].n,
    1,
  );
});

test("ending a session by its access token removes only that session", async () => {
  const user = await addUser();
  const a = await create(user);
  const b = await create(user);
  assert.equal(await endDeviceSession(q, accessHash(a.accessToken)), true);
  assert.equal(await endDeviceSession(q, accessHash(a.accessToken)), false);
  assert.equal(await viewerFromCredential(q, asBearer(a)), null);
  assert.ok(await viewerFromCredential(q, asBearer(b)));
  assert.deepEqual(await refresh(a.refreshToken), {
    ok: false,
    reason: "invalid",
  });
});

test("rows keep the browser/device invariant and logs never show tokens", async () => {
  const user = await addUser();
  await assert.rejects(
    db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at,kind) VALUES($1,$2,now(),'device')",
      [randomBytes(32).toString("hex"), user],
    ),
    /sessions_device_columns|violates check/,
    "a device row needs its device columns",
  );
  await assert.rejects(
    db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at,device_name) VALUES($1,$2,now(),'x')",
      [randomBytes(32).toString("hex"), user],
    ),
    /sessions_device_columns|violates check/,
    "a browser row has none",
  );
  const grant = await create(user);
  for (const secret of [grant.accessToken, grant.refreshToken])
    for (const text of [
      secret,
      `Bearer ${secret}`,
      `Authorization: Bearer ${secret}`,
      `failed for ${secret}.`,
    ])
      assert.ok(
        !scrub(text).includes(secret.slice(8)),
        "scrubbed: " + text.slice(0, 20),
      );
});
