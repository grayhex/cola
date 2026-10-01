import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.ts";
import {
  notificationEmailInput,
  notificationEmailSettings,
  saveNotificationEmail,
} from "../../../../lib/notification-preferences.ts";
import { traced } from "../../../../lib/observability.ts";
import { CommunityError } from "../../../../lib/community-validation.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = traced(async function GET() {
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  return json(await notificationEmailSettings(db, user.id));
});
export const PATCH = traced(async function PATCH(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!(await rateLimit("notification-preferences:" + user.id, 30)))
    return fail("Слишком много изменений. Попробуйте позже.", 429);
  let input;
  try {
    input = notificationEmailInput.parse(await readJson(req, 4096));
  } catch {
    return fail("Проверьте настройки уведомлений", 400);
  }
  try {
    return json(
      await transaction((q) => saveNotificationEmail(q, user.id, input)),
    );
  } catch (error) {
    if (error instanceof CommunityError)
      return fail(error.message, error.status);
    console.error(JSON.stringify({ event: "notification_settings_failed" }));
    return fail("Не удалось сохранить настройки уведомлений", 500);
  }
});
