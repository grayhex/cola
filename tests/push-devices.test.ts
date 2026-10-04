import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDeviceSession } from "../lib/device-sessions.ts";
import {
  openPushToken,
  pushDeviceOf,
  pushDevicesPerUser,
  PushRegistryError,
  registerPushDevice,
  revokePushDevice,
  sealPushToken,
  type PushRegistration,
} from "../lib/push-devices.ts";
import { pushAvailable, pushConfig } from "../lib/push-config.ts";
import { validateRuntime } from "../lib/runtime-config.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { noticeRow } from "./support/notifications.ts";
import { userRow } from "./support/people.ts";

// The registry of the phones a person may be pushed to (#342): one live
// registration for each device session, a secret address that is never stored
// in the clear, a generation that only grows, and an end with the session.

const key = randomBytes(32).toString("base64");
const env = processEnv({
  PUSH_TOKEN_KEY: key,
  RUSTORE_PUSH_PROJECTS: "project-a,project-b",
  RUSTORE_PUSH_SERVICE_TOKEN: "service-secret",
});
const installation = () => randomUUID();
const registration = (
  overrides: Partial<PushRegistration> = {},
): PushRegistration => ({
  installationId: installation(),
  provider: "rustore",
  projectId: "project-a",
  token: "address-" + randomUUID(),
  ...overrides,
});

async function setup() {
  const db = await testDatabase();
  const user = async () => (await userRow(db)).id;
  const session = async (userId: string) =>
    (
      await createDeviceSession(
        db,
        userId,
        { name: "Pixel", platform: "android", appVersion: "1.0" },
        "test",
      )
    ).sessionId;
  const register = (
    userId: string,
    sessionId: string,
    input: PushRegistration,
    when = new Date(),
  ) =>
    db.transaction((q) =>
      registerPushDevice(q, { ...input, userId, sessionId }, env, when),
    );
  const rejected = async (run: () => Promise<unknown>, problem: string) => {
    await assert.rejects(
      run,
      (error: unknown) =>
        error instanceof PushRegistryError && error.problem === problem,
    );
  };
  return { db, user, session, register, rejected };
}

test("the configuration is off until the key, a project and the provider's token are set", () => {
  assert.equal(pushConfig(processEnv()).registry, false);
  assert.equal(pushAvailable(processEnv()), false);
  assert.equal(
    pushConfig(processEnv({ PUSH_TOKEN_KEY: "short" })).registry,
    false,
  );
  const registryOnly = processEnv({
    PUSH_TOKEN_KEY: key,
    RUSTORE_PUSH_PROJECTS: "p",
  });
  assert.equal(pushConfig(registryOnly).registry, true);
  assert.equal(pushConfig(registryOnly).sender, false);
  assert.equal(pushAvailable(registryOnly), false);
  assert.equal(pushAvailable(env), true);
  // A project name is a name, not a path or a URL.
  assert.deepEqual(
    pushConfig(
      processEnv({
        PUSH_TOKEN_KEY: key,
        RUSTORE_PUSH_PROJECTS: "ok, http://evil.test , a/b ,fine-1",
      }),
    ).projects,
    ["ok", "fine-1"],
  );
});

test("an address is sealed to its session: not readable without the key, nor from another session", () => {
  const sealed = sealPushToken(
    "secret-address",
    "session-1",
    Buffer.from(key, "base64"),
  );
  assert.ok(!sealed.includes("secret-address"));
  assert.equal(openPushToken(sealed, "session-1", env), "secret-address");
  assert.equal(openPushToken(sealed, "session-2", env), null);
  assert.equal(
    openPushToken(
      sealed,
      "session-1",
      processEnv({ PUSH_TOKEN_KEY: randomBytes(32).toString("base64") }),
    ),
    null,
  );
  assert.equal(
    openPushToken(sealed.slice(0, -2) + "xx", "session-1", env),
    null,
  );
  // Rotating the key: the old one still opens what it sealed.
  const next = randomBytes(32).toString("base64");
  assert.equal(
    openPushToken(
      sealed,
      "session-1",
      processEnv({ PUSH_TOKEN_KEY: next, PUSH_TOKEN_KEY_PREVIOUS: key }),
    ),
    "secret-address",
  );
  // Two seals of one address differ.
  assert.notEqual(
    sealed,
    sealPushToken("secret-address", "session-1", Buffer.from(key, "base64")),
  );
});

test("a registration is the first generation, stores no clear address and is idempotent", async () => {
  const { db, user, session, register } = await setup();
  const id = await user();
  const sessionId = await session(id);
  const input = registration();
  const first = await register(id, sessionId, input);
  assert.equal(first.generation, 1);
  assert.equal(first.projectId, "project-a");
  const row = (
    await db.query<{ token_ciphertext: string; token_hash: string }>(
      "SELECT token_ciphertext,token_hash FROM push_devices WHERE session_id=$1",
      [sessionId],
    )
  ).rows[0];
  assert.ok(!row.token_ciphertext.includes(input.token));
  assert.ok(!row.token_hash.includes(input.token));
  assert.equal(
    openPushToken(row.token_ciphertext, sessionId, env),
    input.token,
  );
  // The same again, later: the same generation, and the clock moves.
  const again = await register(
    id,
    sessionId,
    input,
    new Date(Date.now() + 5000),
  );
  assert.equal(again.generation, 1);
  assert.ok(again.lastSeenAt > first.lastSeenAt);
  assert.equal((await db.query("SELECT 1 FROM push_devices")).rowCount, 1);
  assert.equal((await pushDeviceOf(db, sessionId))?.generation, 1);
  await db.close();
});

