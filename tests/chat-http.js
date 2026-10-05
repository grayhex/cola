import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const origin = process.env.TEST_ORIGIN;
function browser() {
  let cookie = "";
  return async (path, data, source = origin) => {
    const r = await verifiedFetch(origin + "/api/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { origin: source, cookie, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
}
const a = browser(),
  b = browser(),
  guest = browser();
const register = async (call, name) => {
  const r = await call("auth/register", {
    ...testConsents,
    name,
    email: randomUUID() + "@example.test",
    password: "chat-test-password-123",
  });
  assert.equal(r.status, 201);
  return (await call("me")).body.user;
};
const alice = await register(a, "Chat Alice"),
  bob = await register(b, "Chat Bob");
assert.equal((await guest("chat/token", {})).status, 401);
assert.equal((await guest("chat/people?q=Chat")).status, 401);
assert.deepEqual((await a("chat/people")).body.people, []);
assert.equal((await a("chat/token", {}, "https://evil.test")).status, 403);
assert.equal((await a("chat/token", { user_id: bob.id })).status, 400);
assert.equal(
  (await a("chat/token", { padding: "x".repeat(2048) })).status,
  400,
);
assert.equal((await a("chat/not-a-real-action", {})).status, 404);
// The webhook of Stream for new messages (#342): only a signed call is taken.
const hook = (raw, signature, id = "hook-" + randomUUID()) =>
  fetch(origin + "/api/chat/webhook", {
    method: "POST",
    headers: {
      "x-api-key": "test-key",
      "x-webhook-id": id,
      "x-signature": signature,
      "content-type": "application/json",
    },
    body: raw,
  });
const signed = (raw) =>
  createHmac("sha256", "test-secret").update(raw).digest("hex");
assert.equal((await fetch(origin + "/api/chat/webhook")).status, 405);
assert.equal((await hook("{}", "0".repeat(64))).status, 401);
assert.equal((await hook("{}", "not-a-signature")).status, 401);
const other = JSON.stringify({ type: "typing.start", cid: "colabike:dm_x" });
const taken = await hook(other, signed(other));
assert.equal(taken.status, 200);
assert.deepEqual(await taken.json(), { ok: true, queued: 0 });
const token = await a("chat/token", {});
assert.equal(token.status, 200);
assert.match(token.headers.get("cache-control"), /no-store/);
assert.equal(token.body.user.id, "cola_" + alice.id.replaceAll("-", ""));
assert.equal(JSON.stringify(token.body).includes("test-secret"), false);
assert.equal(
  (await a("chat/people?q=Chat")).body.people.some((p) => p.id === alice.id),
  false,
);
assert.equal(
  (await a("chat/people?q=Chat")).body.people.some((p) => p.id === bob.id),
  true,
);
const dm = await a("chat/channels", { kind: "dm", members: [bob.id] });
assert.equal(dm.status, 201);
assert.equal(
  (await b("chat/channels", { kind: "dm", members: [alice.id] })).body.cid,
  dm.body.cid,
);
assert.equal(
  (await a("chat/channels", { kind: "dm", members: [alice.id] })).status,
  400,
);
assert.equal(
  (await a("chat/channels", { kind: "dm", members: [randomUUID()] })).status,
  404,
);
assert.equal((await a("chat/unread")).body.unread, 2);
const exported = await a("chat/export", {});
assert.equal(exported.body.user.id, token.body.user.id);
assert.match(exported.headers.get("content-disposition"), /attachment/);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query("UPDATE users SET blocked=true WHERE id=$1", [bob.id]);
  assert.equal((await b("chat/token", {})).status, 401);
  assert.equal(
    (await a("chat/channels", { kind: "dm", members: [bob.id] })).status,
    404,
  );
  assert.equal(
    (await a("chat/people?q=Chat")).body.people.some((p) => p.id === bob.id),
    false,
  );
  await pool.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
    alice.id,
  ]);
  assert.equal((await a("chat/token", {})).status, 403);
  assert.equal((await a("chat/people?q=Chat")).status, 403);
  await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    alice.id,
  ]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [alice.id]);
  assert.equal((await a("chat/token", {})).status, 401);
} finally {
  await pool.end();
}
const failure = browser();
const failingUser = await register(failure, "vendor-failure-test");
const failed = await failure("chat/token", {});
assert.equal(failed.status, 503);
assert.doesNotMatch(
  JSON.stringify(failed.body),
  /do-not-leak|authorization|secret=/,
);
// Exercise the actual ops worker and its SQL retry/backoff, without live secrets.
const workerDb = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await workerDb.query("INSERT INTO chat_identities(user_id) VALUES($1)", [
    failingUser.id,
  ]);
  await workerDb.query(
    "UPDATE users SET name='vendor-failure-worker' WHERE id=$1",
    [failingUser.id],
  );
  const { stderr } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "./tests/fixtures/chat-provider.js",
      "scripts/chat-sync.js",
      "--once",
    ],
    { env: process.env },
  );
  assert.match(stderr, /chat_sync_retry/);
  assert.doesNotMatch(stderr, /do-not-leak|authorization|test-secret/);
  const { rows } = await workerDb.query(
    "SELECT attempts,next_attempt_at>now() AS delayed FROM chat_jobs WHERE user_id=$1",
    [failingUser.id],
  );
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].delayed, true);
} finally {
  await workerDb.end();
}
console.log(
  "Chat HTTP: own-user tokens, CSRF, verified email, private export, deterministic DM, blocked users, logout and safe vendor failures.",
);
