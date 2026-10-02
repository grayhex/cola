// Sign-in with Yandex ID (#151) through the real server, PostgreSQL and the
// fixture provider of tests/fixtures/yandex-provider.js. The rules themselves
// are unit-tested in identities.test.js; this checks the redirect flow, the
// cookies, first sign-in, linking and the refusals end to end.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { hashPassword } from "../lib/password.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const clientId = "fixture-yandex-client";
const password = "yandex-test-password-123";
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

// A browser with a real cookie jar: the flow uses several cookies at once.
function browser() {
  const jar = new Map();
  const call = async (url, { method = "GET", data, origin = base } = {}) => {
    const response = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: {
        ...(origin ? { origin } : {}),
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";").map((p) => p.trim());
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (!value || attributes.some((a) => /^max-age=0$/i.test(a)))
        jar.delete(name);
      else jar.set(name, value);
    }
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    return {
      status: response.status,
      body,
      location: response.headers.get("location"),
      cookies: response.headers.getSetCookie(),
    };
  };
  call.jar = jar;
  return call;
}

// Starts a flow and returns what the browser was sent to plus the secrets
// the provider fixture needs to mint a matching code.
async function start(b, query = "") {
  const r = await b("/api/auth/yandex/start" + query);
  assert.equal(r.status, 303);
  const url = new URL(r.location);
  assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
  return {
    r,
    url,
    state: url.searchParams.get("state"),
    challenge: url.searchParams.get("code_challenge"),
  };
}
const account = (id, extra = {}) => ({ id, name: "Яндекс Райдер", ...extra });
const callback = (b, flow, acc, extra = {}) =>
  b(
    "/api/auth/yandex/callback?" +
      new URLSearchParams({
        state: flow.state,
        code: encode({ ...acc, challenge: flow.challenge, ...extra }),
      }),
  );
const signIn = async (b, acc, extra) => callback(b, await start(b), acc, extra);
const count = async (sql, values = []) =>
  Number((await db.query(sql, values)).rows[0].count);
const user = (email) =>
  db
    .query("SELECT * FROM users WHERE email=$1", [email])
    .then((r) => r.rows[0]);
const setRegistration = (open) =>
  db.query(
    `UPDATE site_settings SET value=jsonb_set(value,'{registrationOpen}',$1::jsonb) WHERE id=1`,
    [JSON.stringify(open)],
  );