test("a new address, project or install is the next generation, and what was made for the old one is dropped", async () => {
  const { db, user, session, register } = await setup();
  const id = await user();
  const sessionId = await session(id);
  const input = registration();
  await register(id, sessionId, input);
  const notice = await noticeRow(db, id, "follow", { actor_id: await user() });
  await db.query(
    "INSERT INTO push_deliveries(notification_id,recipient_id,device_session_id,generation,expires_at) VALUES($1,$2,$3,1,now()+interval '1 day')",
    [notice.id, id, sessionId],
  );
  const rotated = await register(id, sessionId, {
    ...input,
    token: "rotated-" + randomUUID(),
  });
  assert.equal(rotated.generation, 2);
  const delivery = (
    await db.query<{ status: string; error_code: string }>(
      "SELECT status,error_code FROM push_deliveries",
    )
  ).rows[0];
  assert.deepEqual(delivery, { status: "skipped", error_code: "rebound" });
  const otherProject = await register(id, sessionId, {
    ...input,
    token: "rotated-2",
    projectId: "project-b",
  });
  assert.equal(otherProject.generation, 3);
  const reinstalled = await register(id, sessionId, {
    ...input,
    token: "rotated-2",
    projectId: "project-b",
    installationId: installation(),
  });
  assert.equal(reinstalled.generation, 4);
  await db.close();
});

test("an address the server does not allow is refused, and so is a registration while push is off", async () => {
  const { db, user, session, register, rejected } = await setup();
  const id = await user();
  const sessionId = await session(id);
  await rejected(
    () => register(id, sessionId, registration({ projectId: "someone-else" })),
    "project",
  );
  await rejected(
    () =>
      db.transaction((q) =>
        registerPushDevice(
          q,
          { ...registration(), userId: id, sessionId },
          processEnv(),
        ),
      ),
    "unavailable",
  );
  assert.equal((await db.query("SELECT 1 FROM push_devices")).rowCount, 0);
  await db.close();
});

test("only a live device session of the person registers", async () => {
  const { db, user, session, register, rejected } = await setup();
  const id = await user();
  const other = await user();
  const sessionId = await session(id);
  await rejected(() => register(other, sessionId, registration()), "session");
  await rejected(() => register(id, randomUUID(), registration()), "session");
  const browser = (
    await db.query<{ id: string }>(
      "INSERT INTO sessions(token_hash,user_id,expires_at,user_agent) VALUES($1,$2,now()+interval '1 day','x') RETURNING id",
      ["b".repeat(64), id],
    )
  ).rows[0].id;
  await rejected(() => register(id, browser, registration()), "session");
  await db.close();
});

test("a late request with an older generation does not bring the past back", async () => {
  const { db, user, session, register, rejected } = await setup();
  const id = await user();
  const sessionId = await session(id);
  const input = registration();
  await register(id, sessionId, input);
  const rotated = await register(id, sessionId, {
    ...input,
    token: "new-" + randomUUID(),
  });
  assert.equal(rotated.generation, 2);
  await rejected(
    () => register(id, sessionId, { ...input, expectedGeneration: 1 }),
    "stale",
  );
  assert.equal((await pushDeviceOf(db, sessionId))?.generation, 2);
  // The generation the app holds is accepted.
  const kept = await register(id, sessionId, {
    ...input,
    token: "new-2",
    expectedGeneration: 2,
  });
  assert.equal(kept.generation, 3);
  await db.close();
});

test("an address that moves to another account leaves the previous holder with nothing", async () => {
  const { db, user, session, register } = await setup();
  const first = await user();
  const second = await user();
  const firstSession = await session(first);
  const secondSession = await session(second);
  const input = registration();
  await register(first, firstSession, input);
  const notice = await noticeRow(db, first, "follow", { actor_id: second });
  await db.query(
    "INSERT INTO push_deliveries(notification_id,recipient_id,device_session_id,generation,expires_at) VALUES($1,$2,$3,1,now()+interval '1 day')",
    [notice.id, first, firstSession],
  );
  // The same phone, signed in as someone else, with the same address.
  const moved = await register(second, secondSession, {
    ...input,
    installationId: installation(),
  });
  assert.equal(moved.generation, 1);
  assert.equal(await pushDeviceOf(db, firstSession), null);
  const revoked = (
    await db.query<{ revoke_reason: string }>(
      "SELECT revoke_reason FROM push_devices WHERE session_id=$1",
      [firstSession],
    )
  ).rows[0];
  assert.equal(revoked.revoke_reason, "replaced");
  assert.equal(
    (await db.query<{ status: string }>("SELECT status FROM push_deliveries"))
      .rows[0].status,
    "skipped",
  );
  await db.close();
});

