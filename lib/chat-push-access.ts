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
): ChatPushAccess {
  return {
    async check({ cid, messageId, recipientId }) {
      const client = provider();
      const person = streamUserId(recipientId);
      try {
        const { message } = await client.getMessage(messageId);
        if (!message || message.type === "deleted" || message.deleted_at)
          return "gone";
        const channels = await client.queryChannels(
          { cid },
          {},
          { state: true, message_limit: 0, limit: 1, user_id: person },
        );
        const state = channels[0]?.state;
        const found = state?.members?.[person];
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