try {
  // ── The redirect to Yandex ────────────────────────────────────────────
  const b1 = browser();
  const first = await start(b1, "?return=" + encodeURIComponent("/market"));
  const params = first.url.searchParams;
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("client_id"), clientId);
  assert.equal(params.get("redirect_uri"), base + "/api/auth/yandex/callback");
  assert.equal(params.get("scope"), "login:info");
  assert.equal(params.get("optional_scope"), "login:email");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.match(first.state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/);
  const cookie = first.r.cookies.find((c) => c.startsWith("cola_oauth="));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\/api\/auth\/yandex/i);
  assert.equal(first.r.body, null);
  assert.ok(!first.state.includes(first.challenge));
  // The verifier never leaves the server, and only digests of the secrets are stored.
  const stored = (await db.query("SELECT * FROM external_auth_flows")).rows;
  assert.ok(stored.every((row) => row.state_hash !== first.state));
  assert.ok(
    stored.some(
      (row) =>
        createHash("sha256").update(row.code_verifier).digest("base64url") ===
        first.challenge,
    ),
  );

  // ── Forged, foreign and replayed state ───────────────────────────────
  const forged = await b1(
    "/api/auth/yandex/callback?" +
      new URLSearchParams({
        state: "A".repeat(43),
        code: encode(account("1")),
      }),
  );
  assert.equal(forged.location, base + "/login?identity=state");
  assert.equal(
    (await b1("/api/auth/yandex/callback?state=short&code=x")).location,
    base + "/login?identity=invalid",
  );
  const other = browser();
  const foreign = await callback(other, first, account("2000" + run));
  assert.equal(
    foreign.location,
    base + "/login?identity=state",
    "another browser has no flow cookie",
  );
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE subject=$1", [
      "2000" + run,
    ]),
    0,
  );

  // ── First sign-in: nothing is created before username and consents ───
  const idA = "1000" + run;
  const emailA = `yandex-a-${run}@example.test`;
  const a = browser();
  const flowA = await start(a, "?return=" + encodeURIComponent("/market"));
  const cb = await callback(a, flowA, account(idA, { email: emailA }));
  assert.equal(cb.location, base + "/login/yandex");
  assert.ok(
    cb.cookies.some(
      (c) => c.startsWith("cola_oauth_signup=") && /HttpOnly/i.test(c),
    ),
  );
  assert.ok(
    !cb.cookies.some((c) => c.startsWith("cola_session=")),
    "no session yet",
  );
  assert.equal(
    await count("SELECT count(*) FROM users WHERE email=$1", [emailA]),
    0,
  );
  const replay = await callback(a, flowA, account(idA, { email: emailA }));
  assert.equal(
    replay.location,
    base + "/login?identity=state",
    "state is single use",
  );
  const pending = await a("/api/auth/yandex/pending");
  assert.deepEqual(pending.body, { name: "Яндекс Райдер", email: emailA });
  assert.equal((await browser()("/api/auth/yandex/pending")).status, 404);
  // The same-origin check and the documents apply as in registration.
  assert.equal(
    (
      await a("/api/auth/yandex/complete", {
        method: "POST",
        data: { ...testConsents },
        origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const noConsents = await a("/api/auth/yandex/complete", {
    method: "POST",
    data: { username: "yandex-a-" + run },
  });
  assert.equal(noConsents.status, 400);
  assert.equal(noConsents.body.code, "LEGAL_ACCEPTANCE_REQUIRED");
  assert.equal(
    (await a("/api/auth/yandex/pending")).status,
    200,
    "a refused completion keeps the pending sign-in",
  );
  const usernameA = "yandex-a-" + run;
  const done = await a("/api/auth/yandex/complete", {
    method: "POST",
    data: { ...testConsents, username: usernameA },
  });
  assert.equal(done.status, 201);
  assert.equal(done.body.returnPath, "/market");
  assert.equal(done.body.user.email, emailA);
  const me = await a("/api/me");
  assert.equal(me.body.user.username, usernameA);
  assert.equal(
    me.body.user.email_verified_at,
    null,
    "the provider does not promise a verified address",
  );
  const rowA = await user(emailA);
  assert.equal(rowA.password_hash, null);
  assert.equal(
    await count(
      "SELECT count(*) FROM user_identities WHERE user_id=$1 AND provider='yandex' AND subject=$2",
      [rowA.id, idA],
    ),
    1,
  );
  assert.equal(
    await count(
      "SELECT count(*) FROM user_legal_acceptances WHERE user_id=$1",
      [rowA.id],
    ),
    2,
  );
  assert.equal(
    await count(
      "SELECT count(*) FROM auth_tokens WHERE user_id=$1 AND purpose='email_verify'",
      [rowA.id],
    ),
    1,
    "the usual verification link is issued",
  );
  assert.equal(
    (
      await a("/api/auth/yandex/complete", {
        method: "POST",
        data: { ...testConsents },
      })
    ).status,
    410,
    "completion is one time",
  );

  // ── Repeat sign-in, also with registration closed ───────────────────
  await setRegistration(false);
  const again = browser();
  const back = await signIn(
    again,
    account(idA, { email: "changed@example.test" }),
  );
  assert.equal(
    back.location,
    base + "/account",
    "a linked user signs in; the default return is the account",
  );
  assert.equal((await again("/api/me")).body.user.id, rowA.id);
  assert.equal(
    await user("changed@example.test"),
    undefined,
    "the provider email is never synced",
  );
  const closed = await signIn(
    browser(),
    account("3000" + run, { email: `closed-${run}@example.test` }),
  );
  assert.equal(closed.location, base + "/login?identity=registration_closed");
  await setRegistration(true);

  // A pending sign-in cannot finish after registration is closed.
  const late = browser();
  await signIn(
    late,
    account("3100" + run, { email: `late-${run}@example.test` }),
  );
  await setRegistration(false);
  assert.equal(
    (
      await late("/api/auth/yandex/complete", {
        method: "POST",
        data: { ...testConsents },
      })
    ).status,
    403,
  );
  await setRegistration(true);

  // ── Blocked account: every method ───────────────────────────────────
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [rowA.id]);
  const barred = await signIn(browser(), account(idA));
  assert.equal(barred.location, base + "/login?identity=blocked");
  assert.ok(!barred.cookies.some((c) => c.startsWith("cola_session=")));
  assert.equal(
    (await again("/api/me")).body.user,
    null,
    "its session is invalid too",
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [rowA.id]);

  // ── Username taken, no email from Yandex, address of someone else ───
  const idB = "4000" + run;
  const b = browser();
  const cbB = await signIn(b, account(idB));
  assert.equal(cbB.location, base + "/login/yandex");
  assert.deepEqual((await b("/api/auth/yandex/pending")).body.email, null);
  const needEmail = await b("/api/auth/yandex/complete", {
    method: "POST",
    data: { ...testConsents, username: "yandex-b-" + run },
  });
  assert.equal(needEmail.status, 400);
  assert.equal(needEmail.body.code, "email_required");
  const taken = await b("/api/auth/yandex/complete", {
    method: "POST",
    data: {
      ...testConsents,
      username: usernameA,
      email: `yandex-b-${run}@example.test`,
    },
  });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, "username_taken");
  assert.equal(
    await count("SELECT count(*) FROM users WHERE email=$1", [
      `yandex-b-${run}@example.test`,
    ]),
    0,
    "a refused attempt leaves nothing behind",
  );
  // An address that belongs to another account is not merged either.
  const password_user = `password-${run}@example.test`;
  const owner = browser();
  assert.equal(
    (
      await owner("/api/auth/register", {
        method: "POST",
        data: {
          ...testConsents,
          name: "Парольный",
          email: password_user,
          password,
        },
      })
    ).status,
    201,
  );
  const clash = await b("/api/auth/yandex/complete", {
    method: "POST",
    data: {
      ...testConsents,
      username: "yandex-b-" + run,
      email: password_user,
    },
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, "email_exists");
  const okB = await b("/api/auth/yandex/complete", {
    method: "POST",
    data: {
      ...testConsents,
      username: "yandex-b-" + run,
      email: `yandex-b-${run}@example.test`,
    },
  });
  assert.equal(
    okB.status,
    201,
    "the same pending sign-in finishes after the refusals",
  );

  // A Yandex address equal to an existing account: sign in the usual way first.
  const d = browser();
  const emailClash = await signIn(
    d,
    account("5000" + run, { email: password_user.toUpperCase() }),
  );
  assert.equal(emailClash.location, base + "/login?identity=email_exists");
  assert.ok(
    !emailClash.cookies.some((c) => c.startsWith("cola_oauth_signup=")),
  );
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE subject=$1", [
      "5000" + run,
    ]),
    1 - 1,
  );

  // ── Cancelled, broken and mismatched provider answers ───────────────
  const bc = browser();
  const cancelFlow = await start(bc);
  const cancelled = await bc(
    "/api/auth/yandex/callback?" +
      new URLSearchParams({ state: cancelFlow.state, error: "access_denied" }),
  );
  assert.equal(cancelled.location, base + "/login?identity=cancelled");
  assert.equal(
    (
      await bc(
        "/api/auth/yandex/callback?" +
          new URLSearchParams({
            state: cancelFlow.state,
            error: "access_denied",
          }),
      )
    ).location,
    base + "/login?identity=state",
  );
  for (const [name, extra] of [
    [
      "wrong PKCE verifier",
      { challenge: createHash("sha256").update("x").digest("base64url") },
    ],
    ["provider refusal", { fail: true }],
    ["token of another application", { clientId: "someone-else" }],
  ]) {
    const bx = browser();
    const flow = await start(bx);
    const r = await callback(bx, flow, account("6000" + run), extra);
    assert.equal(r.location, base + "/login?identity=provider_error", name);
  }
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE subject=$1", [
      "6000" + run,
    ]),
    0,
  );

  // ── Concurrent creation of the same identity ────────────────────────
  const idC = "7000" + run;
  const [c1, c2] = [browser(), browser()];
  await signIn(c1, account(idC, { email: `c1-${run}@example.test` }));
  await signIn(c2, account(idC, { email: `c2-${run}@example.test` }));
  const results = await Promise.all([
    c1("/api/auth/yandex/complete", {
      method: "POST",
      data: { ...testConsents, username: "yandex-c1-" + run },
    }),
    c2("/api/auth/yandex/complete", {
      method: "POST",
      data: { ...testConsents, username: "yandex-c2-" + run },
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE subject=$1", [idC]),
    1,
  );
  assert.equal(
    await count("SELECT count(*) FROM users WHERE email IN ($1,$2)", [
      `c1-${run}@example.test`,
      `c2-${run}@example.test`,
    ]),
    1,
    "the losing attempt left no account",
  );
  // One pending sign-in completed twice at once creates one account.
  const idE = "8000" + run;
  const e = browser();
  await signIn(e, account(idE, { email: `e-${run}@example.test` }));
  const twice = await Promise.all(
    [1, 2].map((n) =>
      e("/api/auth/yandex/complete", {
        method: "POST",
        data: { ...testConsents, username: "yandex-e" + n + "-" + run },
      }),
    ),
  );
  assert.deepEqual(twice.map((r) => r.status).sort(), [201, 410]);

  // ── Linking and unlinking ───────────────────────────────────────────
  const idP = "9000" + run;
  const p = owner;
  const link = (b, data, origin) =>
    b("/api/account/identities/yandex/link", { method: "POST", data, origin });
  assert.equal((await link(browser(), { password })).status, 401);
  assert.equal((await link(p, { password }, "https://evil.test")).status, 403);
  assert.equal((await link(p, { password: "wrong-password-123" })).status, 403);
  const linking = await link(p, { password });
  assert.equal(linking.status, 200);
  const linkUrl = new URL(linking.body.url);
  assert.equal(
    linkUrl.origin + linkUrl.pathname,
    "https://oauth.yandex.ru/authorize",
  );
  const linkFlow = {
    state: linkUrl.searchParams.get("state"),
    challenge: linkUrl.searchParams.get("code_challenge"),
  };
  // The flow belongs to this session: a fresh login in between ends it.
  const stale = browser();
  assert.equal(
    (
      await stale("/api/auth/login", {
        method: "POST",
        data: { email: password_user, password },
      })
    ).status,
    200,
  );
  assert.equal(
    (await callback(stale, linkFlow, account(idP))).location,
    base + "/login?identity=state",
    "another browser cannot finish it",
  );
  const relinked = await link(p, { password });
  const relinkFlow = {
    state: new URL(relinked.body.url).searchParams.get("state"),
    challenge: new URL(relinked.body.url).searchParams.get("code_challenge"),
  };
  assert.equal((await p("/api/auth/logout", { method: "POST" })).status, 200);
  assert.equal(
    (
      await p("/api/auth/login", {
        method: "POST",
        data: { email: password_user, password },
      })
    ).status,
    200,
  );
  assert.equal(
    (await callback(p, relinkFlow, account(idP))).location,
    base + "/login?identity=session",
  );
  const third = await link(p, { password });
  const thirdFlow = {
    state: new URL(third.body.url).searchParams.get("state"),
    challenge: new URL(third.body.url).searchParams.get("code_challenge"),
  };
  assert.equal(
    (await callback(p, thirdFlow, account(idP))).location,
    base + "/account?tab=account&identity=linked",
  );
  const methods = await p("/api/account/identities");
  assert.equal(methods.body.hasPassword, true);
  assert.equal(methods.body.providers[0].linked, true);
  assert.equal((await link(p, { password })).status, 409, "already linked");
  // The linked Yandex account now signs in as this user.
  const viaYandex = browser();
  assert.equal(
    (await signIn(viaYandex, account(idP))).location,
    base + "/account",
  );
  assert.equal((await viaYandex("/api/me")).body.user.email, password_user);
  // Another user cannot take a linked Yandex account.
  const q = browser();
  const emailQ = `q-${run}@example.test`;
  assert.equal(
    (
      await q("/api/auth/register", {
        method: "POST",
        data: { ...testConsents, name: "Q", email: emailQ, password },
      })
    ).status,
    201,
  );
  const qLink = await link(q, { password });
  const qFlow = {
    state: new URL(qLink.body.url).searchParams.get("state"),
    challenge: new URL(qLink.body.url).searchParams.get("code_challenge"),
  };
  assert.equal(
    (await callback(q, qFlow, account(idP))).location,
    base + "/account?tab=account&identity=taken",
  );
  // Unlinking: same origin, password.
  const unlink = (b, data, origin) =>
    b("/api/account/identities/yandex", { method: "DELETE", data, origin });
  assert.equal(
    (await unlink(p, { password }, "https://evil.test")).status,
    403,
  );
  assert.equal(
    (await unlink(p, { password: "wrong-password-123" })).status,
    403,
  );
  assert.equal((await unlink(browser(), { password })).status, 401);
  assert.equal((await unlink(p, { password })).status, 200);
  assert.equal((await unlink(p, { password })).status, 404);
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE subject=$1", [idP]),
    0,
  );

  // ── The last method cannot be removed; password login of a hashless account ──
  const passwordless = await user(emailA);
  assert.equal(
    (
      await browser()("/api/auth/login", {
        method: "POST",
        data: { email: emailA, password },
      })
    ).status,
    401,
    "no password to match",
  );
  const noPassword = await unlink(a, { password });
  assert.equal(noPassword.status, 409);
  assert.equal(noPassword.body.code, "last_method");
  assert.equal(
    (
      await a("/api/account/password", {
        method: "POST",
        data: { currentPassword: password, password: password + "x" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await a("/api/account/delete", {
        method: "POST",
        data: { password, confirm: "УДАЛИТЬ" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await a("/api/me")).body.user.id,
    passwordless.id,
    "the refusals did not end the session",
  );
  // After a password is set (recovery does this in production) it can be unlinked.
  await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
    passwordless.id,
    await hashPassword(password),
  ]);
  assert.equal((await unlink(a, { password })).status, 200);
  assert.equal(
    (
      await browser()("/api/auth/login", {
        method: "POST",
        data: { email: emailA, password },
      })
    ).status,
    200,
  );

  // The mail with the verification link was captured for the provider-created account.
  const files = await readdir(process.env.MAIL_CAPTURE_DIR || ".").catch(
    () => [],
  );
  if (process.env.MAIL_CAPTURE_DIR) {
    const mails = await Promise.all(
      files.map((f) =>
        readFile(path.join(process.env.MAIL_CAPTURE_DIR, f), "utf8").then(
          JSON.parse,
          () => null,
        ),
      ),
    );
    assert.ok(
      mails.some((m) => m?.to === emailA && /verify-email#/.test(m.text)),
    );
  }
  console.log("PASS: Yandex ID sign-in, linking and refusals.");
} finally {
  await setRegistration(true).catch(() => {});
  await db.end();
}
