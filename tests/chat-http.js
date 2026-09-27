import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import pg from "pg";
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
assert.equal((await a("chat/token", {}, "https://evil.test")).status, 403);
assert.equal((await a("chat/token", { user_id: bob.id })).status, 400);
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
  await pool.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    alice.id,
  ]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [alice.id]);
  assert.equal((await a("chat/token", {})).status, 401);
} finally {
  await pool.end();
}
const failure = browser();
await register(failure, "vendor-failure-test");
const failed = await failure("chat/token", {});
assert.equal(failed.status, 503);
assert.doesNotMatch(
  JSON.stringify(failed.body),
  /do-not-leak|authorization|secret=/,
);
console.log(
  "Chat HTTP: own-user tokens, CSRF, verified email, private export, deterministic DM, blocked users, logout and safe vendor failures.",
);
