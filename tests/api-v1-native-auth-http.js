// Native sign-in with Yandex ID (#304) through the real server, PostgreSQL and
// the fixture provider: the app's challenge, the redirects to the app's HTTPS
// link, first sign-in finished in the browser, and the exchange of the one-time
// code for device tokens at POST /api/v1/auth/sessions.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
// The production return path of the Android client.
const appLink = "https://colabike.ru/app/auth";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (value) =>
  createHash("sha256").update(value).digest("base64url");
const device = { name: "Телефон " + run, platform: "ios" };

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
      text,
      location: response.headers.get("location"),
      cookies: response.headers.getSetCookie(),
    };
  };
  call.jar = jar;
  return call;
}
async function exchange(body) {
  const response = await fetch(base + "/api/v1/auth/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}
// The app: a verifier of its own, the system browser, and the redirect it gets.
async function startApp(b, secret = verifier(), query = {}) {
  const params = new URLSearchParams({
    provider: "yandex",
    code_challenge: challengeOf(secret),
    code_challenge_method: "S256",
    ...query,
  });
  const r = await b("/api/auth/native/start?" + params);
  return { r, secret };
}
function toYandex(r) {
  assert.equal(r.status, 303, r.text);
  const url = new URL(r.location);
  assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
  return {
    state: url.searchParams.get("state"),
    challenge: url.searchParams.get("code_challenge"),
  };
}
const back = (r) => {
  assert.equal(r.status, 303, r.text);
  const url = new URL(r.location);
  assert.equal(url.origin + url.pathname, appLink, r.location);
  return url.searchParams;
};
const returnFromYandex = (b, flow, account, extra = {}) =>
  b(
    "/api/auth/yandex/callback?" +
      new URLSearchParams({
        state: flow.state,
        code: encode({ ...account, challenge: flow.challenge, ...extra }),
      }),
  );
const count = async (sql, values = []) =>
  Number((await db.query(sql, values)).rows[0].count);
const setRegistration = (open) =>
  db.query(
    `UPDATE site_settings SET value=jsonb_set(value,'{registrationOpen}',$1::jsonb) WHERE id=1`,
    [JSON.stringify(open)],
  );
async function linkedUser(subject, { blocked = false } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,username,blocked) VALUES($1,$2,'Связанный',$3,$4)",
    [id, `native-${subject}@example.test`, "n" + subject.slice(0, 20), blocked],
  );
  await db.query(
    "INSERT INTO user_identities(user_id,provider,subject) VALUES($1,'yandex',$2)",
    [id, subject],
  );
  return id;
}

