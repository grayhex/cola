import { db, transaction } from "../lib/db.ts";
import { chatCredentials } from "../lib/chat-config.ts";
import { syncChatJob } from "../lib/chat-lifecycle.ts";

async function batch() {
  if (!chatCredentials()) return;
  const { rows } = await db.query(
    "SELECT user_id,updated_at::text FROM chat_jobs WHERE next_attempt_at<=now() ORDER BY updated_at LIMIT 20",
  );
  for (const row of rows) {
    try {
      await transaction(async (q) => {
        // Same lock order as user triggers and token issuance.
        await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          row.user_id,
        ]);
        const job = (
          await q.query(
            "SELECT * FROM chat_jobs WHERE user_id=$1 AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",
            [row.user_id],
          )
        ).rows[0];
        if (!job) return;
        if (!(await syncChatJob(q, job)))
          await q.query(
            "UPDATE chat_jobs SET next_attempt_at=greatest(next_attempt_at,now()+interval '10 seconds') WHERE user_id=$1",
            [row.user_id],
          );
      });
    } catch {
      await db.query(
        "UPDATE chat_jobs SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,6)))::int) WHERE user_id=$1 AND updated_at=$2::timestamptz",
        [row.user_id, row.updated_at],
      );
      console.error(JSON.stringify({ event: "chat_sync_retry" }));
    }
  }
}
if (process.argv.includes("--once")) {
  await batch();
  await db.end();
} else {
  let stopped = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopped = true;
    });
  while (!stopped) {
    try {
      await batch();
    } catch {
      console.error(JSON.stringify({ event: "chat_sync_unavailable" }));
    }
    if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await db.end();
}
