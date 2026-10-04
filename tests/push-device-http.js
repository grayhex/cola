// The push address of a phone (#342), through the real server and PostgreSQL:
// only the app's device session may bind one, the address is never shown or
// stored in the clear, the generation grows with a new address, a late request
// does not bring the past back, a logout ends the binding, and the budget is
// the person's own.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { errorSchema, pushDeviceSchema } from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "push-device-password-123";

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
async function member(label) {
  const email = `push-${label}-${run}@example.test`;
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
  await verifyCapturedEmail(email);
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "android" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  return {
    id: registered.body.user.id,
    sessionId: grant.body.session.id,
    token: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: {
          authorization: "Bearer " + grant.body.accessToken,
          ...(options.headers ?? {}),
        },
      }),
    cookie: (path, options = {}) =>
      http("/api/v1" + path, {
        origin: base,
        ...options,
        headers: { cookie, ...(options.headers ?? {}) },
      }),
  };
}
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}

try {
  const me = await member("me");
  const other = await member("other");
  const installation = randomUUID();
  const address = "rustore-address-" + randomUUID();
  const registration = (overrides = {}) => ({
    installationId: installation,
    provider: "rustore",
    projectId: "fixture-project",
    token: address,
    ...overrides,
  });
  const put = (user, body, options = {}) =>
    user.token("/me/push-device", { method: "PUT", body, ...options });

  // Nobody, and a browser, have no phone.
  assertError(
    await http("/api/v1/me/push-device", {
      method: "PUT",
      body: registration(),
    }),
    401,
    "unauthorized",
    "a guest",
  );
  assertError(
    await me.cookie("/me/push-device", { method: "PUT", body: registration() }),
    403,
    "forbidden",
    "a browser session",
  );
  assertError(
    await me.token("/me/push-device"),
    404,
    "not_found",
    "nothing yet",
  );

  // The first registration is the first generation, and says nothing of the address.
  const first = await put(me, registration());
  assert.equal(first.status, 200, first.text);
  const device = pushDeviceSchema.parse(first.body);
  assert.equal(device.generation, 1);
  assert.equal(device.projectId, "fixture-project");
  assert.ok(!first.text.includes(address), "the address is not echoed");
  assert.equal(first.headers.get("cache-control"), "no-store");
  const stored = (
    await db.query(
      "SELECT token_ciphertext,token_hash FROM push_devices WHERE session_id=$1",
      [me.sessionId],
    )
  ).rows[0];
  assert.ok(
    !stored.token_ciphertext.includes(address),
    "sealed in the database",
  );
  const read = await me.token("/me/push-device");
  assert.equal(read.status, 200);
  assert.equal(pushDeviceSchema.parse(read.body).generation, 1);

  // The same again changes nothing; a new address is the next generation.
  assert.equal((await put(me, registration())).body.generation, 1);
  const rotated = await put(me, registration({ token: address + "-2" }));
  assert.equal(rotated.body.generation, 2);

  // A request that holds an older generation does not bring it back.
  assertError(
    await put(
      me,
      registration({ token: address + "-3", expectedGeneration: 1 }),
    ),
    409,
    "conflict",
    "a late callback",
  );
  assert.equal((await me.token("/me/push-device")).body.generation, 2);

  // What the server does not allow, and what is not a registration.
  const project = await put(me, registration({ projectId: "someone-else" }));
  assertError(project, 400, "invalid_request", "a project that is not allowed");
  assert.equal(project.body.error.details[0].path, "projectId");
  assertError(
    await put(me, { ...registration(), endpoint: "https://evil.test" }),
    400,
    "invalid_request",
    "an endpoint of the client's choice",
  );
  assertError(
    await put(me, registration({ provider: "fcm" })),
    400,
    "invalid_request",
    "another provider",
  );
  assertError(
    await put(me, registration({ token: "" })),
    400,
    "invalid_request",
    "no address",
  );
  assertError(
    await put(me, registration({ installationId: "not-a-uuid" })),
    400,
    "invalid_request",
    "a bad install",
  );

  // Nobody else sees or moves it.
  assertError(
    await other.token("/me/push-device"),
    404,
    "not_found",
    "another person",
  );

  // Another account on the same phone takes the address; the first gets nothing.
  const taken = await put(other, registration({ token: address + "-2" }));
  assert.equal(taken.status, 200, taken.text);
  assert.equal(taken.body.generation, 1);
  assertError(
    await me.token("/me/push-device"),
    404,
    "not_found",
    "the previous holder",
  );

  // Revoking is idempotent; making it again is the next generation.
  assert.equal(
    (await me.token("/me/push-device", { method: "DELETE" })).status,
    204,
  );
  assert.equal(
    (await me.token("/me/push-device", { method: "DELETE" })).status,
    204,
  );
  const again = await put(me, registration({ token: address + "-4" }));
  assert.equal(again.body.generation, 3);

  // A logout ends the binding with the session.
  assert.equal(
    (await me.token("/auth/sessions/current", { method: "DELETE" })).status,
    204,
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM push_devices WHERE session_id=$1", [
        me.sessionId,
      ])
    ).rowCount,
    0,
  );

  // The budget is the person's own.
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await put(other, registration({ token: address + "-b" + i }))).status,
      200,
      "change " + (i + 1),
    );
  const spent = await put(other, registration({ token: address + "-over" }));
  assertError(spent, 429, "rate_limited", "31st change");
  assert.ok(Number(spent.headers.get("retry-after")) > 0);

  console.log(
    "Push device HTTP: device session only, sealed address, generations, late callbacks, takeover, revoke, logout and budget passed.",
  );
} finally {
  await db.end();
}
