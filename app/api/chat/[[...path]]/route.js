import { NextResponse } from "next/server";
import { z } from "zod";
import {
  currentUser,
  currentSessionHash,
  rateLimit,
} from "../../../../lib/auth.js";
import { db, transaction } from "../../../../lib/db.js";
import { readJson, sameOrigin } from "../../../../lib/http.js";
import { chatConfig, streamUserId } from "../../../../lib/chat-config.js";
import { chatProvider, ChatError } from "../../../../lib/chat-provider.js";
import { issueChatToken, createChatChannel } from "../../../../lib/chat.js";
import {
  EmailPolicyError,
  requireVerifiedEmail,
} from "../../../../lib/email-policy.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const empty = z.object({}).strict();
const methods = {
  token: "POST",
  channels: "POST",
  people: "GET",
  unread: "GET",
  export: "POST",
};
async function payload(req, limit) {
  try {
    return await readJson(req, limit);
  } catch {
    throw new ChatError("Проверьте размер и формат запроса", 400);
  }
}
/** @param {Request} req
 * @param {{ params: Promise<{ path: string[] | undefined }> }} context */
async function handler(req, { params }) {
  try {
    const viewer = await currentUser();
    if (!viewer) return reply({ error: "Войдите в аккаунт" }, 401);
    if (req.method !== "GET" && !sameOrigin(req))
      return reply({ error: "Недопустимый источник запроса" }, 403);
    if (!chatConfig())
      return reply({ error: "Сообщения пока отключены", enabled: false }, 503);
    requireVerifiedEmail(viewer);
    const { path = [] } = await params;
    if (path.length !== 1) return reply({ error: "Не найдено" }, 404);
    const action = path[0];
    if (!Object.hasOwn(methods, action) || methods[action] !== req.method)
      return reply({ error: "Не найдено" }, 404);
    if (
      !(await rateLimit(
        "chat:" + action + ":" + viewer.id,
        action === "channels" ? 10 : action === "export" ? 5 : 100,
      ))
    )
      return reply({ error: "Слишком много запросов. Попробуйте позже" }, 429);
    if (action === "token" && req.method === "POST") {
      empty.parse(await payload(req, 1024));
      const hash = await currentSessionHash();
      return reply(await transaction((q) => issueChatToken(q, viewer, hash)));
    }
    if (action === "channels" && req.method === "POST") {
      const data = await payload(req, 4096);
      const hash = await currentSessionHash();
      return reply(
        await transaction((q) => createChatChannel(q, viewer, data, hash)),
        201,
      );
    }
    if (action === "people" && req.method === "GET") {
      const term = new URL(req.url).searchParams.get("q")?.trim() || "";
      if (term.length < 2 || term.length > 80) return reply({ people: [] });
      const { rows } = await db.query(
        "SELECT id,name,username,avatar_id FROM users WHERE id<>$1 AND NOT blocked AND email_verified_at IS NOT NULL AND (username ILIKE $2 OR name ILIKE $2) ORDER BY username,id LIMIT 10",
        [viewer.id, "%" + term.replace(/[\\%_]/g, "\\$&") + "%"],
      );
      return reply({ people: rows });
    }
    if (action === "unread" && req.method === "GET") {
      const identity = await db.query(
        "SELECT 1 FROM chat_identities WHERE user_id=$1",
        [viewer.id],
      );
      if (!identity.rowCount) return reply({ unread: 0 });
      const counts = await chatProvider().getUnreadCount(
        streamUserId(viewer.id),
      );
      return reply({ unread: counts.total_unread_count || 0 });
    }
    if (action === "export" && req.method === "POST") {
      empty.parse(await payload(req, 1024));
      const identity = await db.query(
        "SELECT 1 FROM chat_identities WHERE user_id=$1",
        [viewer.id],
      );
      const data = identity.rowCount
        ? await chatProvider().exportUser(streamUserId(viewer.id))
        : { messages: [], reactions: [] };
      return new NextResponse(JSON.stringify(data), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="colabike-chat.json"',
        },
      });
    }
    return reply({ error: "Не найдено" }, 404);
  } catch (e) {
    if (e instanceof EmailPolicyError || e instanceof ChatError)
      return reply(
        {
          error: e.message,
          ...(e instanceof EmailPolicyError ? { code: e.code } : {}),
        },
        e.status,
      );
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return reply({ error: "Проверьте поля запроса" }, 400);
    // Vendor errors can contain headers/tokens; never serialize or log them.
    return reply(
      { error: "Сервис сообщений временно недоступен. Попробуйте позже" },
      503,
    );
  }
}
export const GET = traced(handler);
export const POST = traced(handler);
