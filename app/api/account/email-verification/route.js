import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { transaction } from "../../../../lib/db.js";
import { fail, json, sameOrigin } from "../../../../lib/http.js";
import { mailEnabled } from "../../../../lib/mail.js";
import { emailVerificationMail } from "../../../../lib/mail-templates.js";
import { accountLink, requestEmailVerification } from "../../../../lib/account.js";
import { sendAfterResponse } from "../../../../lib/account-mail.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a new confirmation link to the signed-in user's current address.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!mailEnabled()) return fail("Отправка писем пока не настроена", 503);
  if (!(await rateLimit("verify-send:" + user.id, 3)))
    return fail("Письмо уже отправлено. Повторить можно через 15 минут.", 429);
  const request = await transaction((q) => requestEmailVerification(q, user.id));
  if (!request) return json({ ok: true, verified: true });
  sendAfterResponse({
    to: request.user.email,
    ...emailVerificationMail({
      name: request.user.name,
      link: accountLink("/verify-email", request.token),
    }),
  });
  return json({ ok: true, sent: true });
});
