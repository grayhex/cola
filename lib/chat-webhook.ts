import type { Queryable } from "./db.ts";
import { chatCredentials } from "./chat-config.ts";
import {
  CHAT_WEBHOOK_MAX_BYTES,
  chatMessagePush,
  chatWebhookSignatureOk,
  enqueueChatPush,
} from "./chat-push.ts";
import { logEvent } from "./observability.ts";

// The webhook of Stream for new messages (#342): POST /api/chat/webhook. The call
// is machine to machine, so it has no cookie and no Origin; it is trusted only by
// the signature of its raw body and by the application key. Stream gives it six
// seconds, so the work is only: check, remember, write references to the queue,
// answer. Nothing is sent to a provider here, and nothing of the message is kept.
// A failure answers 5xx and Stream retries the same call (same X-Webhook-Id).

export interface ChatWebhookDeps {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Runs the work in one transaction (a thrown error rolls it back). */
  transaction: <T>(work: (q: Queryable) => Promise<T>) => Promise<T>;
}

const reply = (status: number, body: Record<string, unknown> = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function rawBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > CHAT_WEBHOOK_MAX_BYTES) {
      await reader.cancel();
      return "too_large" as const;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleChatWebhook(
  req: Request,
  { env = process.env, now = new Date(), transaction }: ChatWebhookDeps,
) {
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  // Without the secret there is nothing to check a call against: not ours yet.
  const credentials = chatCredentials(env);
  if (!credentials) return reply(503, { error: "unavailable" });
  const raw = await rawBody(req);
  if (raw === "too_large") return reply(413, { error: "too_large" });
  if (raw === null) return reply(400, { error: "invalid" });
  const webhookId = req.headers.get("x-webhook-id") ?? "";
  if (
    req.headers.get("x-api-key") !== credentials.key ||
    !chatWebhookSignatureOk(
      raw,
      req.headers.get("x-signature"),
      credentials.secret,
    )
  )
    return reply(401, { error: "unauthorized" });
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(webhookId))
    return reply(400, { error: "invalid" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid" });
  }
  const push = chatMessagePush(body);
  // Any other event, channel or kind of message is taken and forgotten.
  if (!push) return reply(200, { ok: true, queued: 0 });
  try {
    const result = await transaction((q) =>
      enqueueChatPush(q, webhookId, push, now),
    );
    logEvent("chat_push_webhook", {
      queued: result.queued,
      first: result.first,
    });
    return reply(200, { ok: true, queued: result.queued });
  } catch {
    // Never the message, the ids or the reason: Stream retries the same call.
    return reply(503, { error: "unavailable" });
  }
}
