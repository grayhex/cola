import { z } from "zod";
import { rateLimit } from "../../../../lib/auth.js";
import { trustedIp } from "../../../../lib/auth-limits.js";
import { transaction } from "../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.js";
import { digest } from "../../../../lib/password.js";
import { emailInput } from "../../../../lib/validation.js";
import { mailEnabled } from "../../../../lib/mail.js";
import { passwordResetMail } from "../../../../lib/mail-templates.js";
import { accountLink, requestPasswordReset } from "../../../../lib/account.js";
import { sendAfterResponse } from "../../../../lib/account-mail.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Always the same answer for known and unknown addresses.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  if (!mailEnabled())
    return fail(
      "Восстановление пароля по почте пока недоступно. Напишите администратору сайта.",
      503,
    );
  let email;
  try {
    email = z.object({ email: emailInput }).strict().parse(await readJson(req, 4096)).email;
  } catch {
    return fail("Введите адрес электронной почты");
  }
  const ip = trustedIp(req);
  if (
    (ip && !(await rateLimit("reset:ip:" + digest(ip), 5))) ||
    !(await rateLimit("reset:email:" + digest(email), 3)) ||
    !(await rateLimit("reset:global", 200))
  )
    return fail("Слишком много запросов. Попробуйте через 15 минут.", 429);
  const request = await transaction((q) => requestPasswordReset(q, email));
  if (request)
    sendAfterResponse({
      to: request.user.email,
      ...passwordResetMail({
        name: request.user.name,
        link: accountLink("/reset-password", request.token),
      }),
    });
  return json({ ok: true });
});
