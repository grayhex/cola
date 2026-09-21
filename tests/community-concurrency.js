import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { vote } from "../lib/showcase.js";
import { createComment } from "../lib/comments.js";

// Requires real PostgreSQL: PGlite's single connection cannot expose this cycle.
const clients = Array.from(
  { length: 3 },
  () =>
    new pg.Client({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 10000,
    }),
);
const [admin, voter, commenter] = clients;
const owner = randomUUID(),
  actor = randomUUID(),
  bike = randomUUID();
let releaseVote;
const held = new Promise((resolve) => {
  releaseVote = resolve;
});
let voteLocked;
const locked = new Promise((resolve) => {
  voteLocked = resolve;
});
const tasks = [];
async function transaction(client, fn) {
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
  for (const id of [owner, actor])
    await admin.query(
      "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Concurrency','unused',$3)",
      [id, id + "@example.test", "race-" + id.slice(0, 20)],
    );
  await admin.query(
    "INSERT INTO bikes(id,owner_id,name,year,category,is_public,share_id) VALUES($1,$2,'Concurrent reactions',2026,'road',true,$3)",
    [bike, owner, randomUUID()],
  );
  const pid = (await commenter.query("SELECT pg_backend_pid() AS pid")).rows[0]
    .pid;
  const voting = transaction(voter, () =>
    vote(
      {
        async query(sql, args) {
          const result = await voter.query(sql, args);
          if (sql.includes("FOR UPDATE OF b")) {
            voteLocked();
            await held;
          }
          return result;
        },
      },
      bike,
      actor,
      true,
    ),
  );
  tasks.push(voting);
  // Attach rejection handlers immediately while orchestrating both transactions.
  voting.catch(() => {});
  await Promise.race([
    locked,
    voting.then(() => {
      throw new Error("Vote never locked the bike");
    }),
  ]);
  const commenting = transaction(commenter, () =>
    createComment(
      commenter,
      bike,
      { id: actor },
      { body: "A concurrent comment" },
    ),
  );
  tasks.push(commenting);
  commenting.catch(() => {});
  let blocked = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await admin.query(
      "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
      [pid],
    );
    if (result.rows[0].blocked) {
      blocked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(blocked, "The requests must overlap while the vote holds its locks");
  releaseVote();
  const [like, comment] = await Promise.all(tasks);
  assert.equal(like.liked, true);
  assert(comment.id);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM notifications WHERE recipient_id=$1 AND actor_id=$2",
        [owner, actor],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM bike_comments WHERE bike_id=$1",
        [bike],
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "Community concurrency: overlapping like/comment commit without deadlock and retain both notifications.",
  );
} finally {
  releaseVote();
  await Promise.allSettled(tasks);
  await admin.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner, actor],
  ]);
  await Promise.all(clients.map((c) => c.end()));
}
