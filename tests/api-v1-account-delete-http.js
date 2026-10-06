// API v1, deleting one's own account (#354), through the real server,
// PostgreSQL and the fixture provider: the confirmation that a phone can give
// (the password, or a fresh sign-in with Yandex for an account that has none),
// what is refused, and that after it nothing of the account is left.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "./fixtures/legal.js";
import {
  accountDeletionSchema,
  bikeSchema,
  errorSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const appLink = "https://colabike.ru/app/auth";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "account-delete-password-123";
const word = "УДАЛИТЬ";
const device = { name: "Телефон " + run, platform: "ios" };
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (value) =>
  createHash("sha256").update(value).digest("base64url");

async function http(
  path,
  { method = "GET", headers = {}, body, origin, raw } = {},
) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
    location: response.headers.get("location"),
  };
}
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const key = () => ({ "Idempotency-Key": randomUUID() });
const count = async (sql, values = []) =>
  Number((await db.query(sql, values)).rows[0].count);

function actor(token, cookie = "") {
  const call = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(cookie ? { cookie } : {}),
        ...(options.headers ?? {}),
      },
    });
  return call;
}
async function passwordMember(label) {
  const email = `account-delete-${label}-${run}@example.test`;
  let cookie = "";
  const registered = await http("/api/auth/register", {
    method: "POST",
    origin: base,
    body: { ...testConsents, name: "Райдер " + label, email, password },
  });
  assert.equal(registered.status, 201, registered.text);
  cookie = registered.headers.get("set-cookie").split(";")[0];
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: { email, password, device },
  });
  assert.equal(grant.status, 201, grant.text);
  return {
    id: registered.body.user.id,
    email,
    call: actor(grant.body.accessToken),
    withCookie: (path, options = {}) =>
      http("/api/v1" + path, {
        origin: base,
        ...options,
        headers: { cookie, ...(options.headers ?? {}) },
      }),
  };
}

// ── The fixture provider: the browser of the system, and the app's link ──────
function browser() {
  const jar = new Map();
  const call = async (url) => {
    const response = await fetch(base + url, {
      redirect: "manual",
      headers: {
        cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";").map((p) => p.trim());
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (!value || attributes.some((a) => /^max-age=0$/i.test(a)))
        jar.delete(name);
      else jar.set(name, value);
    }
    await response.text();
    return {
      status: response.status,
      location: response.headers.get("location"),
    };
  };
  return call;
}
/** The app signs in with Yandex: the code on its link and the secret it keeps. */
async function yandexCode(subject) {
  const b = browser();
  const secret = verifier();
  const started = await b(
    "/api/auth/native/start?" +
      new URLSearchParams({
        provider: "yandex",
        code_challenge: challengeOf(secret),
        code_challenge_method: "S256",
      }),
  );
  assert.equal(started.status, 303);
  const url = new URL(started.location);
  const flow = {
    state: url.searchParams.get("state"),
    challenge: url.searchParams.get("code_challenge"),
  };
  const returned = await b(
    "/api/auth/yandex/callback?" +
      new URLSearchParams({
        state: flow.state,
        code: encode({
          id: subject,
          name: "Райдер",
          challenge: flow.challenge,
        }),
      }),
  );
  assert.equal(returned.status, 303);
  const link = new URL(returned.location);
  assert.equal(link.origin + link.pathname, appLink, returned.location);
  const code = link.searchParams.get("code");
  assert.match(code, /^cola_ac_[A-Za-z0-9_-]{43}$/);
  return { code, secret };
}
async function yandexMember(label) {
  const subject = `${label}${run}`;
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,username) VALUES($1,$2,'Яндекс',$3)",
    [id, `ya-${subject}@example.test`, ("y" + subject).slice(0, 24)],
  );
  await db.query(
    "INSERT INTO user_identities(user_id,provider,subject) VALUES($1,'yandex',$2)",
    [id, subject],
  );
  const { code, secret } = await yandexCode(subject);
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: { code, codeVerifier: secret, device },
  });
  assert.equal(grant.status, 201, grant.text);
  return { id, subject, call: actor(grant.body.accessToken) };
}

