import { ZodError } from "zod";
import { db, transaction } from "../../../../lib/db.ts";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import { json, fail, readJson, sameOrigin } from "../../../../lib/http.ts";
import { errorMessage, errorStatus } from "../../../../lib/errors.ts";
import { requireVerifiedEmail } from "../../../../lib/email-policy.ts";
import { traced, logError } from "../../../../lib/observability.ts";
import {
  bikeWeekSettingsInput,
  bikeWeekStoryInput,
  bikeWeekDecisionInput,
  weekInput,
  bikeWeekStart,
} from "../../../../lib/bike-week-validation.ts";
import {
  currentBikeWeek,
  ownerBikeWeek,
  updateBikeWeekStory,
  bikeWeekPreview,
  saveBikeWeekSettings,
  decideBikeWeek,
  selectBikeWeek,
} from "../../../../lib/bike-week.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
async function handler(
  req: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await params,
      method = req.method;
    if (method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    if (resource === "current" && method === "GET")
      return json(await currentBikeWeek(db));
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (resource === "me") {
      if (method === "GET") return json(await ownerBikeWeek(db, user.id));
      if (method === "PUT") {
        const input = bikeWeekStoryInput.parse(await readJson(req, 4096));
        if (input.action === "publish") requireVerifiedEmail(user);
        if (!(await rateLimit("bike-week-story:" + user.id, 30)))
          return fail("Попробуйте позже", 429);
        return json(
          await transaction((q) => updateBikeWeekStory(q, user.id, input)),
        );
      }
    }
    if (user.role !== "admin")
      return fail("Доступ только для администратора", 403);
    if (resource === "admin" && method === "GET")
      return json(
        await bikeWeekPreview(
          db,
          weekInput.parse(
            new URL(req.url).searchParams.get("week") || bikeWeekStart(),
          ),
        ),
      );
    if (resource === "settings" && method === "PUT") {
      const input = bikeWeekSettingsInput.parse(await readJson(req, 4096));
      return json(
        await transaction((q) => saveBikeWeekSettings(q, user.id, input)),
      );
    }
    if (resource === "decision" && method === "PUT") {
      const input = bikeWeekDecisionInput.parse(await readJson(req, 4096));
      return json(await transaction((q) => decideBikeWeek(q, user.id, input)));
    }
    if (resource === "run" && method === "POST") {
      if (!(await rateLimit("bike-week-run:" + user.id, 10)))
        return fail("Попробуйте позже", 429);
      return json(await transaction((q) => selectBikeWeek(q)));
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof ZodError)
      return fail(e.issues[0]?.message || "Проверьте поля", 400);
    const status = errorStatus(e);
    if (status) return fail(errorMessage(e), status);
    logError("bike_week_api_failed", e);
    return fail("Не удалось выполнить действие", 500);
  }
}
export const GET = traced(handler),
  PUT = traced(handler),
  POST = traced(handler);
