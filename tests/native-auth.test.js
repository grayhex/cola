import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_CODE_PREFIX,
  challengeOf,
  challengePattern,
  issueNativeCode,
  nativeAuthReturnUrl,
  nativeReturn,
  redeemNativeCode,
  verifierPattern,
} from "../lib/native-auth.ts";
import {
  consumeFlow,
  readPendingSignup,
  saveFlow,
  savePendingSignup,
} from "../lib/identities.ts";
import { createSessionRequestSchema } from "../lib/api-v1/schemas.ts";

// Native sign-in with an external provider (#304): the code of the app, its
// PKCE check, and the pieces of the web flow that carry the app's challenge.
// The redirect flow end to end is tests/api-v1-native-auth-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

async function addUser(blocked = false) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,'Имя','hash',$3,$4)",
    [id, id + "@test.invalid", "u" + id.slice(0, 12), blocked],
  );
  return id;
}
const verifier = () => randomBytes(32).toString("base64url");
const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;

test("PKCE: the S256 of the RFC 7636 example, and the shapes", () => {
  assert.equal(
    challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  assert.match(challengeOf(verifier()), challengePattern);
  assert.match(verifier(), verifierPattern);
  assert.doesNotMatch("short", verifierPattern);
  assert.doesNotMatch("a".repeat(129), verifierPattern);
  assert.doesNotMatch("has space " + "a".repeat(40), verifierPattern);
});

test("the return link is the operator's, HTTPS, without parameters", () => {
  const ok = (value) => nativeAuthReturnUrl({ NATIVE_AUTH_RETURN_URL: value });
  assert.equal(nativeAuthReturnUrl({}), null);
  assert.equal(ok(""), null);
  assert.equal(
    ok("https://app.colabike.test/auth/callback").pathname,
    "/auth/callback",
  );
  assert.ok(ok("http://localhost:3000/cb"), "local development");
  assert.ok(ok("http://127.0.0.1/cb"));
  for (const bad of [
    "http://app.colabike.test/cb",
    "colabike://auth",
    "https://user:pass@app.colabike.test/cb",
    "https://app.colabike.test/cb?x=1",
    "https://app.colabike.test/cb#frag",
    "not a url",
    "javascript:alert(1)",
  ])
    assert.equal(ok(bad), null, bad);
  const base = ok("https://app.colabike.test/auth/callback");
  assert.equal(
    nativeReturn(base, { code: "cola_ac_x" }).toString(),
    "https://app.colabike.test/auth/callback?code=cola_ac_x",
  );
  assert.equal(
    nativeReturn(base, { error: "cancelled" }).toString(),
    "https://app.colabike.test/auth/callback?error=cancelled",
  );
  assert.equal(base.search, "", "the base is not changed");
});

test("the code is taken once, only with the verifier it was made for", async () => {
  const user = await addUser();
  const secret = verifier();
  const code = await issueNativeCode(db, user, challengeOf(secret));
  assert.ok(code.startsWith(NATIVE_CODE_PREFIX));
  // Only a digest is stored.
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE code_hash=$1",
      [code],
    ),
    0,
  );
  assert.equal(await redeemNativeCode(db, code, secret), user);
  assert.equal(await redeemNativeCode(db, code, secret), null, "once");
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE user_id=$1",
      [user],
    ),
    0,
  );
});

test("a wrong verifier spends the code, a malformed one is refused before touching it", async () => {
  const user = await addUser();
  const secret = verifier();
  const code = await issueNativeCode(db, user, challengeOf(secret));
  assert.equal(await redeemNativeCode(db, code, "short"), null);
  assert.equal(await redeemNativeCode(db, "cola_ac_nope", secret), null);
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE user_id=$1",
      [user],
    ),
    1,
    "malformed input did not spend it",
  );
  assert.equal(
    await redeemNativeCode(db, code, verifier()),
    null,
    "wrong verifier",
  );
  assert.equal(
    await redeemNativeCode(db, code, secret),
    null,
    "and the right one is too late: the attempt spent it",
  );
});

