import type { Queryable } from "./db.ts";
import {
  ENVELOPE_MAX_BYTES,
  envelopeBytes,
  pushEnvelopeSchema,
  type PushEnvelope,
} from "./notification-envelope.ts";
import type { ExternalNotice } from "./notification-external.ts";
import { notificationCategoryOf } from "./notification-catalog.ts";
import { eventIdOfMessage } from "./chat-push.ts";

// What a phone is told (#342): the envelope of #341, made at the moment of the
// send from the notice as it is then. It carries identifiers, the kind of event
// and a short line, and nothing that opens anything: no address, no place, no
// track, no text of a comment or of a private message. About something private
// the line is neutral (`neutral: true`) and names nothing: the app asks the
// server for the content once access has been checked, so a lock screen does
// not say what a revoked invitation was about.

const neutralBody = "Откройте ColaBike, чтобы посмотреть детали";

const titles: Record<string, string> = {
  comment: "Комментарий к вашему велосипеду",
  reply: "Ответ на ваш комментарий",
  ride_comment: "Комментарий к вашей покатушке",
  ride_reply: "Ответ в обсуждении покатушки",
  journal_comment: "Комментарий к вашей публикации",
  journal_reply: "Ответ в обсуждении публикации",
  article_comment: "Комментарий к вашей статье",
  article_reply: "Ответ в обсуждении статьи",
  component_reply: "Ответ в обсуждении компонента",
  ride_invite: "Приглашение на покатушку",
  ride_changed: "Изменились договорённости покатушки",
  ride_cancelled: "Покатушка отменена",
  ride_response: "Участники обновили ответы",
  ride_reminder: "Напоминание о покатушке",
  plan_published: "Новая покатушка друга",
  intent_published: "Друг хочет покататься",
};
const subjects: Record<string, string> = {
  comment: "К велосипеду",
  reply: "К велосипеду",
  ride_comment: "К покатушке",
  ride_reply: "К покатушке",
  journal_comment: "К публикации",
  journal_reply: "К публикации",
  article_comment: "К статье",
  article_reply: "К статье",
  component_reply: "К компоненту",
};
const suffixes: Record<string, string> = {
  ride_changed: "проверьте условия и подтвердите участие заново",
  ride_reminder: "до выезда меньше суток",
};

const clip = (text: string, length: number) =>
  text.length <= length ? text : text.slice(0, length - 1).trimEnd() + "…";

/**
 * Whether the thing the notice is about may be named to anyone who looks at
 * the phone: public, not just visible to this person. What cannot be told is
 * neutral.
 */
export async function pushSubjectIsPublic(
  q: Queryable,
  target: { type: string; id: string | null },
) {
  if (!target.id) return false;
  const table =
    target.type === "ride"
      ? "rides"
      : target.type === "bike"
        ? "bikes"
        : target.type === "journal" || target.type === "article"
          ? "journal_entries"
          : null;
  if (!table) return false;
  const { rows } = await q.query<{ is_public: boolean }>(
    `SELECT is_public FROM ${table} WHERE id=$1`,
    [target.id],
  );
  return rows[0]?.is_public === true;
}

export interface PushEnvelopeInput {
  deliveryId: string;
  generation: number;
  notice: ExternalNotice;
  expiresAt: Date;
  neutral: boolean;
}

/** The envelope, or null when the event is not one a phone is told about. */
export function buildPushEnvelope(
  input: PushEnvelopeInput,
): PushEnvelope | null {
  const { notice } = input;
  const title = titles[notice.type];
  if (!title) return null;
  const name = "name" in notice.target ? notice.target.name : "";
  const subject = subjects[notice.type];
  const suffix = suffixes[notice.type];
  const quoted = name ? `«${clip(name, 100)}»` : "";
  const body = input.neutral
    ? neutralBody
    : subject
      ? quoted
        ? `${subject} ${quoted}`
        : null
      : quoted
        ? suffix
          ? `${quoted}: ${suffix}`
          : quoted
        : null;
  const target = notice.target;
  const identifier = "id" in target && target.id ? String(target.id) : null;
  const envelope: PushEnvelope = {
    v: 1,
    deliveryId: input.deliveryId,
    eventId: notice.id,
    bindingGeneration: input.generation,
    category: notificationCategoryOf(
      notice.type.replace(/^article_/, "journal_"),
    ),
    type: notice.type,
    createdAt: new Date(notice.createdAt).toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    neutral: input.neutral,
    title,
    body: body === null ? null : clip(body, 160),
    group: clip(`${target.type}:${identifier ?? notice.id}`, 80),
    target: {
      type: target.type,
      id: identifier,
      commentId: target.commentId ?? null,
      occurrenceAt: target.occurrenceAt
        ? new Date(target.occurrenceAt).toISOString()
        : null,
      agreementRevision: target.agreementRevision ?? null,
    },
  };
  const checked = pushEnvelopeSchema.safeParse(envelope);
  if (!checked.success || envelopeBytes(checked.data) > ENVELOPE_MAX_BYTES)
    return null;
  return checked.data;
}

export interface ChatPushEnvelopeInput {
  deliveryId: string;
  generation: number;
  messageId: string;
  cid: string;
  authorName: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * The envelope of a new message of a conversation: who wrote and where, never
 * what. The conversation is the stack (a newer message replaces the older one)
 * and the target (`ref` is its cid); the event is the message, not a row of the
 * bell, so the app does not mark anything read on the server (Stream keeps
 * what is unread).
 */
export function buildChatPushEnvelope(
  input: ChatPushEnvelopeInput,
): PushEnvelope | null {
  const author = input.authorName.trim();
  const envelope: PushEnvelope = {
    v: 1,
    deliveryId: input.deliveryId,
    eventId: eventIdOfMessage(input.messageId),
    bindingGeneration: input.generation,
    category: "chat",
    type: "chat_message",
    createdAt: input.createdAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    neutral: false,
    title: "Новое сообщение",
    body: author ? clip(`От: ${clip(author, 100)}`, 160) : null,
    group: clip(`chat:${input.cid}`, 80),
    target: {
      type: "chat",
      id: null,
      commentId: null,
      occurrenceAt: null,
      agreementRevision: null,
      ref: input.cid,
    },
  };
  const checked = pushEnvelopeSchema.safeParse(envelope);
  if (!checked.success || envelopeBytes(checked.data) > ENVELOPE_MAX_BYTES)
    return null;
  return checked.data;
}
