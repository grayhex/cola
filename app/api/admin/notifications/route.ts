import { db, transaction } from "../../../../lib/db.ts";
import { audit } from "../../../../lib/site.ts";
import {
  NotificationAdminError,
  adminNotifications,
  saveAdminNotifications,
} from "../../../../lib/notification-admin.ts";
import {
  adminBody,
  adminOnly,
  adminProblem,
} from "../../../../lib/admin-route.ts";
import { fail, json } from "../../../../lib/http.ts";
import { traced } from "../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The notifications block of the app settings (#341): the catalogue, the limits
// and the kill switches. Administrators only, on every read and write.
async function handler(req: Request) {
  try {
    const guard = await adminOnly(req, { change: req.method !== "GET" });
    if ("response" in guard) return guard.response;
    if (req.method === "GET") return json(await adminNotifications(db));
    const input = await adminBody(req);
    return json(
      await transaction((q) =>
        saveAdminNotifications(q, guard.user.id, input, audit),
      ),
    );
  } catch (e) {
    if (e instanceof NotificationAdminError) return fail(e.message, e.status);
    return adminProblem(
      e,
      "notification_admin_error",
      "Не удалось сохранить настройки уведомлений. Изменения остались в редакторе.",
    );
  }
}
export const GET = traced(handler);
export const PUT = traced(handler);