try {
  // ── An account with a password ──────────────────────────────────────────
  const owner = await passwordMember("owner");
  const guest = (path, options = {}) => http("/api/v1" + path, options);
  const sure = { confirm: word, password };

  assertError(
    await guest("/account/delete", { method: "POST", body: sure }),
    401,
    "unauthorized",
    "no sign-in",
  );
  assertError(
    await guest("/account/deletion"),
    401,
    "unauthorized",
    "terms need a sign-in",
  );
  assertError(
    await owner.withCookie("/account/delete", {
      method: "POST",
      body: sure,
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "a cookie from a foreign origin",
  );
  const terms = await owner.call("/account/deletion");
  assert.equal(terms.status, 200, terms.text);
  assert.deepEqual(accountDeletionSchema.parse(terms.body), {
    method: "password",
    allowed: true,
    reason: null,
  });

  for (const [label, body] of [
    ["no word", { password }],
    ["another word", { confirm: "удалить", password }],
    ["no way to confirm", { confirm: word }],
    [
      "both ways",
      {
        confirm: word,
        password,
        reauth: {
          code: "cola_ac_" + "A".repeat(43),
          codeVerifier: "B".repeat(43),
        },
      },
    ],
    ["a field nobody listed", { confirm: word, password, force: true }],
  ]) {
    assertError(
      await owner.call("/account/delete", { method: "POST", body }),
      400,
      "invalid_request",
      label,
    );
  }
  assertError(
    await owner.call("/account/delete", {
      method: "POST",
      body: {
        confirm: word,
        reauth: {
          code: "cola_ac_" + "A".repeat(43),
          codeVerifier: "B".repeat(43),
        },
      },
    }),
    400,
    "invalid_request",
    "a password account is confirmed with its password",
  );
  assertError(
    await owner.call("/account/delete", {
      method: "POST",
      body: { confirm: word, password: "not-the-password-1" },
    }),
    401,
    "invalid_credentials",
    "a wrong password",
  );
  assert.equal(
    (await owner.call("/me")).status,
    200,
    "a refusal signs nobody out and deletes nothing",
  );
  assert.equal(
    await count("SELECT count(*) FROM users WHERE id=$1", [owner.id]),
    1,
  );

  // Something to be deleted: a bicycle with a photo, and the files of it.
  const bike = await owner.call("/bikes", {
    method: "POST",
    headers: key(),
    body: {
      name: "На удаление",
      brand: "Cube",
      model: "Stereo",
      year: 2024,
      classification: {
        category: "mtb",
        subtype: "trail",
        suspension: null,
        construction: null,
        uses: [],
        electric: false,
        fatbike: false,
      },
      isPublic: false,
    },
  });
  assert.equal(bike.status, 201, bike.text);
  const bikeId = bikeSchema.parse(bike.body).id;
  const picture = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#446688" },
  })
    .jpeg()
    .toBuffer();
  const uploaded = await uploadPhoto(owner, bikeId, picture);
  const file = join(process.env.UPLOAD_DIR, uploaded + ".webp");
  assert.ok(existsSync(file), "the photo is on disk");

  const deleted = await owner.call("/account/delete", {
    method: "POST",
    body: sure,
  });
  assert.equal(deleted.status, 204, deleted.text);
  assert.equal(deleted.text, "");
  assert.equal(deleted.headers.get("cache-control"), "no-store");
  for (const [label, sql] of [
    ["the person", "SELECT count(*) FROM users WHERE id=$1"],
    ["the bicycles", "SELECT count(*) FROM bikes WHERE owner_id=$1"],
    ["every session", "SELECT count(*) FROM sessions WHERE user_id=$1"],
  ])
    assert.equal(await count(sql, [owner.id]), 0, label + " are gone");
  assert.ok(!existsSync(file), "and so is the file");
  assertError(
    await owner.call("/me"),
    401,
    "invalid_token",
    "the token of a deleted account",
  );
  assertError(
    await owner.call("/account/delete", { method: "POST", body: sure }),
    401,
    "invalid_token",
    "a repeat is a refusal, not a second deletion",
  );
  const relogin = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: { email: owner.email, password, device },
  });
  assert.equal(relogin.status, 401, "the old credentials open nothing");
  assert.equal(
    (
      await http("/api/auth/login", {
        method: "POST",
        origin: base,
        body: { email: owner.email, password },
      })
    ).status,
    401,
    "nor does the site",
  );

  // ── The budget of attempts is the site's: five a window ───────────────────
  const tries = await passwordMember("tries");
  const results = [];
  for (let n = 0; n < 6; n++)
    results.push(
      await tries.call("/account/delete", {
        method: "POST",
        body: { confirm: word, password: "not-the-password-" + n },
      }),
    );
  assert.deepEqual(
    results.map((r) => r.status),
    [401, 401, 401, 401, 401, 429],
  );
  assert.ok(Number(results[5].headers.get("retry-after")) >= 1);
  assertError(results[5], 429, "rate_limited", "the sixth attempt");
  assert.equal(
    await count("SELECT count(*) FROM users WHERE id=$1", [tries.id]),
    1,
  );

  // ── An administrator keeps the account until the rights are handed on ─────
  const admin = await passwordMember("admin");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  assert.deepEqual(
    accountDeletionSchema.parse((await admin.call("/account/deletion")).body),
    {
      method: "password",
      allowed: false,
      reason: "admin",
    },
  );
  assertError(
    await admin.call("/account/delete", { method: "POST", body: sure }),
    409,
    "conflict",
    "an administrator",
  );
  assert.equal(
    await count("SELECT count(*) FROM users WHERE id=$1", [admin.id]),
    1,
  );

  // ── An account made through Yandex: no password, a fresh sign-in instead ──
  const rider = await yandexMember("rider");
  const other = await yandexMember("other");
  assert.deepEqual(
    accountDeletionSchema.parse((await rider.call("/account/deletion")).body),
    { method: "yandex", allowed: true, reason: null },
  );
  assertError(
    await rider.call("/account/delete", {
      method: "POST",
      body: { confirm: word, password },
    }),
    400,
    "invalid_request",
    "no password to confirm with",
  );
  assertError(
    await rider.call("/account/delete", {
      method: "POST",
      body: { confirm: word },
    }),
    400,
    "invalid_request",
    "a sign-in is needed",
  );
  // A wrong verifier spends the code: no second guess.
  const spent = await yandexCode(rider.subject);
  assertError(
    await rider.call("/account/delete", {
      method: "POST",
      body: {
        confirm: word,
        reauth: { code: spent.code, codeVerifier: verifier() },
      },
    }),
    401,
    "invalid_credentials",
    "a wrong verifier",
  );
  assertError(
    await rider.call("/account/delete", {
      method: "POST",
      body: {
        confirm: word,
        reauth: { code: spent.code, codeVerifier: spent.secret },
      },
    }),
    401,
    "invalid_credentials",
    "the code was spent by the attempt",
  );
  // The proof of somebody else is no proof.
  const foreign = await yandexCode(other.subject);
  assertError(
    await rider.call("/account/delete", {
      method: "POST",
      body: {
        confirm: word,
        reauth: { code: foreign.code, codeVerifier: foreign.secret },
      },
    }),
    401,
    "invalid_credentials",
    "another person's sign-in",
  );
  for (const id of [rider.id, other.id])
    assert.equal(
      await count("SELECT count(*) FROM users WHERE id=$1", [id]),
      1,
      "nothing was deleted by a refusal",
    );
  const fresh = await yandexCode(rider.subject);
  const gone = await rider.call("/account/delete", {
    method: "POST",
    body: {
      confirm: word,
      reauth: { code: fresh.code, codeVerifier: fresh.secret },
    },
  });
  assert.equal(gone.status, 204, gone.text);
  assert.equal(
    await count("SELECT count(*) FROM users WHERE id=$1", [rider.id]),
    0,
  );
  assert.equal(
    await count("SELECT count(*) FROM user_identities WHERE user_id=$1", [
      rider.id,
    ]),
    0,
    "the provider link goes with the account",
  );
  assertError(await rider.call("/me"), 401, "invalid_token", "its token");
  assert.equal(
    (await other.call("/me")).status,
    200,
    "another account is not touched",
  );

  console.log(
    "API v1 account delete HTTP: confirmation by password and by a fresh Yandex sign-in, refusals, the budget, the administrator and what is left passed.",
  );
} finally {
  await db.end();
}

async function uploadPhoto(member, bikeId, bytes) {
  const r = await member.call(`/bikes/${bikeId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", ...key() },
    raw: bytes,
  });
  assert.equal(r.status, 201, r.text);
  return r.body.id;
}