test("a person has a bounded number of phones with push; a revoked one does not count", async () => {
  const { db, user, session, register, rejected } = await setup();
  const id = await user();
  const sessions: string[] = [];
  for (let index = 0; index < pushDevicesPerUser; index++) {
    sessions.push(await session(id));
    await register(id, sessions[index], registration());
  }
  const extra = await session(id).catch(() => null);
  // The session limit (20) is higher than the push one: this still exists.
  assert.ok(extra);
  await rejected(() => register(id, extra, registration()), "limit");
  await db.transaction((q) => revokePushDevice(q, sessions[0], "user"));
  assert.equal((await register(id, extra, registration())).generation, 1);
  await db.close();
});

test("revoking ends the registration; making it again is the next generation", async () => {
  const { db, user, session, register } = await setup();
  const id = await user();
  const sessionId = await session(id);
  const input = registration();
  await register(id, sessionId, input);
  assert.equal(
    await db.transaction((q) => revokePushDevice(q, sessionId, "user")),
    true,
  );
  assert.equal(await pushDeviceOf(db, sessionId), null);
  // Revoking twice says there was nothing to revoke.
  assert.equal(
    await db.transaction((q) => revokePushDevice(q, sessionId, "user")),
    false,
  );
  const again = await register(id, sessionId, input);
  assert.equal(again.generation, 2);
  assert.ok(await pushDeviceOf(db, sessionId));
  await db.close();
});

test("the registration goes with the session, the account and what was made for it", async () => {
  const { db, user, session, register } = await setup();
  const id = await user();
  const sessionId = await session(id);
  const other = await user();
  const otherSession = await session(other);
  await register(id, sessionId, registration());
  await register(other, otherSession, registration());
  const notice = await noticeRow(db, id, "follow", { actor_id: other });
  await db.query(
    "INSERT INTO push_deliveries(notification_id,recipient_id,device_session_id,generation,expires_at) VALUES($1,$2,$3,1,now()+interval '1 day')",
    [notice.id, id, sessionId],
  );
  // A logout, a revoke, a block and a password reset delete the session.
  await db.query("DELETE FROM sessions WHERE id=$1", [sessionId]);
  assert.equal(
    (await db.query("SELECT 1 FROM push_devices WHERE user_id=$1", [id]))
      .rowCount,
    0,
  );
  assert.equal((await db.query("SELECT 1 FROM push_deliveries")).rowCount, 0);
  // The deletion of an account.
  await db.query("DELETE FROM users WHERE id=$1", [other]);
  assert.equal((await db.query("SELECT 1 FROM push_devices")).rowCount, 0);
  await db.close();
});

test("production startup refuses a half-filled push configuration", () => {
  const production = processEnv({
    DEPLOYMENT_MODE: "production",
    POSTGRES_PASSWORD: "x7Kq-9vLm2Zr4Tn8Wp3Hs6Yd1Bc5Fg",
    APP_ORIGIN: "https://colabike.ru",
    COOKIE_SECURE: "true",
    TRUSTED_PROXY_KEY: "k".repeat(32),
    BIKE_RESOLVER_TOKEN: "t".repeat(32),
    DATABASE_URL: "postgres://u:p@db/cola",
    BIKE_RESOLVER_URL: "http://resolver:8080",
  });
  const attempt = (extra: Record<string, string>) => () =>
    validateRuntime({ ...production, ...extra });
  // Off, and fully on, are both fine.
  assert.doesNotThrow(attempt({}));
  assert.doesNotThrow(
    attempt({ PUSH_TOKEN_KEY: key, RUSTORE_PUSH_PROJECTS: "project-a" }),
  );
  assert.doesNotThrow(
    attempt({
      PUSH_TOKEN_KEY: key,
      PUSH_TOKEN_KEY_PREVIOUS: randomBytes(32).toString("base64"),
      RUSTORE_PUSH_PROJECTS: "project-a, project-b",
      RUSTORE_PUSH_SERVICE_TOKEN: "service-secret",
    }),
  );
  // A provider token without the registry, a key that is not 32 bytes, no project.
  assert.throws(attempt({ RUSTORE_PUSH_SERVICE_TOKEN: "x" }), /PUSH_TOKEN_KEY/);
  assert.throws(
    attempt({ PUSH_TOKEN_KEY: "short", RUSTORE_PUSH_PROJECTS: "project-a" }),
    /32 random bytes/,
  );
  assert.throws(attempt({ PUSH_TOKEN_KEY: key }), /RUSTORE_PUSH_PROJECTS/);
  assert.throws(
    attempt({
      PUSH_TOKEN_KEY: key,
      PUSH_TOKEN_KEY_PREVIOUS: "nope",
      RUSTORE_PUSH_PROJECTS: "project-a",
    }),
    /PUSH_TOKEN_KEY_PREVIOUS/,
  );
});
