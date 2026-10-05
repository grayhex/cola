import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./db.ts";
import { CHAT_TYPE, streamUserId } from "./chat-config.ts";
import { stableUuid } from "./stable-uuid.ts";

// New messages of Stream conversations as pushes (#342). Stream calls a webhook
// for `message.new`; here the call is checked (HMAC of the raw body, our app),
// remembered once (X-Webhook-Id is the same for every retry) and turned, in the
// same transaction, into references in the push queue: a conversation, a message
// and an author, for each live device of each member who has said yes to push.
// Only then does the answer go: 2xx means "durable", and nothing is sent to a
// provider from here.
//
// What is not kept: the text, the attachments and the conversation. Before every
// send the conversation is asked again (chat-push-access.ts): the message may be
// gone, the person may have left, muted it or read it elsewhere.

/** The raw body is bounded; a conversation has up to eight members. */
export const CHAT_WEBHOOK_MAX_BYTES = 256 * 1024;
/** How long a message is worth a push. */
export const CHAT_PUSH_HOURS = 12;
/** More members than any conversation of ours has: a sign of a body that is not ours. */
const MAX_MEMBERS = 50;

const streamIdPattern = /^cola_([0-9a-f]{32})$/;
/** Our user id of a Stream user id, or null for anyone else. */
export function userIdOfStream(id: unknown): string | null {
  const match = typeof id === "string" ? streamIdPattern.exec(id) : null;
  if (!match) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A UUID made of a Stream message id: stable, so a message is one event everywhere. */
export function eventIdOfMessage(messageId: string) {
  return stableUuid("chat-message:" + messageId);
}

/** Stream signs the raw body with the API secret: HMAC-SHA256 in hex. */
export function chatWebhookSignatureOk(
  raw: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

const member = z.looseObject({
  user_id: z.string().optional(),
  user: z.looseObject({ id: z.string() }).optional(),
  notifications_muted: z.boolean().optional(),
  banned: z.boolean().optional(),
});
const messageEvent = z.looseObject({
  type: z.string(),
  cid: z.string(),
  channel_type: z.string(),
  message: z.looseObject({
    id: z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/),
    type: z.string().optional(),
    silent: z.boolean().optional(),
    skip_push: z.boolean().optional(),
    user: z.looseObject({ id: z.string() }).optional(),
  }),
  user: z.looseObject({ id: z.string() }).optional(),
  members: z.array(member).max(MAX_MEMBERS).optional(),
});

export interface ChatMessagePush {
  messageId: string;
  cid: string;
  authorId: string;
  recipients: string[];
}

/**
 * The part of a `message.new` event the queue needs, or null when it is not a
 * message to push: another event, another kind of channel, a system or ephemeral
 * message, one the sender asked not to push, or a body that is not ours.
 */
export function chatMessagePush(body: unknown): ChatMessagePush | null {
  const parsed = messageEvent.safeParse(body);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.type !== "message.new" || event.channel_type !== CHAT_TYPE)
    return null;
  if (
    !event.cid.startsWith(CHAT_TYPE + ":") ||
    !/^colabike:[A-Za-z0-9_-]{1,100}$/.test(event.cid)
  )
    return null;
  const { message } = event;
  if (message.skip_push || message.silent) return null;
  if (message.type && !["regular", "reply"].includes(message.type)) return null;
  const author = userIdOfStream((message.user ?? event.user)?.id);
  if (!author) return null;
  const recipients = new Set<string>();
  for (const item of event.members ?? []) {
    if (item.notifications_muted || item.banned) continue;
    const id = userIdOfStream(item.user_id ?? item.user?.id);
    if (id && id !== author) recipients.add(id);
  }
  if (!recipients.size) return null;
  return {
    messageId: message.id,
    cid: event.cid,
    authorId: author,
    recipients: [...recipients],
  };
}

/**
 * Records the webhook call and queues the message for the live devices of its
 * recipients. A repeated call (a retry, a replay) queues nothing again. Returns
 * how many deliveries were made and whether the call was new.
 */
export async function enqueueChatPush(
  q: Queryable,
  webhookId: string,
  push: ChatMessagePush,
  now = new Date(),
) {
  const first = await q.query(
    "INSERT INTO chat_webhooks(webhook_id,received_at) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [webhookId, now],
  );
  if (!first.rowCount) return { first: false, queued: 0 };
  // A newer message of a conversation replaces the older ones that have not
  // left yet: the phone shows the conversation once, with the latest.
  await q.query(
    `UPDATE push_deliveries SET status='skipped',error_code='superseded',finished_at=$3,lease_token=NULL,lease_until=NULL
     WHERE status='pending' AND chat_cid=$1 AND recipient_id=ANY($2::uuid[]) AND chat_message_id<>$4`,
    [push.cid, push.recipients, now, push.messageId],
  );
  const made = await q.query(
    `INSERT INTO push_deliveries(recipient_id,device_session_id,generation,available_at,expires_at,chat_message_id,chat_cid,chat_author_id)
     SELECT d.user_id,d.session_id,d.generation,$1::timestamptz,$1::timestamptz+make_interval(hours=>${CHAT_PUSH_HOURS}),$2,$3,$4
     FROM push_devices d
     JOIN sessions s ON s.id=d.session_id AND s.kind='device' AND s.expires_at>$1::timestamptz AND s.absolute_expires_at>$1::timestamptz
     JOIN users u ON u.id=d.user_id AND NOT u.blocked
     JOIN users a ON a.id=$4 AND NOT a.blocked
     JOIN notification_settings ns ON ns.user_id=d.user_id AND ns.push_enabled AND ns.push_enabled_at<=$1::timestamptz
     WHERE d.user_id=ANY($5::uuid[]) AND d.user_id<>$4 AND d.revoked_at IS NULL AND d.registered_at<=$1::timestamptz
     ON CONFLICT DO NOTHING`,
    [now, push.messageId, push.cid, push.authorId, push.recipients],
  );
  return { first: true, queued: made.rowCount ?? 0 };
}

/** Forgets the memory of old webhook ids; a retry of Stream never comes after minutes. */
export async function pruneChatWebhooks(q: Queryable, now = new Date()) {
  await q.query(
    "DELETE FROM chat_webhooks WHERE received_at<$1::timestamptz-interval '7 days'",
    [now],
  );
}

export { streamUserId };
