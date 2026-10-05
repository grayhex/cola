// API v1, the private area of "rides near me" (#343), through the real server
// and PostgreSQL: a separate consent that is off by default, the coarse cell a
// phone must send, the versions two devices write on, the sources that do not
// overwrite each other, the operator's switch and what is forgotten.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { errorSchema, nearbySchema } from "../lib/api-v1/schemas.ts";
import { snapToCell } from "../lib/nearby.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "nearby-http-password-123";

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
async function member(label, verified = true) {
  const email = `nearby-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: "Райдер " + label,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  if (verified) await verifyCapturedEmail(email);
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const withToken = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  return {
    id: registered.body.user.id,
    web,
    bearer: "Bearer " + grant.body.accessToken,
    cookie: withCookie,
    token: withToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const area = (overrides = {}) => ({
  source: "manual",
  center: [37.6173, 55.7558],
  radiusM: 15000,
  label: "Сокольники",
  ...overrides,
});
const [cellLng, cellLat] = snapToCell(37.6173, 55.7558);
const cell = { source: "device", center: [cellLng, cellLat], radiusM: 10000 };

try {
  const me = await member("me");
  const other = await member("other");
  const phone = "/me/nearby";

  assertError(await guest(phone), 401, "unauthorized", "guest read");
  assertError(
    await guest(phone, { method: "PATCH", body: { enabled: true } }),
    401,
    "unauthorized",
    "guest write",
  );

  // Off by default, with a version even before the first save.
  const first = await me.token(phone);
  assert.equal(first.status, 200, first.text);
  nearbySchema.parse(first.body);
  assert.equal(first.body.enabled, false);
  assert.equal(first.body.available, true);
  assert.equal(first.body.area, null);
  assert.equal(first.body.limits.maxRadiusM, 50000);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const empty = first.headers.get("etag");
  assert.match(empty, /^"[A-Za-z0-9_-]{27}"$/);

  // The area needs the version that was read.
  assertError(
    await me.token(phone + "/area", { method: "PUT", body: area() }),
    428,
    "precondition_required",
    "no If-Match",
  );
  assertError(
    await me.token(phone + "/area", {
      method: "PUT",
      body: area(),
      headers: { "If-Match": '"nope"' },
    }),
    412,
    "precondition_failed",
    "a version nobody gave",
  );
  const saved = await me.token(phone + "/area", {
    method: "PUT",
    body: area(),
    headers: { "If-Match": empty },
  });
  assert.equal(saved.status, 200, saved.text);
  nearbySchema.parse(saved.body);
  assert.equal(saved.body.source, "manual");
  assert.deepEqual(saved.body.area.center, [cellLng, cellLat], "only the cell");
  assert.equal(saved.body.area.label, "Сокольники");
  assert.equal(saved.body.enabled, false, "an area is not a consent");
  assert.equal(saved.body.expiresAt, null);
  const etag = saved.headers.get("etag");
  assert.notEqual(etag, empty);
  assert.ok(!saved.text.includes("37.6173"), "the point sent is not echoed");
  const stored = await db.query(
    "SELECT area_lng::float8 lng,area_lat::float8 lat FROM nearby_areas WHERE user_id=$1",
    [me.id],
  );
  assert.deepEqual(
    [stored.rows[0].lng, stored.rows[0].lat],
    [cellLng, cellLat],
  );

  // The second device holds the old version.
  assertError(
    await me.token(phone + "/area", {
      method: "PUT",
      body: area({ radiusM: 20000 }),
      headers: { "If-Match": empty },
    }),
    412,
    "precondition_failed",
    "stale write",
  );

  // Body rules.
  for (const [label, body] of [
    ["an unknown field", { ...area(), userId: me.id }],
    ["a radius too small", area({ radiusM: 3000 })],
    ["a radius off the step", area({ radiusM: 15500 })],
    ["a radius over the operator's", area({ radiusM: 80000 })],
    ["no centre", { source: "manual", radiusM: 10000 }],
    ["a centre out of the world", area({ center: [400, 55] })],
    ["an unknown source", area({ source: "ip" })],
  ])
    assertError(
      await me.token(phone + "/area", {
        method: "PUT",
        body,
        headers: { "If-Match": etag },
      }),
      400,
      "invalid_request",
      label,
    );

  // A phone: the token of the app only, and the cell itself.
  assertError(
    await me.cookie(phone + "/area", {
      method: "PUT",
      body: { ...cell, replaceSource: true },
      headers: { "If-Match": etag },
    }),
    403,
    "forbidden",
    "a browser cannot say where the phone is",
  );
  const precise = await me.token(phone + "/area", {
    method: "PUT",
    body: {
      source: "device",
      center: [37.6173, 55.7558],
      radiusM: 10000,
      replaceSource: true,
    },
    headers: { "If-Match": etag },
  });
  assertError(precise, 400, "invalid_request", "a precise point from a phone");
  assert.ok(!precise.text.includes("37.6173"), "the refusal names no place");
  assert.equal(
    (await me.token(phone)).body.source,
    "manual",
    "and nothing changed",
  );
  assertError(
    await me.token(phone + "/area", {
      method: "PUT",
      body: cell,
      headers: { "If-Match": etag },
    }),
    409,
    "conflict",
    "the hand-picked area is not replaced behind the owner's back",
  );
  const viaPhone = await me.token(phone + "/area", {
    method: "PUT",
    body: { ...cell, replaceSource: true },
    headers: { "If-Match": etag },
  });
  assert.equal(viaPhone.status, 200, viaPhone.text);
  assert.equal(viaPhone.body.source, "device");
  assert.equal(viaPhone.body.area.label, null);
  assert.ok(viaPhone.body.expiresAt, "a phone's area has a term");
  const term =
    Date.parse(viaPhone.body.expiresAt) - Date.parse(viaPhone.body.observedAt);
  assert.equal(term, 24 * 3600_000);
  const deviceTag = viaPhone.headers.get("etag");

  // The switch is its own consent, the horizon and the preferences are its settings.
  const on = await me.token(phone, {
    method: "PATCH",
    body: {
      enabled: true,
      horizonDays: 7,
      filters: { purposes: ["social"], paces: [], surfaces: ["gravel"] },
    },
  });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.body.enabled, true);
  assert.equal(on.body.horizonDays, 7);
  assert.deepEqual(on.body.filters, {
    purposes: ["social"],
    paces: [],
    surfaces: ["gravel"],
  });
  assert.equal(on.body.source, "device", "the area stayed");
  assertError(
    await me.token(phone, {
      method: "PATCH",
      body: { enabled: false },
      headers: { "If-Match": deviceTag },
    }),
    412,
    "precondition_failed",
    "settings on a stale version when it is given",
  );
  for (const [label, body] of [
    ["an empty change", {}],
    ["a horizon too far", { horizonDays: 60 }],
    ["an unknown kind", { filters: { purposes: ["x"] } }],
    ["a field that is not a setting", { area: {} }],
  ])
    assertError(
      await me.token(phone, { method: "PATCH", body }),
      400,
      "invalid_request",
      label,
    );
  assertError(
    await me.cookie(phone, {
      method: "PATCH",
      body: { enabled: false },
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "foreign origin",
  );

  // Other people's areas are theirs.
  const mine = await other.token(phone);
  assert.equal(mine.body.area, null);
  assert.equal(mine.body.enabled, false);

  // The operator's switch.
  await db.query("UPDATE notification_limits SET nearby_enabled=false");
  try {
    const off = await me.token(phone);
    assert.equal(off.body.available, false);
    assertError(
      await me.token(phone, {
        method: "PATCH",
        body: { horizonDays: 5, enabled: true },
      }),
      503,
      "service_unavailable",
      "switch off",
    );
    assertError(
      await me.token(phone + "/area", {
        method: "PUT",
        body: area({ replaceSource: true }),
        headers: { "If-Match": off.headers.get("etag") },
      }),
      503,
      "service_unavailable",
      "no new areas",
    );
    assert.equal(
      (await me.token(phone, { method: "PATCH", body: { enabled: false } }))
        .status,
      200,
      "a person can always turn it off",
    );
  } finally {
    await db.query("UPDATE notification_limits SET nearby_enabled=true");
  }

  // Removing the area keeps the person's choices; forgetting keeps nothing.
  const removed = await me.token(phone + "/area", { method: "DELETE" });
  assert.equal(removed.status, 200, removed.text);
  assert.equal(removed.body.area, null);
  assert.equal(removed.body.source, null);
  assert.equal(removed.body.horizonDays, 7);
  assert.equal(
    (await me.token(phone + "/area", { method: "DELETE" })).status,
    200,
    "a repeat",
  );
  assert.equal((await me.token(phone, { method: "DELETE" })).status, 204);
  assert.equal(
    (await me.token(phone, { method: "DELETE" })).status,
    204,
    "a repeat",
  );
  const gone = await me.token(phone);
  assert.equal(gone.body.enabled, false);
  assert.equal(gone.body.horizonDays, 14);
  assert.equal(
    (await db.query("SELECT 1 FROM nearby_areas WHERE user_id=$1", [me.id]))
      .rowCount,
    0,
  );
  assert.equal((await guest(phone, { method: "POST", body: {} })).status, 405);

  // A cleanup of a phone's term needs no request.
  assert.equal(
    (
      await me.token(phone + "/area", {
        method: "PUT",
        body: cell,
        headers: { "If-Match": gone.headers.get("etag") },
      })
    ).status,
    200,
  );
  await db.query(
    "UPDATE nearby_areas SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [me.id],
  );
  const lapsed = await me.token(phone);
  assert.equal(lapsed.body.expired, true, "after the term it is not used");

  // The budget is the site's own window.
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const r = await other.token(phone, {
      method: "PATCH",
      body: { horizonDays: 5 + (i % 2) },
    });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, "a budget of changes");
  assertError(limited, 429, "rate_limited", "budget");

  console.log("API v1 nearby HTTP checks passed");
} finally {
  // The database is shared with the tests that follow: the areas this test set
  // would count in their audiences, so its people go with them.
  await db
    .query("DELETE FROM users WHERE email LIKE $1", [
      `nearby-%-${run}@example.test`,
    ])
    .catch(() => {});
  await db.end();
}
