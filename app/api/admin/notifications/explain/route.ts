import { z } from "zod";
import { transaction } from "../../../../../lib/db.ts";
import { audit } from "../../../../../lib/site.ts";
import {
  NotificationAdminError,
  explainDiscovery,
} from "../../../../../lib/notification-admin.ts";
import {
  adminBody,
  adminOnly,
  adminProblem,
} from "../../../../../lib/admin-route.ts";
import { fail, json } from "../../../../../lib/http.ts";
import { traced } from "../../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.strictObject({
  author: z.string().trim().min(1).max(64),
  recipient: z.string().trim().min(1).max(64),
});
// Why a new plan or intent of one person would, or would not, reach another:
// the reasons only, never anything either wrote. The question is audited.
async function handler(req: Request) {
  try {
    const guard = await adminOnly(req, { change: true });
    if ("response" in guard) return guard.response;
    const body = input.parse(await adminBody(req));
    return json(
      await transaction((q) => explainDiscovery(q, guard.user.id, body, audit)),
    );
  } catch (e) {
    if (e instanceof NotificationAdminError) return fail(e.message, e.status);
    return adminProblem(
      e,
      "notification_explain_error",
      "Не удалось разобрать причины.",
    );
  }
}
export const POST = traced(handler);
