import { db } from "../../../../../lib/db.ts";
import { audit } from "../../../../../lib/site.ts";
import {
  NotificationAdminError,
  sendAdminTest,
} from "../../../../../lib/notification-admin.ts";
import { adminOnly, adminProblem } from "../../../../../lib/admin-route.ts";
import { rateLimit } from "../../../../../lib/auth.ts";
import { fail, json } from "../../../../../lib/http.ts";
import { traced } from "../../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A test message to the administrator's own address and to nobody else.
async function handler(req: Request) {
  try {
    const guard = await adminOnly(req, { change: true });
    if ("response" in guard) return guard.response;
    if (!(await rateLimit("notification-test:" + guard.user.id, 5)))
      return fail("Слишком много тестовых писем. Попробуйте позже.", 429);
    return json(await sendAdminTest(db, guard.user.id, audit));
  } catch (e) {
    if (e instanceof NotificationAdminError) return fail(e.message, e.status);
    return adminProblem(
      e,
      "notification_test_error",
      "Не удалось отправить тестовое письмо.",
    );
  }
}
export const POST = traced(handler);
