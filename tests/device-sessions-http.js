// Device sessions of API v1 (#303, ADR in #156) through the real server and
// database: sign-in, Bearer, refresh rotation, replay detection, revocation by
// every path that ends a browser session, limits and the browser flow unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import {
  sessionGrantSchema,
  sessionListSchema,
  errorSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "device-test-password-123";
const device = { name: "Pixel Анны", platform: "android", appVersion: "2.0.1" };

// A raw request: nothing is added unless the test asks for it.
async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
const v1 = (path, options = {}) => http("/api/v1" + path, options);
const bearer = (token) => ({ authorization: "Bearer " + token });
const expectError = (response, status, code, label) => {
  assert.equal(response.status, status, label + ": " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label + ": " + response.text);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response;
};
const challenge = (response) => response.headers.get("www-authenticate");

// The web: a cookie jar of one cookie, like the other HTTP tests.
function web() {
  let cookie = "";
  const call = async (path, { method = "GET", body, origin = base } = {}) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  call.cookie = () => cookie;
  return call;
}
async function account(label) {
  const email = `device-${label}-${run}@example.test`;
  const browser = web();
  const registered = await browser("/auth/register", {
    method: "POST",
    body: { ...testConsents, name: "Райдер " + label, email, password },
  });
  assert.equal(registered.status, 201, registered.text);
  return { email, browser, id: registered.body.user.id };
}
const signIn = async (who, info = device, extra = {}) => {
  const response = await v1("/auth/sessions", {
    method: "POST",
    body: { email: who.email, password, device: info, ...extra },
  });
  assert.equal(response.status, 201, response.text);
  return response.body;
};
const count = async (sql, values = []) =>
  Number((await db.query(sql, values)).rows[0].count);
const sessionsOf = (id) =>
  count("SELECT count(*) FROM sessions WHERE user_id=$1 AND kind='device'", [
    id,
  ]);

