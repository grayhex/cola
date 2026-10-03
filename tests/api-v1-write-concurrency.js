// Idempotent creation under real parallelism (#305): PostgreSQL only, because a
// single-connection database cannot interleave transactions. Simultaneous
// requests with one key create one object and the rest replay its answer; a
// different body under that key is a conflict, never a second object.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { idempotent } from "../lib/api-v1/idempotency.ts";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
const run = randomUUID().replaceAll("-", "").slice(0, 10);
const table = "idem_made_" + run;

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
const create = (title) => async (q) => {
  const id = randomUUID();
  // A slow creation widens the window in which the others arrive.
  await q.query(`INSERT INTO ${table}(id,title) VALUES($1,$2)`, [id, title]);
  await q.query("SELECT pg_sleep(0.15)");
  return { status: 201, body: { id, title } };
};

try {
  await pool.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY, title text)`);
  const user = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Параллельный','hash',$3)",
    [user, `idem-${run}@example.test`, "idem" + run],
  );
  const route = "POST /api/v1/things";

  // 1. The same key and body, fifteen at once.
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      idempotent(
        transaction,
        { userId: user, route, key, body: { title: "один" } },
        create("один"),
      ),
    ),
  );
  const ids = new Set(results.map((r) => r.response.body.id));
  assert.equal(ids.size, 1, "one answer for everyone");
  assert.equal(results.filter((r) => !r.replayed).length, 1, "one real run");
  assert.equal(
    (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
    1,
    "one object",
  );

  // 2. The same key with different bodies: one wins, the others conflict.
  const other = randomUUID();
  const mixed = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      idempotent(
        transaction,
        { userId: user, route, key: other, body: { title: "тело " + (i % 2) } },
        create("тело " + (i % 2)),
      ),
    ),
  );
  const won = mixed.filter(
    (r) => r.status === "fulfilled" && !r.value.replayed,
  );
  assert.equal(won.length, 1, "exactly one run");
  for (const r of mixed)
    if (r.status === "rejected") assert.equal(r.reason.code, "conflict");
  assert.equal(
    (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
    2,
    "one more object, not ten",
  );

  // 3. A failing first request releases the key for the next one.
  const failing = randomUUID();
  const attempts = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      idempotent(
        transaction,
        { userId: user, route, key: failing, body: { n: 1 } },
        async (q) => {
          if (i === 0) throw new Error("first one fails");
          return create("после сбоя")(q);
        },
      ),
    ),
  );
  assert.ok(
    attempts.some((r) => r.status === "fulfilled"),
    "the key was released",
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int n FROM ${table} WHERE title='после сбоя'`,
      )
    ).rows[0].n,
    1,
    "the others still made one object",
  );
  console.log(
    "PASS: API v1 idempotency: parallel requests make one object and replay one answer.",
  );
} finally {
  await pool.query(`DROP TABLE IF EXISTS ${table}`);
  await pool.end();
}