test("a code expires, and a blocked person gets nothing", async () => {
  const user = await addUser();
  const secret = verifier();
  const old = await issueNativeCode(db, user, challengeOf(secret));
  await db.query(
    "UPDATE native_auth_codes SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [user],
  );
  assert.equal(await redeemNativeCode(db, old, secret), null);
  const fresh = await issueNativeCode(db, user, challengeOf(secret));
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [user]);
  assert.equal(await redeemNativeCode(db, fresh, secret), null);
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE user_id=$1",
      [user],
    ),
    0,
  );
  // Issuing sweeps expired codes of anyone.
  const other = await addUser();
  await issueNativeCode(db, other, challengeOf(secret));
  await db.query(
    "UPDATE native_auth_codes SET expires_at=now()-interval '1 day' WHERE user_id=$1",
    [other],
  );
  await issueNativeCode(db, await addUser(), challengeOf(secret));
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE user_id=$1",
      [other],
    ),
    0,
  );
});

test("codes belong to the account: deleting it deletes them", async () => {
  const user = await addUser();
  await issueNativeCode(db, user, challengeOf(verifier()));
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  assert.equal(
    await count(
      "SELECT count(*)::int n FROM native_auth_codes WHERE user_id=$1",
      [user],
    ),
    0,
  );
});

test("a native flow keeps the app's challenge, and cannot exist without it", async () => {
  const challenge = challengeOf(verifier());
  const flow = (extra) => ({
    provider: "yandex",
    state: randomBytes(32).toString("base64url"),
    browser: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    returnPath: "/account",
    ...extra,
  });
  const native = flow({ purpose: "native", appChallenge: challenge });
  await saveFlow(db, native);
  const taken = await consumeFlow(db, "yandex", native.state, native.browser);
  assert.equal(taken.purpose, "native");
  assert.equal(taken.app_challenge, challenge);
  assert.equal(
    await consumeFlow(db, "yandex", native.state, native.browser),
    null,
    "once",
  );
  // A web flow has none.
  const web = flow({ purpose: "login" });
  await saveFlow(db, web);
  assert.equal(
    (await consumeFlow(db, "yandex", web.state, web.browser)).app_challenge,
    null,
  );
  // The table refuses the two inconsistent shapes.
  await assert.rejects(saveFlow(db, flow({ purpose: "native" })));
  await assert.rejects(
    saveFlow(db, flow({ purpose: "login", appChallenge: challenge })),
  );
  await assert.rejects(
    saveFlow(db, flow({ purpose: "native", appChallenge: "short" })),
  );
});

test("a parked first sign-in carries the challenge to the completion", async () => {
  const challenge = challengeOf(verifier());
  const token = await savePendingSignup(db, {
    provider: "yandex",
    subject: "s-" + randomUUID(),
    name: "Имя",
    email: null,
    returnPath: "/account",
    appChallenge: challenge,
  });
  assert.equal((await readPendingSignup(db, token)).app_challenge, challenge);
  const plain = await savePendingSignup(db, {
    provider: "yandex",
    subject: "s-" + randomUUID(),
    name: "Имя",
    email: null,
    returnPath: "/account",
  });
  assert.equal((await readPendingSignup(db, plain)).app_challenge, null);
});

test("the session request takes one method: a password or a code", () => {
  const device = { name: "Телефон", platform: "ios" };
  const code = NATIVE_CODE_PREFIX + "A".repeat(43);
  const codeVerifier = "B".repeat(43);
  const ok = (body) =>
    createSessionRequestSchema.safeParse({ device, ...body }).success;
  assert.ok(ok({ email: "a@b.cd", password: "secret" }));
  assert.ok(ok({ code, codeVerifier }));
  assert.ok(!ok({}), "no method");
  assert.ok(!ok({ email: "a@b.cd" }), "half a password");
  assert.ok(!ok({ code }), "a code without its verifier");
  assert.ok(!ok({ codeVerifier }));
  assert.ok(
    !ok({ email: "a@b.cd", password: "secret", code, codeVerifier }),
    "both",
  );
  assert.ok(
    !ok({ email: "a@b.cd", password: "secret", code }),
    "a password and half a code",
  );
  assert.ok(!ok({ code: "cola_ac_short", codeVerifier }), "a malformed code");
  assert.ok(!ok({ code, codeVerifier: "short" }), "a malformed verifier");
  assert.ok(!ok({ code, codeVerifier, admin: true }), "unknown field");
});