try {
  // ── The start: parameters and the redirect to Yandex ──────────────────
  for (const [label, query] of [
    ["another provider", { provider: "vk" }],
    ["no challenge", { code_challenge: "" }],
    ["a short challenge", { code_challenge: "abc" }],
    ["a plain challenge method", { code_challenge_method: "plain" }],
  ]) {
    const refused = back((await startApp(browser(), undefined, query)).r);
    assert.equal(refused.get("error"), "invalid_request", label);
    assert.equal(refused.get("code"), null);
  }
  const b1 = browser();
  const { r: started, secret } = await startApp(b1);
  const flow = toYandex(started);
  assert.match(flow.state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(
    flow.challenge,
    challengeOf(secret),
    "the provider gets the server's PKCE, not the app's",
  );
  const row = (
    await db.query(
      "SELECT purpose,app_challenge FROM external_auth_flows WHERE purpose='native' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(
    row.app_challenge,
    challengeOf(secret),
    "only the challenge is stored",
  );
  assert.ok(!JSON.stringify(row).includes(secret));

  // ── A person who is already linked: a code on the app's link ──────────
  const subject = "n1" + run;
  const user = await linkedUser(subject);
  const cb = await returnFromYandex(b1, flow, { id: subject, name: "Райдер" });
  const params = back(cb);
  const code = params.get("code");
  assert.match(code, /^cola_ac_[A-Za-z0-9_-]{43}$/);
  assert.equal(params.get("error"), null);
  assert.ok(
    ![...b1.jar.keys()].includes("cola_session") &&
      !cb.cookies.some((c) => c.startsWith("cola_session=")),
    "no web session is opened in the system browser",
  );
  // The exchange.
  const wrong = await exchange({ code, codeVerifier: verifier(), device });
  assert.equal(wrong.status, 401, wrong.text);
  assert.equal(wrong.body.error.code, "invalid_credentials");
  const spent = await exchange({ code, codeVerifier: secret, device });
  assert.equal(spent.status, 401, "a wrong attempt spent the code");
  // Again, properly.
  const b2 = browser();
  const second = await startApp(b2);
  const code2 = back(
    await returnFromYandex(b2, toYandex(second.r), {
      id: subject,
      name: "Райдер",
    }),
  ).get("code");
  const granted = await exchange({
    code: code2,
    codeVerifier: second.secret,
    device,
  });
  assert.equal(granted.status, 201, granted.text);
  assert.match(granted.body.accessToken, /^cola_at_/);
  assert.match(granted.body.refreshToken, /^cola_rt_/);
  assert.equal(granted.body.session.deviceName, device.name);
  const me = await fetch(base + "/api/v1/me", {
    headers: { authorization: "Bearer " + granted.body.accessToken },
  });
  assert.equal((await me.json()).id, user);
  const reused = await exchange({
    code: code2,
    codeVerifier: second.secret,
    device,
  });
  assert.equal(reused.status, 401, "one use");
  assert.equal(reused.body.error.code, "invalid_credentials");
  assert.equal(
    await count("SELECT count(*) FROM native_auth_codes WHERE user_id=$1", [
      user,
    ]),
    0,
  );
  assert.equal(
    await count(
      "SELECT count(*) FROM sessions WHERE user_id=$1 AND kind='device'",
      [user],
    ),
    1,
    "only the good exchange made a session",
  );

  // Parallel exchanges of one code: exactly one wins.
  const b2b = browser();
  const race = await startApp(b2b);
  const raceCode = back(
    await returnFromYandex(b2b, toYandex(race.r), {
      id: subject,
      name: "Райдер",
    }),
  ).get("code");
  const racing = await Promise.all(
    Array.from({ length: 8 }, () =>
      exchange({ code: raceCode, codeVerifier: race.secret, device }),
    ),
  );
  assert.equal(racing.filter((r) => r.status === 201).length, 1, "one winner");
  assert.ok(racing.every((r) => [201, 401].includes(r.status)));

  // ── Bad requests to the exchange ──────────────────────────────────────
  const goodShape = {
    code: "cola_ac_" + "A".repeat(43),
    codeVerifier: "B".repeat(43),
  };
  const unknown = await exchange({ ...goodShape, device });
  assert.equal(
    unknown.status,
    401,
    "an unknown code looks like any other refusal",
  );
  for (const [label, body] of [
    [
      "both methods",
      { ...goodShape, email: "a@b.cd", password: "secret", device },
    ],
    ["half a code", { code: goodShape.code, device }],
    [
      "a malformed code",
      { code: "cola_ac_x", codeVerifier: goodShape.codeVerifier, device },
    ],
    [
      "a malformed verifier",
      { code: goodShape.code, codeVerifier: "short", device },
    ],
    ["no device", { ...goodShape }],
    ["nothing", { device }],
  ]) {
    const r = await exchange(body);
    assert.equal(r.status, 400, label + " " + r.text);
    assert.equal(r.body.error.code, "invalid_request", label);
  }

  // ── An expired code, and a person blocked after the redirect ──────────
  const b3 = browser();
  const third = await startApp(b3);
  const code3 = back(
    await returnFromYandex(b3, toYandex(third.r), {
      id: subject,
      name: "Райдер",
    }),
  ).get("code");
  await db.query(
    "UPDATE native_auth_codes SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [user],
  );
  assert.equal(
    (await exchange({ code: code3, codeVerifier: third.secret, device }))
      .status,
    401,
    "expired",
  );
  const b4 = browser();
  const fourth = await startApp(b4);
  const code4 = back(
    await returnFromYandex(b4, toYandex(fourth.r), {
      id: subject,
      name: "Райдер",
    }),
  ).get("code");
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [user]);
  assert.equal(
    (await exchange({ code: code4, codeVerifier: fourth.secret, device }))
      .status,
    401,
    "blocked since",
  );
  // A blocked person is refused at the redirect, on the app's link.
  const b5 = browser();
  const fifth = await startApp(b5);
  assert.equal(
    back(
      await returnFromYandex(b5, toYandex(fifth.r), {
        id: subject,
        name: "Райдер",
      }),
    ).get("error"),
    "blocked",
  );

  // ── Refusals at the provider go back to the app, with fixed codes ─────
  const b6 = browser();
  const sixth = toYandex((await startApp(b6)).r);
  assert.equal(
    back(
      await b6(
        "/api/auth/yandex/callback?" +
          new URLSearchParams({ state: sixth.state, error: "access_denied" }),
      ),
    ).get("error"),
    "cancelled",
  );
  const b7 = browser();
  const seventh = toYandex((await startApp(b7)).r);
  assert.equal(
    back(
      await returnFromYandex(
        b7,
        seventh,
        { id: "x" + run, name: "Икс" },
        { fail: true },
      ),
    ).get("error"),
    "provider_error",
  );
  // The state is single use and bound to the browser, as on the web.
  const stray = await returnFromYandex(browser(), seventh, {
    id: "x",
    name: "Икс",
  });
  assert.equal(stray.location, base + "/login?identity=state");

  // ── A first sign-in: finished in the browser, the code comes after ────
  const newSubject = "n2" + run;
  const newEmail = `native-new-${run}@example.test`;
  const b8 = browser();
  const eighth = await startApp(b8);
  const parked = await returnFromYandex(b8, toYandex(eighth.r), {
    id: newSubject,
    name: "Новый Райдер",
    email: newEmail,
  });
  assert.equal(
    parked.location,
    base + "/login/yandex",
    "username and documents come first",
  );
  assert.ok(parked.cookies.some((c) => c.startsWith("cola_oauth_signup=")));
  assert.equal(
    await count("SELECT count(*) FROM users WHERE email=$1", [newEmail]),
    0,
  );
  assert.equal(
    await count("SELECT count(*) FROM native_auth_codes"),
    0,
    "no code before the account exists",
  );
  assert.equal(
    (
      await b8("/api/auth/yandex/complete", {
        method: "POST",
        data: { ...testConsents },
        origin: "https://evil.test",
      })
    ).status,
    403,
  );
  const completed = await b8("/api/auth/yandex/complete", {
    method: "POST",
    data: { ...testConsents, username: "native-" + run },
  });
  assert.equal(completed.status, 201, completed.text);
  assert.ok(
    !completed.cookies.some((c) => c.startsWith("cola_session=")),
    "no web session for an app's sign-in",
  );
  const finish = new URL(completed.body.returnPath);
  assert.equal(finish.origin + finish.pathname, appLink);
  const newCode = finish.searchParams.get("code");
  assert.match(newCode, /^cola_ac_/);
  assert.equal(
    await count(
      "SELECT count(*) FROM user_identities WHERE provider='yandex' AND subject=$1",
      [newSubject],
    ),
    1,
  );
  assert.ok(
    (await count(
      "SELECT count(*) FROM user_legal_acceptances a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
      [newEmail],
    )) >= 2,
    "both documents were accepted, as in any registration",
  );
  const grantedNew = await exchange({
    code: newCode,
    codeVerifier: eighth.secret,
    device,
  });
  assert.equal(grantedNew.status, 201, grantedNew.text);
  const meNew = await fetch(base + "/api/v1/me", {
    headers: { authorization: "Bearer " + grantedNew.body.accessToken },
  });
  assert.equal((await meNew.json()).username, "native-" + run);

  // ── Registration closed and an address that already has an account ────
  await setRegistration(false);
  try {
    const b9 = browser();
    const ninth = await startApp(b9);
    assert.equal(
      back(
        await returnFromYandex(b9, toYandex(ninth.r), {
          id: "n3" + run,
          name: "Закрыто",
        }),
      ).get("error"),
      "registration_closed",
    );
    // …which never stops a person who is already linked.
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [user]);
    const b10 = browser();
    const tenth = await startApp(b10);
    assert.match(
      back(
        await returnFromYandex(b10, toYandex(tenth.r), {
          id: subject,
          name: "Райдер",
        }),
      ).get("code"),
      /^cola_ac_/,
    );
  } finally {
    await setRegistration(true);
  }
  const taken = `native-taken-${run}@example.test`;
  await db.query(
    "INSERT INTO users(id,email,name,username) VALUES($1,$2,'Занят',$3)",
    [randomUUID(), taken, "taken" + run],
  );
  const b11 = browser();
  const eleventh = await startApp(b11);
  assert.equal(
    back(
      await returnFromYandex(b11, toYandex(eleventh.r), {
        id: "n4" + run,
        name: "Двойник",
        email: taken,
      }),
    ).get("error"),
    "email_exists",
    "no automatic merge by address",
  );

  // ── Nothing of the web sign-in changed ────────────────────────────────
  const web = browser();
  const webStart = await web("/api/auth/yandex/start");
  assert.equal(webStart.status, 303);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM external_auth_flows WHERE purpose='login'",
      )
    ).rows[0].n >= 1,
    true,
  );

  // ── The App Link is ours: Digital Asset Links for the Android client ───
  // Public, JSON, no redirect, no cookie, no session, cacheable; the fixture
  // fingerprint of the test run, the applicationId of the client (#325).
  const links = await fetch(base + "/.well-known/assetlinks.json", {
    redirect: "manual",
  });
  assert.equal(links.status, 200);
  assert.match(links.headers.get("content-type") || "", /^application\/json/);
  assert.match(links.headers.get("cache-control") || "", /public/);
  assert.equal(links.headers.get("set-cookie"), null);
  assert.deepEqual(await links.json(), [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "ru.colabike.app",
        sha256_cert_fingerprints: [
          "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
        ],
      },
    },
  ]);
  // Only the file the system asks for, and only to read.
  assert.equal(
    (await fetch(base + "/.well-known/assetlinks.json", { method: "POST" }))
      .status,
    405,
  );
  assert.equal((await fetch(base + "/.well-known/other.json")).status, 404);

  console.log(
    "PASS: API v1 native sign-in: challenge, redirects to the app link, first sign-in, one-time code exchange, refusals and asset links.",
  );
} finally {
  await db.end();
}
