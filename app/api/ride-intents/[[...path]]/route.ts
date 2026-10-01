import { errorMessage } from "../../../../lib/errors.ts";
import { z } from "zod";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { json, fail, readJson, sameOrigin } from "../../../../lib/http.ts";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../../lib/email-policy.ts";
import { uuid } from "../../../../lib/validation.ts";
import { ridePulsePeople } from "../../../../lib/ride-pulse.ts";
import { traced, logError } from "../../../../lib/observability.ts";
import {
  createIntentInput,
  intentInput,
  IntentError,
} from "../../../../lib/ride-intent-input.ts";
import {
  listIntents,
  intentDetail,
  createIntent,
  updateIntent,
  closeIntent,
  intentPreferences,
  saveIntentPreferences,
} from "../../../../lib/ride-intents.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";

async function handler(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    if (req.method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    const p = (await params).path || [],
      method = req.method,
      url = new URL(req.url);
    if (p.length === 1 && p[0] === "pulse" && method === "GET")
      return json(await ridePulsePeople(db, user.id));
    if (
      method !== "GET" &&
      !(await rateLimit("ride-intent-write:" + user.id, 40))
    )
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (p.length === 1 && p[0] === "preferences") {
      if (method === "GET")
        return json({ preferences: await intentPreferences(db, user.id) });
      if (method === "PUT") {
        const input = await readJson(req, 8192);
        return json({
          preferences: await transaction((q) =>
            saveIntentPreferences(q, user.id, input),
          ),
        });
      }
    }
    if (!p.length && method === "GET")
      return json(
        await listIntents(db, user.id, {
          own:
            z
              .enum(["own", "community"])
              .parse(url.searchParams.get("scope") || "own") === "own",
          page: z.coerce
            .number()
            .int()
            .min(1)
            .max(10000)
            .parse(url.searchParams.get("page") || 1),
        }),
      );
    if (!p.length && method === "POST") {
      const input = createIntentInput.parse(await readJson(req, 8192));
      if (input.visibility === "community") requireVerifiedEmail(user);
      const result = await transaction((q) => createIntent(q, user.id, input));
      return json(result, result.created ? 201 : 200);
    }
    if (p.length === 1) {
      const id = uuid.parse(p[0]);
      if (method === "GET")
        return json({ intent: await intentDetail(db, user.id, id) });
      if (method === "PUT") {
        const input = intentInput.parse(await readJson(req, 8192));
        if (input.visibility === "community") requireVerifiedEmail(user);
        return json({
          intent: await transaction((q) => updateIntent(q, user.id, id, input)),
        });
      }
      if (method === "DELETE")
        return json(
          await transaction((q) => closeIntent(q, user.id, id, true)),
        );
    }
    if (p.length === 2 && p[1] === "cancel" && method === "POST")
      return json(
        await transaction((q) => closeIntent(q, user.id, uuid.parse(p[0]))),
      );
    return fail("Не найдено", 404);
  } catch (error) {
    if (error instanceof IntentError || error instanceof EmailPolicyError)
      return fail(error.message, error.status);
    if (error instanceof z.ZodError)
      return fail(error.issues[0]?.message || "Проверьте поля", 400);
    if (
      error instanceof SyntaxError ||
      /размер запроса|Пустой запрос/.test(errorMessage(error))
    )
      return fail("Некорректный запрос", 400);
    logError("ride_intent_failed", error);
    return fail("Не удалось сохранить намерение. Попробуйте ещё раз.", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PUT = route,
  DELETE = route;
