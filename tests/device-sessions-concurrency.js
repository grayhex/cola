// Device sessions under real parallelism (#303): PostgreSQL only, because a
// single-connection database cannot interleave transactions. Checks that
// parallel refreshes with one token end in one live chain without a false
// theft alarm, and that parallel sign-ins never exceed the device limit.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { createDeviceSession } from "../lib/device-sessions.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
const run = randomUUID().slice(0, 8);
const password = "concurrent-test-password-123";
const device = { name: "Parallel phone", platform: "ios" };

const post = async (path, body, headers = {}) => {
  const response = await fetch(base + "/api/v1" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
};
const me = async (token) =>
  (
    await fetch(base + "/api/v1/me", {
      headers: { authorization: "Bearer " + token },
    })
  ).status;

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const email = `parallel-${run}@example.test`;
  const registered = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...testConsents,
      name: "Параллельный",
      email,
      password,
    }),
  });
  assert.equal(registered.status, 201);
  const userId = (await registered.json()).user.id;
  const first = (await post("/auth/sessions", { email, password, device }))
    .body;
  assert.ok(first.refreshToken);

  // Eight clients refresh with the same token at once.
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      post("/auth/sessions/refresh", { refreshToken: first.refreshToken }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    Array(8).fill(200),
    "no parallel retry is taken for theft: " +
      JSON.stringify(results.map((r) => r.body?.error)),
  );
  assert.equal(
    Number(
      (
        await pool.query("SELECT count(*) FROM sessions WHERE id=$1", [
          first.session.id,
        ])
      ).rows[0].count,
    ),
    1,
    "the session survives",
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM notifications WHERE recipient_id=$1 AND type='session_reuse'",
          [userId],
        )
      ).rows[0].count,
    ),
    0,
    "and nobody is alarmed",
  );
  const live = [];
  for (const { body } of results)
    if ((await me(body.accessToken)) === 200) live.push(body);
  assert.equal(live.length, 1, "exactly one chain stays valid");
  const again = await post("/auth/sessions/refresh", {
    refreshToken: live[0].refreshToken,
  });
  assert.equal(again.status, 200, "and it keeps working");

  // Parallel sign-ins never leave more than 20 devices (the user row is locked).
  const other = (
    await pool.query(
      "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'P','x',$3) RETURNING id",
      [randomUUID(), `limit-${run}@example.test`, "limit-" + run],
    )
  ).rows[0].id;
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      transaction((client) =>
        createDeviceSession(
          client,
          other,
          { ...device, name: "Phone " + i, appVersion: null },
          "test",
        ),
      ),
    ),
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM sessions WHERE user_id=$1 AND kind='device'",
          [other],
        )
      ).rows[0].count,
    ),
    20,
    "never more than the limit, however they interleave",
  );
  console.log(
    "PASS: device sessions: parallel refreshes keep one chain, parallel sign-ins respect the limit.",
  );
} finally {
  await pool.end();
}
