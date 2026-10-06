// API v1, the native bridge to Stream Chat (#324), through the real server,
// PostgreSQL and the test double of the chat provider (the `--chat` run): a
// device session's Bearer token does what the site's cookie does, with the same
// rules (verified e-mail, blocked people, shared budgets), the application
// secret never leaves the server and the provider's own errors are not repeated.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "chat-v1-password-123";

async function http(path, { method = "GET", headers = {}, body, raw } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(body === undefined || raw
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
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
async function member(label, { verified = true, name } = {}) {
  const email = `chat-v1-${label}-${run}@example.test`;
  let cookie = "";
  const registered = await http("/api/auth/register", {
    method: "POST",
    headers: { origin: base },
    body: { ...testConsents, name: name ?? "Чат " + label, email, password },
  });
  assert.equal(registered.status, 201, registered.text);
  cookie = registered.headers.get("set-cookie").split(";")[0];
  if (verified) await verifyCapturedEmail(email);
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const bearer = "Bearer " + grant.body.accessToken;
  return {
    id: registered.body.user.id,
    // A native client: a Bearer token and no Origin at all.
    token: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: { authorization: bearer, ...(options.headers ?? {}) },
      }),
    // The browser: the session cookie and the Origin of the site.
    cookie: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: { cookie, origin: base, ...(options.headers ?? {}) },
      }),
    cookieNoOrigin: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: { cookie, ...(options.headers ?? {}) },
      }),
    withBoth: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: { cookie, authorization: bearer, ...(options.headers ?? {}) },
      }),
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const code = (response) => response.body?.error?.code;

