import { db, transaction } from "../lib/db.ts";
import { chatCredentials } from "../lib/chat-config.ts";
import { syncChatBlockJob, syncChatJob } from "../lib/chat-lifecycle.ts";
import { syncClubChannel, syncClubRevocation } from "../lib/club-chat.ts";

async function clubs() {
  const revocations = (
    await db.query(
      "SELECT club_id,user_id,revision::text FROM club_chat_revocations WHERE next_attempt_at<=now() ORDER BY club_id,user_id LIMIT 40",
    )
  ).rows;
  for (const job of revocations) {
    try {
      await transaction((q) =>
        syncClubRevocation(q, job.club_id, job.user_id, job.revision),
      );
    } catch {
      await db.query(
        "UPDATE club_chat_revocations SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,6)))::int) WHERE club_id=$1 AND user_id=$2 AND revision=$3",
        [job.club_id, job.user_id, job.revision],
      );
      console.error(JSON.stringify({ event: "club_chat_revoke_retry" }));
    }
  }
  const jobs = (
    await db.query(
      "SELECT club_id,revision::text FROM club_chat_jobs WHERE next_attempt_at<=now() ORDER BY updated_at,club_id LIMIT 10",
    )
  ).rows;
  for (const job of jobs) {
    try {
      await transaction((q) => syncClubChannel(q, job.club_id));
    } catch {
      await db.query(
        "UPDATE club_chat_jobs SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,6)))::int) WHERE club_id=$1 AND revision=$2",
        [job.club_id, job.revision],
      );
      console.error(JSON.stringify({ event: "club_chat_sync_retry" }));
    }
  }
}

// The blocks of people in Stream (#354). The job row is locked for the whole
// call: a newer intention for the same pair waits for it and replaces it.
async function blocks() {
  const { rows } = await db.query(
    "SELECT blocker_id,blocked_id,updated_at::text FROM chat_block_jobs WHERE next_attempt_at<=now() ORDER BY updated_at LIMIT 20",
  );
  for (const row of rows) {
    try {
      await transaction(async (q) => {
        const job = (
          await q.query(
            "SELECT * FROM chat_block_jobs WHERE blocker_id=$1 AND blocked_id=$2 AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",
            [row.blocker_id, row.blocked_id],
          )
        ).rows[0];
        if (job) await syncChatBlockJob(q, job);
      });
    } catch {
      await db.query(
        "UPDATE chat_block_jobs SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,least(attempts,6)))::int) WHERE blocker_id=$1 AND blocked_id=$2 AND updated_at=$3::timestamptz",
        [row.blocker_id, row.blocked_id, row.updated_at],
      );
      console.error(JSON.stringify({ event: "chat_block_sync_retry" }));
    }
  }
}
async function batch() {
  if (!chatCredentials()) return;
  await blocks();
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
  await clubs();
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
