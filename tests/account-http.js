// Account recovery and verification through the real server. The harness sets
// MAIL_CAPTURE_DIR, so every email is a JSON file this test can read.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const mailDir = process.env.MAIL_CAPTURE_DIR;
assert.ok(mailDir, "MAIL_CAPTURE_DIR must be set by the harness");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client() {
  let cookie = "";
  const call = async (url, method = "GET", data, origin = base) => {
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: response.status, body, headers: response.headers };
  };
  call.cookie = () => cookie;
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
async function noMailTo(to) {
  await sleep(700);
  for (const file of await readdir(mailDir).catch(() => []))
    if (!seen.has(file))
      assert.notEqual(JSON.parse(await readFile(path.join(mailDir, file), "utf8")).to, to);
}
const tokenFrom = (mail, route) => {
  const match = mail.text.match(new RegExp(`${route}#([A-Za-z0-9_-]{43})`));
  assert.ok(match, "mail contains a link to " + route);
  assert.ok(mail.html.includes(match[0]));
  return match[1];
};

const nonce = randomUUID().slice(0, 8);
const email = `recovery-${nonce}@example.test`;
const alice = client(),
  laptop = client(),
  guest = client();
assert.equal(
  (await alice("auth/register", "POST", { ...testConsents, name: "Alice", email, password: "first-password-123" })).status,
  201,
);

// Registration sends a confirmation link; the account starts unverified.
const verification = await nextMail(email, /Подтвердите адрес/);
assert.equal((await alice("me")).body.user.email_verified_at, null);
assert.equal((await guest("auth/verify-email", "POST", { token: "x".repeat(43) })).status, 400);
assert.equal(
  (await guest("auth/verify-email", "POST", { token: tokenFrom(verification, "/verify-email") }, "https://evil.test")).status,
  403,
);
// Works without a session: the link may be opened on another device.
assert.equal((await guest("auth/verify-email", "POST", { token: tokenFrom(verification, "/verify-email") })).status, 200);
assert.ok((await alice("me")).body.user.email_verified_at);
const replay = await guest("auth/verify-email", "POST", { token: tokenFrom(verification, "/verify-email") });
assert.equal(replay.status, 400);
assert.equal(replay.body.code, "TOKEN_INVALID");
assert.equal((await guest("account/email-verification", "POST")).status, 401);
assert.deepEqual((await alice("account/email-verification", "POST")).body, { ok: true, verified: true });

// Password reset: same answer for unknown addresses, no mail, origin enforced.
assert.equal((await guest("auth/password-reset", "POST", { email }, "https://evil.test")).status, 403);
assert.equal((await guest("auth/password-reset", "POST", { email: "not-an-email" })).status, 400);
assert.deepEqual((await guest("auth/password-reset", "POST", { email: `nobody-${nonce}@example.test` })).body, { ok: true });
await noMailTo(`nobody-${nonce}@example.test`);
assert.equal((await laptop("auth/login", "POST", { email, password: "first-password-123" })).status, 200);
assert.deepEqual((await guest("auth/password-reset", "POST", { email: email.toUpperCase() })).body, { ok: true });
const reset = await nextMail(email, /Восстановление пароля/);
const token = tokenFrom(reset, "/reset-password");

const bad = await guest("auth/password-reset/confirm", "POST", { token: "y".repeat(43), password: "second-password-456" });
assert.equal(bad.status, 400);
assert.equal(bad.body.code, "TOKEN_INVALID");
assert.equal((await guest("auth/password-reset/confirm", "POST", { token, password: "short" })).status, 400);
const confirmed = await guest("auth/password-reset/confirm", "POST", { token, password: "second-password-456" });
assert.equal(confirmed.status, 200);
assert.match(confirmed.headers.get("set-cookie") || "", /cola_session=/);
assert.equal((await guest("me")).body.user.email, email, "the confirming browser is signed in");
// Every earlier session ends.
assert.equal((await alice("me")).body.user, null);
assert.equal((await laptop("me")).body.user, null);
assert.equal((await client()("auth/login", "POST", { email, password: "first-password-123" })).status, 401);
assert.equal((await client()("auth/login", "POST", { email, password: "second-password-456" })).status, 200);
assert.equal(
  (await guest("auth/password-reset/confirm", "POST", { token, password: "third-password-789" })).body.code,
  "TOKEN_INVALID",
  "a link works once",
);

// Three requests per address per 15 minutes (one used above).
for (let i = 0; i < 2; i++)
  assert.equal((await guest("auth/password-reset", "POST", { email })).status, 200);
assert.equal((await guest("auth/password-reset", "POST", { email })).status, 429);
console.log(
  "Account HTTP: verification link, reset without enumeration, single-use tokens, session revocation, origin checks and limits passed.",
);
