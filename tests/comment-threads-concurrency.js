import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createComment } from "../lib/comments.ts";

// Real PostgreSQL: reciprocal replies must reserve both recipients before the
// bike lock. Without that ordering, each transaction waits on the other's FK.
const clients = Array.from(
  { length: 3 },
  () =>
    new pg.Client({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 10000,
    }),
);
const [db, first, second] = clients;
const owner = "ffffffff" + randomUUID().slice(8),
  a = "00000000" + randomUUID().slice(8),
  b = "11111111" + randomUUID().slice(8),
  bike = randomUUID();
let release;
const held = new Promise((resolve) => {
  release = resolve;
});
let signal;
const locked = new Promise((resolve) => {
  signal = resolve;
});
const tasks = [];
async function tx(client, fn) {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
try {
  await Promise.all(clients.map((c) => c.connect()));
  for (const id of [owner, a, b])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Thread race','hash',$3)",
      [id, id + "@example.test", "thread-" + id.slice(9)],
    );
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Nested race',2026,'road',true)",
    [bike, owner],
  );
  const root = await tx(db, () =>
    createComment(db, bike, { id: owner }, { body: "A" }),
  );
  const left = await tx(db, () =>
    createComment(db, bike, { id: a }, { body: "B", parentId: root.id }),
  );
  const right = await tx(db, () =>
    createComment(db, bike, { id: b }, { body: "C", parentId: left.id }),
  );
  const one = tx(first, () =>
    createComment(
      {
        async query(sql, args) {
          const result = await first.query(sql, args);
          if (sql.startsWith("SELECT id FROM bikes WHERE")) {
            signal();
            await held;
          }
          return result;
        },
      },
      bike,
      { id: a },
      { body: "D", parentId: right.id },
    ),
  );
  tasks.push(one);
  one.catch(() => {});
  await Promise.race([
    locked,
    one.then(() => {
      throw new Error("Missing lock barrier");
    }),
  ]);
  const pid = (await second.query("SELECT pg_backend_pid() pid")).rows[0].pid;
  const two = tx(second, () =>
    createComment(second, bike, { id: b }, { body: "E", parentId: left.id }),
  );
  tasks.push(two);
  two.catch(() => {});
  let blocked = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    blocked = (
      await db.query("SELECT cardinality(pg_blocking_pids($1))>0 blocked", [
        pid,
      ])
    ).rows[0].blocked;
    if (blocked) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(blocked, "The two nested replies must overlap");
  release();
  const [oneResult, twoResult] = await Promise.all(tasks);
  for (const [id, parent] of [
    [oneResult.id, right.id],
    [twoResult.id, left.id],
  ])
    assert.equal(
      (await db.query("SELECT parent_id FROM bike_comments WHERE id=$1", [id]))
        .rows[0].parent_id,
      parent,
    );
  for (const [recipient, actor] of [
    [b, a],
    [a, b],
  ])
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE bike_id=$1 AND type='reply' AND recipient_id=$2 AND actor_id=$3",
          [bike, recipient, actor],
        )
      ).rows[0].n,
      1,
    );
  console.log(
    "Nested comment concurrency: reciprocal replies commit, keep immediate parents and deduplicate notifications.",
  );
} finally {
  release();
  await Promise.allSettled(tasks);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[owner, a, b]]);
  await Promise.all(clients.map((c) => c.end()));
}
