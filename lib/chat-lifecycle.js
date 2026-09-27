import { chatProvider } from "./chat-provider.js";
import { CHAT_ROLE, streamUserId } from "./chat-config.js";

export function chatProfile(user, origin = process.env.APP_ORIGIN) {
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
export async function syncChatJob(q, job, provider = chatProvider()) {
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
      await q.query(
        "SELECT id,name,avatar_id,blocked FROM users WHERE id=$1 FOR UPDATE",
        [job.user_id],
      )
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
