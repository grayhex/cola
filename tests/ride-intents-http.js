import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client(verified = true) {
  let cookie = "";
  return async (path, method = "GET", data, origin = base) => {
    const response = await (verified ? verifiedFetch : fetch)(
      base + "/api/" + path,
      {
        method,
        headers: { cookie, origin, "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
      },
    );
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  };
}
const owner = client(),
  reader = client(),
  guest = client(),
  unverified = client(false);
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const input = {
  requestId: randomUUID(),
  readiness: "ready",
  timeZone: "Europe/Moscow",
  windows: [{ startLocal: date + "T10:00", endLocal: date + "T15:00" }],
  passport: { area: { label: "HTTP intent park" }, purpose: "leisure" },
};
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const ids = [];
  for (const c of [owner, reader, unverified]) {
    const r = await c("auth/register", "POST", {
      ...testConsents,
      name: "Intent HTTP",
      email: randomUUID() + "@example.test",
      password: "intent-test-secret-123",
    });
    assert.equal(r.status, 201);
    ids.push(r.body.user.id);
  }
  assert.equal((await guest("ride-intents?scope=community")).status, 401);
  assert.equal(
    (await owner("ride-intents", "POST", input, "https://evil.test")).status,
    403,
  );
  assert.equal(
    (
      await unverified("ride-intents", "POST", {
        ...input,
        visibility: "community",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await unverified("ride-intents", "POST", {
        ...input,
        requestId: randomUUID(),
      })
    ).status,
    201,
  );
  const first = await owner("ride-intents", "POST", input);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const id = first.body.intent.id;
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal((await owner("ride-intents", "POST", input)).status, 200);
  assert.equal((await owner("ride-intents")).body.total, 1);
  assert.equal((await reader("ride-intents/" + id)).status, 404);
  assert.equal((await reader("ride-intents/" + id, "DELETE")).status, 404);
  const { requestId: _requestId, ...body } = input;
  void _requestId;
  for (const visibility of ["community", "private", "community"]) {
    assert.equal(
      (await owner("ride-intents/" + id, "PUT", { ...body, visibility }))
        .status,
      200,
    );
    const result = await reader("ride-intents/" + id);
    assert.equal(result.status, visibility === "community" ? 200 : 404);
    if (result.status === 200) {
      assert.equal(result.body.intent.allowSuggestions, undefined);
      assert.equal(result.body.intent.author.email, undefined);
    }
    assert.equal(
      (await reader("ride-intents?scope=community")).body.items.some(
        (i) => i.id === id,
      ),
      visibility === "community",
    );
  }
  assert.equal((await reader("ride-intents/" + id, "PUT", body)).status, 404);
  assert.equal(
    (
      await owner("ride-intents/preferences", "PUT", {
        passport: { pace: "sporty" },
        meetNewPeople: false,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await reader("ride-intents/preferences")).body.preferences,
    { passport: {} },
  );
  // Six concurrent creates leave exactly five active intentions including the existing one.
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () =>
      owner("ride-intents", "POST", { ...input, requestId: randomUUID() }),
    ),
  );
  assert.equal(concurrent.filter((r) => r.status === 201).length, 4);
  assert.equal(concurrent.filter((r) => r.status === 409).length, 2);
  await db.query(
    "UPDATE ride_intent_windows SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE intent_id=$1",
    [id],
  );
  assert.equal((await reader("ride-intents/" + id)).status, 404);
  assert.equal(
    (await owner("ride-intents/" + id)).body.intent.status,
    "expired",
  );
  const repeat = await owner("ride-intents", "POST", {
    ...input,
    requestId: randomUUID(),
    visibility: "community",
  });
  assert.equal(repeat.status, 201);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ids[0]]);
  assert.equal((await owner("ride-intents")).status, 401);
  assert.equal(
    (await reader("ride-intents/" + repeat.body.intent.id)).status,
    404,
  );
  assert.equal(
    (await reader("ride-intents?scope=community")).body.items.some(
      (i) => i.author.id === ids[0],
    ),
    false,
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [ids[0]]);
  assert.equal(
    (await owner("ride-intents/" + repeat.body.intent.id + "/cancel", "POST"))
      .status,
    200,
  );
  assert.equal(
    (await reader("ride-intents/" + repeat.body.intent.id)).status,
    404,
  );
  assert.equal((await owner("ride-intents/" + id, "DELETE")).status, 200);
  assert.equal((await owner("ride-intents", "POST", input)).status, 409);
  const html = await (await fetch(base + "/ride-intents")).text();
  assert.match(html, /noindex/);
  assert.ok(!html.includes("HTTP intent park"));
  assert.equal(
    (await fetch(base + "/api/social-preview/intent/" + id + "/image")).status,
    404,
  );
  const profile = (
    await db.query("SELECT preferences FROM users WHERE id=$1", [ids[0]])
  ).rows[0];
  assert.ok(!JSON.stringify(profile.preferences).includes("push"));
  await db.query("DELETE FROM users WHERE id=$1", [ids[0]]);
  assert.equal(
    (await reader("ride-intents/" + repeat.body.intent.id)).status,
    404,
  );
  console.log(
    "Ride intentions HTTP: auth, privacy, expiry, retries and concurrent active quota passed",
  );
} finally {
  await db.end();
}
