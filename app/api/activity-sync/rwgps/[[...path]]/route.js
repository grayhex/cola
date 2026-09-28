import { NextResponse } from "next/server";
import { z } from "zod";
import { db, transaction } from "../../../../../lib/db.js";
import {
  currentUser,
  currentSessionHash,
  rateLimit,
} from "../../../../../lib/auth.js";
import {
  fail,
  json,
  readJson,
  readBytes,
  sameOrigin,
} from "../../../../../lib/http.js";
import { traced } from "../../../../../lib/observability.js";
import { uuid } from "../../../../../lib/validation.js";
import {
  ActivityError,
  rwgpsConfig,
  verifyRwgpsWebhook,
} from "../../../../../lib/rwgps.js";
import {
  activityStatus,
  beginActivityOAuth,
  finishActivityOAuth,
  disconnectActivity,
  requestActivitySync,
  receiveActivityNotifications,
} from "../../../../../lib/activity-sync.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
/** @param {Request} req
 * @param {{params:Promise<{path?:string[]}>}} context */
async function handler(req, { params }) {
  const path = (await params).path || [],
    action = path[0] || "";
  if (path.length > 1) return fail("Не найдено", 404);
  try {
    if (action === "webhook" && req.method === "POST") {
      const config = rwgpsConfig();
      if (!config) return fail("Интеграция выключена", 503);
      const body = await readBytes(req, 128 * 1024);
      const notifications = verifyRwgpsWebhook(
        body,
        req.headers.get("x-rwgps-signature"),
        req.headers.get("x-rwgps-api-key"),
        config,
      );
      await receiveActivityNotifications(db, notifications);
      return json({ ok: true });
    }
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    const currentSession = await currentSessionHash();
    if (action === "callback" && req.method === "GET") {
      if (!(await rateLimit("activity-oauth-callback:" + user.id, 10)))
        return fail("Слишком много попыток", 429);
      const url = new URL(req.url),
        target = new URL(
          "/account?tab=rides",
          process.env.APP_ORIGIN || "http://localhost:3000",
        );
      try {
        const state = z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/)
            .parse(url.searchParams.get("state")),
          code = z
            .string()
            .min(1)
            .max(4096)
            .parse(url.searchParams.get("code"));
        const result = await transaction((q) =>
          finishActivityOAuth(q, user.id, currentSession, state, code),
        );
        target.searchParams.set(
          "activity_sync",
          result.connected ? "connected" : "error",
        );
      } catch {
        target.searchParams.set("activity_sync", "error");
      }
      return NextResponse.redirect(target, {
        status: 303,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (!action && req.method === "GET")
      return json(await activityStatus(db, user.id));
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    if (!(await rateLimit("activity-sync:" + user.id, 10)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (!action && req.method === "DELETE")
      return json(await transaction((q) => disconnectActivity(q, user.id)));
    if (!rwgpsConfig()) return fail("Ride with GPS пока недоступен", 503);
    if (action === "connect" && req.method === "POST") {
      const body = z
        .object({ bikeId: uuid.nullable().optional() })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          beginActivityOAuth(q, user.id, currentSession, body.bikeId),
        ),
      );
    }
    if (action === "sync" && req.method === "POST") {
      const body = z
        .object({ bikeId: uuid.nullable().optional() })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) => requestActivitySync(q, user.id, body.bikeId)),
        202,
      );
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof ActivityError)
      return fail(
        e.message,
        [400, 401, 403, 404, 409, 429, 503].includes(e.status) ? e.status : 502,
      );
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return fail("Некорректные данные", 400);
    // OAuth and webhook data must never be included in logs.
    return fail("Не удалось выполнить действие. Попробуйте позже.", 503);
  }
}
export const GET = traced(handler);
export const POST = GET,
  DELETE = GET;
