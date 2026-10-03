import { z } from "zod";
import { db, transaction } from "../db.ts";
import { chatConfig, streamUserId } from "../chat-config.ts";
import { chatProvider, ChatError } from "../chat-provider.ts";
import { createChatChannel, issueChatToken } from "../chat.ts";
import { chatPeople } from "../chat-people.ts";
import { EmailPolicyError, requireVerifiedEmail } from "../email-policy.ts";
import { sessionHashOf } from "../viewer-session.ts";
import { ApiError, detailsOf } from "./errors.ts";
import { idempotencyKey, idempotent } from "./idempotency.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  createChatChannelRequestSchema,
  parseChatPeopleQuery,
  parseNoQuery,
} from "./schemas.ts";
import { authenticate } from "./viewer.ts";
import { limited, limitedIn, requireOriginForCookie } from "./write.ts";

// The native bridge to Stream Chat (#324): the operations of the site's
// /api/chat for a client that holds a device session. The rules are the
// site's, from the same services: only a person with a confirmed e-mail, a
// blocked or unconfirmed person is never a member, the budgets are shared, and
// the application secret never leaves the server. What a vendor error says is
// not repeated (it can carry headers and keys): the client sees only that the
// service is unavailable.

/** Budgets per window; the same keys as the site, so both transports share them. */
export const chatLimits = { channels: 10, other: 100 };

function unavailable(message: string) {
  return new ApiError("service_unavailable", message, {
    headers: { "Retry-After": "60" },
  });
}

/**
 * Who is asking and the digest of the session they ask with (the token of a
 * device or the browser cookie), checked against a live session when a token
 * is issued. A change needs our Origin when it comes with a cookie.
 */
async function caller(req: Request, changes: boolean) {
  const { credential, viewer } = await authenticate(req.headers);
  if (changes) requireOriginForCookie(req, credential);
  if (!viewer || !credential)
    throw new ApiError("unauthorized", "Войдите в аккаунт.");
  if (!chatConfig()) throw unavailable("Сообщения пока отключены.");
  requireVerifiedEmail(viewer);
  return { viewer, hash: sessionHashOf(credential) };
}

function chatFailure(error: unknown): ApiError | null {
  if (error instanceof ApiError) return null;
  if (error instanceof ChatError) {
    if (error.status === 400)
      return new ApiError("invalid_request", error.message);
    if (error.status === 401)
      return new ApiError("unauthorized", error.message);
    if (error.status === 404) return new ApiError("not_found", error.message);
    return unavailable(error.message);
  }
  if (error instanceof z.ZodError)
    return new ApiError("invalid_request", "Проверьте поля запроса.", {
      details: detailsOf(error),
    });
  return null;
}

/** `safely`, where the chat services' own failures keep their meaning. */
function chatSafely(run: () => Promise<Response>) {
  return safely(async () => {
    try {
      return await run();
    } catch (error) {
      const known = chatFailure(error);
      if (known) throw known;
      // Our own errors (envelope, e-mail policy) are for `safely`; anything
      // else is the vendor's: never serialized, never logged.
      if (error instanceof ApiError || error instanceof EmailPolicyError)
        throw error;
      throw unavailable(
        "Сервис сообщений временно недоступен. Попробуйте позже.",
      );
    }
  });
}

/** POST /api/v1/chat/token */
export function handleChatToken(req: Request) {
  return chatSafely(async () => {
    const { viewer, hash } = await caller(req, true);
    await limited("chat:token:" + viewer.id, chatLimits.other);
    const issued = await transaction((q) => issueChatToken(q, viewer, hash));
    return ok({
      apiKey: issued.apiKey,
      user: {
        id: issued.user.id,
        name: issued.user.name,
        image: issued.user.image || null,
      },
      token: issued.token,
      expiresAt: new Date(issued.expiresAt * 1000).toISOString(),
      channelType: issued.type,
    });
  });
}

/** POST /api/v1/chat/channels */
export function handleChatChannels(req: Request) {
  return chatSafely(async () => {
    const { viewer, hash } = await caller(req, true);
    const input = await parseJsonBody(
      req,
      createChatChannelRequestSchema,
      4096,
    );
    // As for comments: with a key the allowance is spent inside the
    // transaction, by the request that creates, never by a replay.
    const key = idempotencyKey(req.headers);
    const budget = "chat:channels:" + viewer.id;
    if (key === null) await limited(budget, chatLimits.channels);
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key,
        body: input,
      },
      async (q) => {
        if (key !== null) await limitedIn(q, budget, chatLimits.channels);
        return {
          status: 201,
          body: await createChatChannel(q, viewer, input, hash),
        };
      },
    );
    return ok(
      response.body,
      response.status,
      replayed ? { "Idempotency-Replayed": "true" } : {},
    );
  });
}

/** GET /api/v1/chat/people */
export function handleChatPeople(req: Request) {
  return chatSafely(async () => {
    const { viewer } = await caller(req, false);
    const { q } = parseChatPeopleQuery(new URL(req.url));
    await limited("chat:people:" + viewer.id, chatLimits.other);
    const found = await chatPeople(db, viewer.id, q);
    return ok({
      people: found.people.map((person) => ({
        id: person.id,
        username: person.username,
        name: person.name,
        avatarUrl: person.avatar_id ? "/api/avatars/" + person.avatar_id : null,
      })),
      mode: found.mode,
    });
  });
}

/** GET /api/v1/chat/unread */
export function handleChatUnread(req: Request) {
  return chatSafely(async () => {
    const { viewer } = await caller(req, false);
    parseNoQuery(new URL(req.url));
    await limited("chat:unread:" + viewer.id, chatLimits.other);
    const identity = await db.query(
      "SELECT 1 FROM chat_identities WHERE user_id=$1",
      [viewer.id],
    );
    if (!identity.rowCount) return ok({ unread: 0 });
    const counts = await chatProvider().getUnreadCount(streamUserId(viewer.id));
    return ok({ unread: counts.total_unread_count || 0 });
  });
}