try {
  const alice = await member("alice", { name: "Чатова Алиса " + run });
  const bob = await member("bob", { name: "Чатов Боб " + run });
  const carol = await member("carol", { name: "Чатова Кэрол " + run });

  // A guest has no chat; neither a token nor a cookie together with a token.
  for (const [method, path] of [
    ["POST", "/chat/token"],
    ["POST", "/chat/channels"],
    ["GET", "/chat/people"],
    ["GET", "/chat/unread"],
  ]) {
    const refused = await guest(path, {
      method,
      body: method === "POST" ? {} : undefined,
    });
    assert.equal(refused.status, 401, path);
    assert.equal(code(refused), "unauthorized", path);
  }
  const both = await alice.withBoth("/chat/token", { method: "POST" });
  assert.equal(both.status, 400);
  assert.equal(code(both), "ambiguous_authentication");

  // The token of a device: its own profile, a public key, no secret.
  const issued = await alice.token("/chat/token", { method: "POST" });
  assert.equal(issued.status, 200, issued.text);
  assert.match(issued.headers.get("cache-control") || "", /no-store/);
  assert.equal(issued.body.apiKey, "test-key");
  assert.equal(issued.body.user.id, "cola_" + alice.id.replaceAll("-", ""));
  assert.equal(issued.body.user.image, null);
  assert.equal(issued.body.channelType, "colabike");
  assert.equal(issued.body.token.split(".").length, 3, "a JWT");
  const lifetime = Date.parse(issued.body.expiresAt) - Date.now();
  assert.ok(
    lifetime > 200_000 && lifetime <= 300_000,
    "five minutes: " + lifetime,
  );
  assert.deepEqual(Object.keys(issued.body).sort(), [
    "apiKey",
    "channelType",
    "expiresAt",
    "token",
    "user",
  ]);
  assert.equal(issued.text.includes("test-secret"), false, "the secret stays");
  // The cookie of the site gets the same, from its own origin only.
  assert.equal(
    (await alice.cookie("/chat/token", { method: "POST" })).status,
    200,
  );
  const noOrigin = await alice.cookieNoOrigin("/chat/token", {
    method: "POST",
  });
  assert.equal(noOrigin.status, 403);
  assert.equal(code(noOrigin), "forbidden");
  assert.equal(
    (
      await alice.cookie("/chat/token", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  // A wrong method says what is allowed.
  const wrong = await alice.token("/chat/token");
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("allow"), "POST, OPTIONS");
  assert.equal(
    (await alice.token("/chat/unread", { method: "POST" })).status,
    405,
  );

  // People: the same eligible people as the site, with a public face only.
  const found = await alice.token(
    "/chat/people?q=" + encodeURIComponent("Чатов"),
  );
  assert.equal(found.status, 200, found.text);
  assert.equal(found.body.mode, "search");
  const ids = found.body.people.map((person) => person.id);
  assert.ok(ids.includes(bob.id) && ids.includes(carol.id));
  assert.equal(ids.includes(alice.id), false, "not oneself");
  for (const person of found.body.people)
    assert.deepEqual(Object.keys(person).sort(), [
      "avatarUrl",
      "id",
      "name",
      "username",
    ]);
  assert.deepEqual((await alice.token("/chat/people")).body, {
    people: [],
    mode: "following",
  });
  assert.deepEqual(
    (await alice.token("/chat/people?q=%D0%A7")).body.people,
    [],
  );
  assert.equal((await alice.token("/chat/people?x=1")).status, 400);
  assert.equal((await alice.token("/chat/people?q=a&q=b")).status, 400);
  assert.equal(
    (await alice.token("/chat/people?q=" + "x".repeat(81))).status,
    400,
  );

  // Channels: a dialog is one channel for both; a group is a new one.
  const dm = await alice.token("/chat/channels", {
    method: "POST",
    body: { kind: "dm", members: [bob.id] },
  });
  assert.equal(dm.status, 201, dm.text);
  assert.match(dm.body.cid, /^colabike:dm_[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(dm.body), ["cid"]);
  const back = await bob.token("/chat/channels", {
    method: "POST",
    body: { kind: "dm", members: [alice.id.toUpperCase()] },
  });
  assert.equal(back.body.cid, dm.body.cid);
  const key = randomUUID();
  const groupBody = {
    kind: "group",
    name: "Заезд",
    members: [bob.id, carol.id],
  };
  const group = await alice.token("/chat/channels", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: groupBody,
  });
  assert.equal(group.status, 201, group.text);
  assert.match(group.body.cid, /^colabike:group_[0-9a-f]{32}$/);
  const replay = await alice.token("/chat/channels", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: groupBody,
  });
  assert.equal(replay.status, 201);
  assert.equal(
    replay.body.cid,
    group.body.cid,
    "a repeat is not a second group",
  );
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const again = await alice.token("/chat/channels", {
    method: "POST",
    body: groupBody,
  });
  assert.notEqual(again.body.cid, group.body.cid, "without a key it is new");
  const changed = await alice.token("/chat/channels", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: { ...groupBody, name: "Другой" },
  });
  assert.equal(changed.status, 409);
  assert.equal(code(changed), "conflict");
  // What is not allowed.
  const channel = (body, options = {}) =>
    alice.token("/chat/channels", { method: "POST", body, ...options });
  const self = await channel({ kind: "dm", members: [alice.id] });
  assert.equal(self.status, 400);
  assert.equal(code(self), "invalid_request");
  assert.equal(
    (await channel({ kind: "dm", members: [randomUUID()] })).status,
    404,
  );
  assert.equal(
    code(await channel({ kind: "dm", members: [randomUUID()] })),
    "not_found",
  );
  for (const bad of [
    { kind: "dm", members: [bob.id, carol.id] },
    { kind: "dm", name: "Имя", members: [bob.id] },
    { kind: "group", members: [bob.id, carol.id] },
    { kind: "group", name: "Один", members: [bob.id] },
    { kind: "group", name: "Двое", members: [bob.id, bob.id] },
    { kind: "channel", members: [bob.id] },
    { kind: "dm", members: ["not-a-uuid"] },
    { kind: "dm", members: [bob.id], extra: true },
    {},
  ]) {
    const refused = await channel(bad);
    assert.equal(refused.status, 400, JSON.stringify(bad));
    assert.equal(code(refused), "invalid_request");
  }
  assert.equal(
    (
      await channel("kind=dm", {
        raw: true,
        headers: { "content-type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(
    (await channel({ kind: "group", name: "x", members: ["y".repeat(5000)] }))
      .status,
    413,
  );

  // Unread: the provider's number, no parameters.
  const unread = await alice.token("/chat/unread");
  assert.equal(unread.status, 200, unread.text);
  assert.deepEqual(unread.body, { unread: 2 });
  assert.equal((await alice.token("/chat/unread?x=1")).status, 400);

  // A person who is blocked or has no confirmed e-mail is nobody's contact, and
  // has no chat: the rules are the site's.
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [carol.id]);
  const hidden = await alice.token(
    "/chat/people?q=" + encodeURIComponent("Чатов"),
  );
  assert.equal(
    hidden.body.people.some((person) => person.id === carol.id),
    false,
  );
  assert.equal(
    (await channel({ kind: "dm", members: [carol.id] })).status,
    404,
  );
  const blocked = await carol.token("/chat/token", { method: "POST" });
  assert.equal(blocked.status, 401);
  assert.equal(code(blocked), "invalid_token");
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [carol.id]);

  const unconfirmed = await member("unconfirmed", { verified: false });
  for (const [path, options] of [
    ["/chat/token", { method: "POST" }],
    ["/chat/people", {}],
    ["/chat/unread", {}],
  ]) {
    const refused = await unconfirmed.token(path, options);
    assert.equal(refused.status, 403, path);
    assert.equal(code(refused), "email_verification_required", path);
  }
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
    bob.id,
  ]);
  assert.equal((await channel({ kind: "dm", members: [bob.id] })).status, 404);
  await db.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
    bob.id,
  ]);

  // Blocking people (#354): no dialog or group between a pair in which one
  // blocked the other, nobody finds them for a dialog, and the block is made in
  // Stream by the worker, which then has nothing left to do.
  const blocker = await member("blocker", { name: "Блокирующий " + run });
  const blockee = await member("blockee", { name: "Заблокированный " + run });
  const bystander = await member("bystander");
  const talk = (who, other) =>
    who.token("/chat/channels", {
      method: "POST",
      body: { kind: "dm", members: [other.id] },
    });
  const jobOf = async () =>
    (
      await db.query(
        "SELECT op FROM chat_block_jobs WHERE blocker_id=$1 AND blocked_id=$2",
        [blocker.id, blockee.id],
      )
    ).rows[0]?.op ?? null;
  const sync = () =>
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "./tests/fixtures/chat-provider.js",
        "scripts/chat-sync.js",
        "--once",
      ],
      { env: process.env },
    );
  assert.equal((await talk(blocker, blockee)).status, 201, "a dialog before");
  const blockPath = `/users/${blockee.id}/block`;
  assert.equal((await blocker.token(blockPath, { method: "PUT" })).status, 200);
  assert.equal(await jobOf(), "block", "both were in chat: Stream is told");
  assert.equal((await talk(blocker, blockee)).status, 404, "the blocker");
  assert.equal((await talk(blockee, blocker)).status, 404, "the blocked");
  const groupOfBoth = await bystander.token("/chat/channels", {
    method: "POST",
    body: { kind: "group", name: "Группа", members: [blocker.id, blockee.id] },
  });
  assert.equal(groupOfBoth.status, 404, "a group with both of them");
  assert.doesNotMatch(
    groupOfBoth.text,
    /заблок/i,
    "nobody is told who blocked",
  );
  const findable = async (who, name) =>
    (
      await who.token("/chat/people?q=" + encodeURIComponent(name))
    ).body.people.map((p) => p.id);
  assert.deepEqual(await findable(blocker, "Заблокированный " + run), []);
  assert.deepEqual(await findable(blockee, "Блокирующий " + run), []);
  assert.deepEqual(await findable(bystander, "Заблокированный " + run), [
    blockee.id,
  ]);
  assert.doesNotMatch((await sync()).stderr, /chat_block_sync_retry/);
  assert.equal(await jobOf(), null, "the worker made the block");
  assert.equal(
    (await blocker.token(blockPath, { method: "DELETE" })).status,
    200,
  );
  assert.equal(await jobOf(), "unblock");
  assert.doesNotMatch((await sync()).stderr, /chat_block_sync_retry/);
  assert.equal(await jobOf(), null, "and took it back");
  assert.equal((await talk(blocker, blockee)).status, 201, "a dialog again");

  // A budget: ten channel requests a window, shared with the site; then 429.
  const eager = await member("eager");
  let limit = null;
  for (let i = 0; i < 12 && !limit; i++) {
    const response = await eager.token("/chat/channels", {
      method: "POST",
      body: { kind: "dm", members: [bob.id] },
    });
    if (response.status === 429) limit = response;
    else assert.equal(response.status, 201, response.text);
  }
  assert.ok(limit, "the budget of channels");
  assert.equal(code(limit), "rate_limited");
  assert.ok(Number(limit.headers.get("retry-after")) > 0);

  // Signing the device out ends its chat token at once.
  const ended = await bob.token("/auth/sessions/current", { method: "DELETE" });
  assert.equal(ended.status, 204, ended.text);
  const revoked = await bob.token("/chat/token", { method: "POST" });
  assert.equal(revoked.status, 401);
  assert.equal(code(revoked), "invalid_token");

  // The provider's own failure is not repeated: only that it is unavailable.
  const failing = await member("failing", { name: "vendor-failure-v1" });
  const failed = await failing.token("/chat/token", { method: "POST" });
  assert.equal(failed.status, 503, failed.text);
  assert.equal(code(failed), "service_unavailable");
  assert.ok(failed.headers.get("retry-after"));
  assert.doesNotMatch(failed.text, /do-not-leak|authorization|secret/i);

  console.log("api v1 chat http: ok");
} finally {
  await db.end();
}
