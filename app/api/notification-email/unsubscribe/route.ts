import { db } from "../../../../lib/db.ts";
import { rateLimit } from "../../../../lib/auth.ts";
import { trustedIp } from "../../../../lib/auth-limits.ts";
import { digest } from "../../../../lib/password.ts";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.ts";
import { unsubscribeNotificationEmail } from "../../../../lib/notification-preferences.ts";
import { traced } from "../../../../lib/observability.ts";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ token: z.string().max(128) }).strict();
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const ip = trustedIp(req);
  if (
    (ip &&
      !(await rateLimit("notification-unsubscribe:ip:" + digest(ip), 30))) ||
    !(await rateLimit("notification-unsubscribe:global", 600))
  )
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let value;
  try {
    value = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Проверьте ссылку из письма", 400);
  }
  if (!(await unsubscribeNotificationEmail(db, value.token)))
    return fail(
      "Ссылка недействительна или устарела. Измените настройки в кабинете.",
      400,
    );
  return json({ ok: true });
});