try {
  const owner = await account("owner");
  const other = await account("other");

  // ── Sign-in ───────────────────────────────────────────────────────────
  const bad = (body, label, status = 400) =>
    v1("/auth/sessions", { method: "POST", body }).then((r) =>
      expectError(
        r,
        status,
        status === 400 ? "invalid_request" : "invalid_credentials",
        label,
      ),
    );
  await bad({ email: owner.email, password }, "no device");
  await bad(
    {
      email: owner.email,
      password,
      device: { ...device, platform: "windows" },
    },
    "unknown platform",
  );
  await bad(
    { email: owner.email, password, device: { ...device, name: "" } },
    "empty device name",
  );
  await bad(
    { email: owner.email, password, device, admin: true },
    "unknown field",
  );
  const text = await fetch(base + "/api/v1/auth/sessions", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(text.status, 400, "a body that is not JSON");
  const wrong = await bad(
    { email: owner.email, password: "wrong-password-123", device },
    "wrong password",
    401,
  );
  const unknown = await bad(
    { email: `nobody-${run}@example.test`, password, device },
    "unknown address",
    401,
  );
  assert.equal(
    wrong.body.error.message,
    unknown.body.error.message,
    "an unknown address and a wrong password look the same",
  );
  assert.equal(await sessionsOf(owner.id), 0, "refusals created no session");

  const granted = await signIn(owner);
  assert.deepEqual(sessionGrantSchema.parse(granted), granted);
  assert.match(granted.accessToken, /^cola_at_[A-Za-z0-9_-]{43}$/);
  assert.match(granted.refreshToken, /^cola_rt_[A-Za-z0-9_-]{43}$/);
  assert.equal(granted.user.id, owner.id);
  assert.equal(granted.session.kind, "device");
  assert.equal(granted.session.deviceName, device.name);
  assert.equal(granted.session.current, true);
  assert.ok(
    !("passwordHash" in granted.user) &&
      !JSON.stringify(granted).includes("password_hash"),
  );
  const lifetime =
    (Date.parse(granted.accessTokenExpiresAt) - Date.now()) / 60000;
  assert.ok(lifetime > 14 && lifetime <= 15, "access token lives 15 minutes");
  const idle =
    (Date.parse(granted.refreshTokenExpiresAt) - Date.now()) / 86400000;
  assert.ok(idle > 59 && idle <= 60, "refresh idles 60 days");
  const row = (
    await db.query("SELECT * FROM sessions WHERE id=$1", [granted.session.id])
  ).rows[0];
  assert.equal(
    Math.round((row.absolute_expires_at - row.created_at) / 86400000),
    180,
  );
  assert.ok(
    !JSON.stringify(row).includes(granted.accessToken) &&
      !JSON.stringify(row).includes(granted.refreshToken),
    "digests only",
  );

  const me = await v1("/me", { headers: bearer(granted.accessToken) });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.id, owner.id);
  const bikes = await v1("/bikes?scope=mine", {
    headers: bearer(granted.accessToken),
  });
  assert.equal(bikes.status, 200, "Bearer works on every v1 read");

  // Closed registration stops new people, not a person signing in.
  await db.query(
    `UPDATE site_settings SET value=jsonb_set(value,'{registrationOpen}','false') WHERE id=1`,
  );
  try {
    const closed = await signIn(owner, { ...device, name: "While closed" });
    assert.ok(closed.accessToken);
  } finally {
    await db.query(
      `UPDATE site_settings SET value=jsonb_set(value,'{registrationOpen}','true') WHERE id=1`,
    );
  }
  // A blocked account cannot sign in.
  const barred = await account("barred");
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  const refused = await v1("/auth/sessions", {
    method: "POST",
    body: { email: barred.email, password, device },
  });
  expectError(refused, 401, "invalid_credentials", "blocked");
  assert.equal(refused.body.error.message, wrong.body.error.message);

  // ── Which credential is accepted ──────────────────────────────────────
  expectError(
    await v1("/me", {
      headers: {
        ...bearer(granted.accessToken),
        cookie: owner.browser.cookie(),
      },
    }),
    400,
    "ambiguous_authentication",
    "cookie and Bearer together",
  );
  expectError(
    await v1("/me", {
      headers: { ...bearer(granted.accessToken), cookie: "cola_session=junk" },
    }),
    400,
    "ambiguous_authentication",
    "any session cookie with Bearer",
  );
  expectError(
    await v1("/me", {
      headers: { cookie: "cola_session=" + granted.accessToken },
    }),
    401,
    "unauthorized",
    "access token as cookie",
  );
  const webToken = owner.browser.cookie().split("=")[1];
  const cookieAsBearer = expectError(
    await v1("/me", { headers: bearer(webToken) }),
    401,
    "invalid_token",
    "cookie token as Bearer",
  );
  assert.match(challenge(cookieAsBearer), /^Bearer error="invalid_token"/);
  expectError(
    await v1("/me", { headers: bearer(granted.refreshToken) }),
    401,
    "invalid_token",
    "refresh as access",
  );
  expectError(
    await v1("/me", { headers: bearer("cola_at_" + "z".repeat(43)) }),
    401,
    "invalid_token",
    "unknown access token",
  );
  expectError(
    await v1("/me", { headers: bearer("junk") }),
    401,
    "invalid_token",
    "wrong format",
  );
  expectError(
    await v1("/bikes", { headers: bearer("junk") }),
    401,
    "invalid_token",
    "a public list is not served to a bad token as a guest",
  );
  expectError(
    await v1("/me", { headers: { authorization: "Basic Zm9vOmJhcg==" } }),
    401,
    "unsupported_authentication",
    "foreign scheme",
  );
  expectError(await v1("/me"), 401, "unauthorized", "no credentials");
  // The refresh token goes in a body only, to one route.
  expectError(
    await v1("/auth/sessions/refresh", {
      method: "POST",
      headers: bearer(granted.accessToken),
      body: {},
    }),
    400,
    "invalid_request",
    "refresh needs its body",
  );
  expectError(
    await v1("/auth/sessions/refresh?refreshToken=" + granted.refreshToken, {
      method: "POST",
      body: {},
    }),
    400,
    "invalid_request",
    "a token in the URL is not read",
  );

  // ── Expiry ────────────────────────────────────────────────────────────
  await db.query(
    "UPDATE sessions SET access_expires_at=now()-interval '1 second' WHERE id=$1",
    [granted.session.id],
  );
  const expired = expectError(
    await v1("/me", { headers: bearer(granted.accessToken) }),
    401,
    "token_expired",
    "expired access token",
  );
  assert.match(
    challenge(expired),
    /^Bearer error="invalid_token", error_description="The access token expired"/,
  );
  const refreshed = await v1("/auth/sessions/refresh", {
    method: "POST",
    body: { refreshToken: granted.refreshToken },
  });
  assert.equal(refreshed.status, 200, refreshed.text);
  assert.deepEqual(sessionGrantSchema.parse(refreshed.body), refreshed.body);
  const next = refreshed.body;
  assert.equal(next.session.id, granted.session.id, "the same session");
  assert.notEqual(next.accessToken, granted.accessToken);
  assert.notEqual(next.refreshToken, granted.refreshToken);
  expectError(
    await v1("/me", { headers: bearer(granted.accessToken) }),
    401,
    "invalid_token",
    "the replaced access token is dead",
  );
  assert.equal(
    (await v1("/me", { headers: bearer(next.accessToken) })).status,
    200,
  );
  for (const column of ["expires_at", "absolute_expires_at"]) {
    const doomed = await signIn(owner, { ...device, name: "Doomed " + column });
    await db.query(
      `UPDATE sessions SET ${column}=now()-interval '1 second' WHERE id=$1`,
      [doomed.session.id],
    );
    expectError(
      await v1("/me", { headers: bearer(doomed.accessToken) }),
      401,
      "invalid_token",
      column,
    );
    expectError(
      await v1("/auth/sessions/refresh", {
        method: "POST",
        body: { refreshToken: doomed.refreshToken },
      }),
      401,
      "invalid_token",
      "refresh after " + column,
    );
  }

  // ── Rotation, the lost response and replay ────────────────────────────
  // A chat identity makes any DELETE of a session queue a token revocation.
  await db.query(
    "INSERT INTO chat_identities(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [owner.id],
  );
  await db.query("DELETE FROM chat_jobs WHERE user_id=$1", [owner.id]);
  const rotate = (token) =>
    v1("/auth/sessions/refresh", {
      method: "POST",
      body: { refreshToken: token },
    });
  const a = next; // refresh token A0, access A0
  const b = (await rotate(a.refreshToken)).body; // the client "loses" this answer
  assert.equal(
    await count("SELECT count(*) FROM chat_jobs WHERE user_id=$1", [owner.id]),
    0,
    "a refresh does not revoke chat tokens",
  );
  const c = await rotate(a.refreshToken); // retry with the old token, within the grace period
  assert.equal(c.status, 200, "a lost response is tolerated: " + c.text);
  expectError(
    await v1("/me", { headers: bearer(b.accessToken) }),
    401,
    "invalid_token",
    "the unclaimed pair is revoked",
  );
  expectError(
    await rotate(b.refreshToken),
    401,
    "invalid_token",
    "and so is its refresh token",
  );
  assert.equal(
    (await v1("/me", { headers: bearer(c.body.accessToken) })).status,
    200,
    "the retried pair is the live one (and is now used)",
  );
  assert.equal(
    await count("SELECT count(*) FROM chat_jobs WHERE user_id=$1", [owner.id]),
    0,
  );
  // The client has used the new access token: replaying the old refresh is theft.
  const theft = expectError(
    await rotate(a.refreshToken),
    401,
    "invalid_token",
    "replay after the successor was used",
  );
  assert.ok(!theft.text.includes("reuse"), "the answer does not reveal why");
  expectError(
    await v1("/me", { headers: bearer(c.body.accessToken) }),
    401,
    "invalid_token",
    "the session ended",
  );
  assert.equal(
    await count("SELECT count(*) FROM sessions WHERE id=$1", [
      granted.session.id,
    ]),
    0,
  );
  assert.equal(
    await count("SELECT count(*) FROM chat_jobs WHERE user_id=$1", [owner.id]),
    1,
    "removal by theft does revoke chat tokens",
  );
  const notices = await owner.browser("/community/notifications");
  assert.equal(notices.status, 200, notices.text);
  assert.ok(
    notices.body.notifications.some(
      (n) => n.type === "session_reuse" && n.actor === null,
    ),
    "the owner is told",
  );
  assert.ok(!notices.text.includes("cola_"), "no token in a notice");

  // After the grace period a replay is theft even if nothing was used.
  const slow = await signIn(owner, { ...device, name: "Slow" });
  const slowNext = (await rotate(slow.refreshToken)).body;
  await db.query(
    "UPDATE sessions SET rotated_at=now()-interval '31 seconds' WHERE id=$1",
    [slow.session.id],
  );
  expectError(
    await rotate(slow.refreshToken),
    401,
    "invalid_token",
    "replay after the grace period",
  );
  expectError(
    await v1("/me", { headers: bearer(slowNext.accessToken) }),
    401,
    "invalid_token",
    "its successor is gone with the session",
  );
  // An older token than the previous one is simply unknown.
  const chain = await signIn(owner, { ...device, name: "Chain" });
  const one = (await rotate(chain.refreshToken)).body;
  const two = (await rotate(one.refreshToken)).body;
  expectError(
    await rotate(chain.refreshToken),
    401,
    "invalid_token",
    "two generations old",
  );
  assert.equal(
    (await v1("/me", { headers: bearer(two.accessToken) })).status,
    200,
    "an unknown token does not end the session",
  );

  // ── Listing and revoking ──────────────────────────────────────────────
  const phone = await signIn(owner, { name: "Телефон", platform: "ios" });
  const tablet = await signIn(owner, {
    name: "Планшет",
    platform: "other",
    appVersion: "9",
  });
  const listed = await v1("/auth/sessions", {
    headers: bearer(phone.accessToken),
  });
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(sessionListSchema.parse(listed.body), listed.body);
  assert.equal(
    listed.body.items[0].id,
    phone.session.id,
    "the current session comes first",
  );
  assert.equal(listed.body.items[0].current, true);
  assert.ok(
    listed.body.items.some(
      (s) =>
        s.id === tablet.session.id && s.deviceName === "Планшет" && !s.current,
    ),
  );
  assert.ok(
    listed.body.items.some((s) => s.kind === "browser"),
    "browsers are listed with devices",
  );
  assert.ok(!listed.text.includes("hash") && !listed.text.includes("cola_"));
  const legacy = await owner.browser("/account/sessions");
  assert.ok(
    legacy.body.sessions.some(
      (s) => s.kind === "device" && s.deviceName === "Телефон",
    ),
    "the web device list shows devices too",
  );
  expectError(
    await v1("/auth/sessions"),
    401,
    "unauthorized",
    "list needs a session",
  );
  // Revoke another device by id; another person's id is a 404.
  const strangerPhone = await signIn(other);
  expectError(
    await v1("/auth/sessions/" + strangerPhone.session.id, {
      method: "DELETE",
      headers: bearer(phone.accessToken),
    }),
    404,
    "not_found",
    "another person's session",
  );
  expectError(
    await v1("/auth/sessions/not-a-uuid", {
      method: "DELETE",
      headers: bearer(phone.accessToken),
    }),
    404,
    "not_found",
    "not an id",
  );
  assert.equal(
    (await v1("/me", { headers: bearer(strangerPhone.accessToken) })).status,
    200,
    "untouched",
  );
  const revoked = await v1("/auth/sessions/" + tablet.session.id, {
    method: "DELETE",
    headers: bearer(phone.accessToken),
  });
  assert.equal(revoked.status, 204);
  assert.equal(revoked.text, "");
  expectError(
    await v1("/me", { headers: bearer(tablet.accessToken) }),
    401,
    "invalid_token",
    "revoked from the list",
  );
  expectError(
    await rotate(tablet.refreshToken),
    401,
    "invalid_token",
    "its refresh token too",
  );
  // A cookie must prove its origin to change anything; a Bearer token need not.
  const webSession = (
    await owner.browser("/account/sessions")
  ).body.sessions.find(
    (s) => s.kind === "device" && s.deviceName === "Телефон",
  );
  const noOrigin = await v1("/auth/sessions/" + webSession.id, {
    method: "DELETE",
    headers: { cookie: owner.browser.cookie() },
  });
  expectError(noOrigin, 403, "forbidden", "cookie without Origin");
  expectError(
    await v1("/auth/sessions/" + webSession.id, {
      method: "DELETE",
      headers: { cookie: owner.browser.cookie() },
      origin: "https://evil.test",
    }),
    403,
    "forbidden",
    "cookie from another origin",
  );
  assert.equal(
    (await v1("/me", { headers: bearer(phone.accessToken) })).status,
    200,
    "still alive",
  );
  // Sign out on this device.
  const own = await signIn(owner, { name: "Own", platform: "ios" });
  assert.equal(
    (
      await v1("/auth/sessions/current", {
        method: "DELETE",
        headers: bearer(own.accessToken),
      })
    ).status,
    204,
  );
  expectError(
    await v1("/me", { headers: bearer(own.accessToken) }),
    401,
    "invalid_token",
    "signed out",
  );
  expectError(
    await rotate(own.refreshToken),
    401,
    "invalid_token",
    "refresh after sign out",
  );
  expectError(
    await v1("/auth/sessions/current", { method: "DELETE" }),
    401,
    "unauthorized",
    "sign out needs a session",
  );

  // ── Everything that ends a browser session ends a device ──────────────
  const who = await account("endings");
  const live = async (grant) =>
    (await v1("/me", { headers: bearer(grant.accessToken) })).status === 200;
  const g1 = await signIn(who);
  const g2 = await signIn(who, { ...device, name: "Second" });
  assert.equal(
    (await who.browser("/account/sessions", { method: "DELETE" })).status,
    200,
  );
  assert.equal(
    (await live(g1)) || (await live(g2)),
    false,
    "sign out everywhere",
  );
  // Sign out everywhere also ended the browser; sign in again for the next steps.
  assert.equal(
    (
      await who.browser("/auth/login", {
        method: "POST",
        body: { email: who.email, password },
      })
    ).status,
    200,
  );
  const g3 = await signIn(who);
  const g4 = await signIn(who, { ...device, name: "Fourth" });
  const changed = await who.browser("/account/password", {
    method: "POST",
    body: { currentPassword: password, password: password + "!" },
  });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(
    (await live(g3)) || (await live(g4)),
    false,
    "a new password ends every device",
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [who.id]);
  const g5 = await v1("/auth/sessions", {
    method: "POST",
    body: { email: who.email, password: password + "!", device },
  });
  expectError(g5, 401, "invalid_credentials", "blocked at sign-in");
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [who.id]);
  const g6 = (
    await v1("/auth/sessions", {
      method: "POST",
      body: { email: who.email, password: password + "!", device },
    })
  ).body;
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [who.id]);
  expectError(
    await v1("/me", { headers: bearer(g6.accessToken) }),
    401,
    "invalid_token",
    "blocking acts at once",
  );
  expectError(
    await rotate(g6.refreshToken),
    401,
    "invalid_token",
    "a blocked account cannot refresh",
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [who.id]);
  assert.equal(
    await live(g6),
    true,
    "unblocking restores a session that was not revoked",
  );
  const doomed = await account("deleted");
  const gd = await signIn(doomed);
  const deleted = await doomed.browser("/account/delete", {
    method: "POST",
    body: { password, confirm: "УДАЛИТЬ" },
  });
  assert.equal(deleted.status, 200, deleted.text);
  expectError(
    await v1("/me", { headers: bearer(gd.accessToken) }),
    401,
    "invalid_token",
    "account deleted",
  );
  assert.equal(
    await count("SELECT count(*) FROM sessions WHERE id=$1", [gd.session.id]),
    0,
  );

  // ── Limits ────────────────────────────────────────────────────────────
  const heavy = await account("heavy");
  // Sign-in is rate limited per address (15 per window), so most of the 19
  // earlier devices are seeded; the 20th and 21st sign in over HTTP.
  const seeded = [];
  for (let i = 0; i < 19; i++) {
    const id = randomUUID();
    seeded.push(id);
    await db.query(
      `INSERT INTO sessions(id,token_hash,user_id,expires_at,kind,device_name,platform,access_expires_at,refresh_hash,absolute_expires_at,last_seen_at)
       VALUES($1,$2,$3,now()+interval '30 days','device','Seeded '||$4::text,'ios',now()+interval '15 minutes',$5,now()+interval '100 days',now()-make_interval(mins=>$6))`,
      [
        id,
        randomUUID().replaceAll("-", "").repeat(2),
        heavy.id,
        i,
        randomUUID().replaceAll("-", "").repeat(2),
        i,
      ],
    );
  }
  const idlest = seeded[18]; // the oldest activity
  const twentieth = await signIn(heavy, { ...device, name: "Twentieth" });
  assert.equal(await sessionsOf(heavy.id), 20);
  const twentyFirst = await signIn(heavy, { ...device, name: "Twenty-first" });
  assert.equal(await sessionsOf(heavy.id), 20, "at most 20 devices");
  assert.equal(
    await count("SELECT count(*) FROM sessions WHERE id=$1", [idlest]),
    0,
    "the least recently used was signed out",
  );
  assert.equal(await live(twentieth), true);
  assert.equal(await live(twentyFirst), true, "the newest is kept");
  // Per-session refresh budget: 30 per window.
  const spin = twentyFirst;
  let token = spin.refreshToken;
  let last;
  for (let i = 0; i < 32; i++) {
    last = await rotate(token);
    if (last.status !== 200) break;
    token = last.body.refreshToken;
  }
  expectError(last, 429, "rate_limited", "refresh budget of one session");
  assert.equal(last.headers.get("retry-after"), "900");
  assert.equal(
    (await rotate(twentieth.refreshToken)).status,
    200,
    "another session has its own budget",
  );
  // Sign-in attempts share the web sign-in budget of the address.
  const target = `limit-${run}@example.test`;
  let status;
  for (let i = 0; i < 17; i++)
    status = (
      await v1("/auth/sessions", {
        method: "POST",
        body: { email: target, password: "wrong-password-123", device },
      })
    ).status;
  assert.equal(status, 429, "too many sign-in attempts");

  // ── The browser, unchanged ────────────────────────────────────────────
  const plain = await account("plain");
  assert.equal(
    (await v1("/me", { headers: { cookie: plain.browser.cookie() } })).status,
    200,
    "cookie on v1",
  );
  assert.equal(
    (await plain.browser("/me")).body.user.id,
    plain.id,
    "cookie on the web API",
  );
  const fresh = web();
  assert.equal(
    (
      await fresh("/auth/login", {
        method: "POST",
        body: { email: plain.email, password },
        origin: "https://evil.test",
      })
    ).status,
    403,
    "CSRF check on the browser flow",
  );
  assert.equal(
    (
      await fresh("/auth/login", {
        method: "POST",
        body: { email: plain.email, password },
      })
    ).status,
    200,
  );
  assert.equal((await fresh("/me")).body.user.id, plain.id);
  assert.equal(
    (await plain.browser("/auth/logout", { method: "POST" })).status,
    200,
  );
  // The device Bearer token never opens the web API (legacy /api is cookie only).
  const viaLegacy = await http("/api/me", {
    headers: bearer((await signIn(plain)).accessToken),
  });
  assert.equal(viaLegacy.body.user, null, "legacy API ignores Bearer");

  console.log(
    "PASS: device sessions: Bearer, rotation, replay detection, revocation, limits and the browser flow.",
  );
} finally {
  await db.end();
}
