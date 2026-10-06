import type { CurrentUser as CurrentUserType } from "./contracts.ts";
import type { ChatJobRow as ChatJobRowType } from "./database-rows.ts";
import type { Queryable } from "./db.ts";
import { chatProvider } from "./chat-provider.ts";
import { CHAT_ROLE, streamUserId } from "./chat-config.ts";

export function chatProfile(
  user: Pick<CurrentUserType, "id" | "name" | "avatar_id">,
  origin: string | undefined = process.env.APP_ORIGIN,
) {
  return {
    id: streamUserId(user.id),
    role: CHAT_ROLE,
    name: user.name,
    image:
      user.avatar_id && origin
        ? new URL("/api/avatars/" + user.avatar_id, origin).href
        : "",
  };
}
// Called inside a transaction. The user lock serializes tokens/DM creation with
// profile edits, blocking and deletion; the durable job survives user deletion.
export async function syncChatJob(
  q: Queryable,
  job: ChatJobRowType,
  provider = chatProvider(),
) {
  const id = streamUserId(job.user_id);
  if (job.kind === "delete") {
    if (job.task_id) {
      const result = await provider.getTask(job.task_id);
      if (result.status === "failed") {
        await q.query(
          "UPDATE chat_jobs SET task_id=NULL,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE user_id=$1",
          [job.user_id],
        );
        return false;
      }
      if (result.status !== "completed") return false;
    } else {
      const existing = await provider.queryUsers(
        { id },
        {},
        { include_deactivated_users: true },
      );
      if (!existing.users.length) {
        await q.query("DELETE FROM chat_jobs WHERE user_id=$1", [job.user_id]);
        return true;
      }
      await provider.revokeUserToken(id);
      await provider.deactivateUser(id);
      const result = await provider.deleteUser(id, {
        hard_delete: true,
        mark_messages_deleted: true,
        delete_conversation_channels: true,
      });
      if (result.task_id) {
        await q.query("UPDATE chat_jobs SET task_id=$2 WHERE user_id=$1", [
          job.user_id,
          result.task_id,
        ]);
        return false;
      }
    }
  } else {
    const user = (
      await q.query<{
        id: string;
        name: string;
        avatar_id: string;
        blocked: boolean;
      }>("SELECT id,name,avatar_id,blocked FROM users WHERE id=$1 FOR UPDATE", [
        job.user_id,
      ])
    ).rows[0];
    if (!user) return false; // A delete job will be committed by the deleting transaction.
    if (job.revoke_before) {
      // Revoke at processing time, including any token issued while this job
      // waited in the queue. Token issuance holds the same user lock.
      const revokedAt = new Date();
      await provider.revokeUserToken(id, revokedAt);
      await provider.deactivateUser(id); // Disconnect already open sockets too.
      await q.query(
        "UPDATE chat_identities SET revoked_at=$2 WHERE user_id=$1",
        [job.user_id, revokedAt],
      );
    }
    if (user.blocked) await provider.deactivateUser(id);
    else {
      const existing = await provider.queryUsers(
        { id },
        {},
        { include_deactivated_users: true },
      );
      if (existing.users[0]?.deactivated_at) await provider.reactivateUser(id);
      await provider.upsertUser(chatProfile(user));
    }
  }
  await q.query("DELETE FROM chat_jobs WHERE user_id=$1", [job.user_id]);
  return true;
}

/**
 * One person's block of another, as Stream keeps it (#354): the blocker stops
 * receiving the blocked person's messages in direct channels. Called inside a
 * transaction that holds the job row. When either of the two has no Stream
 * user (never was in chat, or already deleted) there is nothing to apply, and
 * the job is done: a direct message between them cannot be created while the
 * block stands, so no channel can appear later.
 */
export async function syncChatBlockJob(
  q: Queryable,
  job: { blocker_id: string; blocked_id: string; op: "block" | "unblock" },
  provider = chatProvider(),
) {
  const blocker = streamUserId(job.blocker_id),
    blocked = streamUserId(job.blocked_id);
  const present = await Promise.all(
    [blocker, blocked].map(async (id) => {
      const found = await provider.queryUsers(
        { id },
        {},
        { include_deactivated_users: true },
      );
      return found.users.length > 0;
    }),
  );
  if (present.every(Boolean)) {
    if (job.op === "block") await provider.blockUser(blocked, blocker);
    else await provider.unBlockUser(blocked, blocker);
  }
  await q.query(
    "DELETE FROM chat_block_jobs WHERE blocker_id=$1 AND blocked_id=$2",
    [job.blocker_id, job.blocked_id],
  );
}
