import { db, type Queryable } from "./db.ts";
import { userIdOfStream } from "./chat-push.ts";
import { clubIdOfCid } from "./club-chat-id.ts";
import { streamUserId } from "./chat-config.ts";
import { chatProvider } from "./chat-provider.ts";

// Whether a message of a conversation may still be pushed to one person (#342),
// asked of Stream immediately before every attempt, because Stream, not this
// database, knows: the message may have been deleted, the person may have left
// the conversation, muted it, or read it on another device. A copy of that
// would be a second, stale source of truth. A failure of Stream itself is not
// an answer: it throws, and the queue tries again until the message is no
// longer worth sending, never sends unchecked.

export type ChatPushVerdict = "ok" | "gone" | "not_member" | "muted" | "read";

export interface ChatPushAccess {
  check(input: {
    cid: string;
    messageId: string;
    recipientId: string;
  }): Promise<ChatPushVerdict>;
}

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("status" in error && error.status === 404) ||
    ("response" in error &&
      typeof error.response === "object" &&
      error.response !== null &&
      "status" in error.response &&
      error.response.status === 404));

export function streamChatPushAccess(
  provider: () => ReturnType<typeof chatProvider> = chatProvider,
  q: Queryable = db,
): ChatPushAccess {
  return {
    async check({ cid, messageId, recipientId }) {
      const clubId = clubIdOfCid(cid);
      if (
        clubId &&
        !(
          await q.query(
            `SELECT 1 FROM club_memberships m JOIN clubs c ON c.id=m.club_id
         JOIN users u ON u.id=m.user_id LEFT JOIN users owner ON owner.id=c.owner_id
         WHERE c.id=$1 AND m.user_id=$2 AND m.state='active' AND NOT u.blocked
           AND u.email_verified_at IS NOT NULL AND c.archived_at IS NULL
           AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT owner.blocked)`,
            [clubId, recipientId],
          )
        ).rowCount
      )
        return "not_member";
      const client = provider();
      const person = streamUserId(recipientId);
      try {
        const { message } = await client.getMessage(messageId);
        if (
          !message ||
          (message.cid && message.cid !== cid) ||
          message.type === "deleted" ||
          message.deleted_at
        )
          return "gone";
        if (
          clubId &&
          !(
            await q.query(
              `SELECT 1 FROM club_memberships m JOIN users u ON u.id=m.user_id
           WHERE m.club_id=$1 AND m.user_id=$2 AND m.state='active'
             AND NOT u.blocked AND u.email_verified_at IS NOT NULL`,
              [clubId, userIdOfStream(message.user?.id)],
            )
          ).rowCount
        )
          return "gone";
        const channels = await client.queryChannels(
          { cid },
          {},
          { state: true, message_limit: 0, limit: 1, user_id: person },
        );
        const state = channels[0]?.state;
        const found =
          clubId && channels[0]
            ? (
                await channels[0].queryMembers(
                  { user_id: person },
                  {},
                  { limit: 1 },
                )
              ).members[0]
            : state?.members?.[person];
        if (!found || found.banned) return "not_member";
        if (found.notifications_muted) return "muted";
        const lastRead = state?.read?.[person]?.last_read;
        if (
          lastRead &&
          message.created_at &&
          new Date(lastRead) >= new Date(message.created_at)
        )
          return "read";
        return "ok";
      } catch (error) {
        if (isNotFound(error)) return "gone";
        throw error;
      }
    },
  };
}
