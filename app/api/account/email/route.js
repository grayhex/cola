import { z } from "zod";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { transaction } from "../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.js";
import { emailInput } from "../../../../lib/validation.js";
import { mailEnabled } from "../../../../lib/mail.js";
import { emailChangeMail } from "../../../../lib/mail-templates.js";
import { accountLink } from "../../../../lib/account.js";
import { sendAfterResponse } from "../../../../lib/account-mail.js";
import { requestEmailChange } from "../../../../lib/account-data.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z
  .object({ password: z.string().min(1).max(128), email: emailInput })
  .strict();

// Sends a confirmation link to the new address; the address changes when
// that link is opened (#70).
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!mailEnabled()) return fail("Отправка писем пока не настроена", 503);
  if (!(await rateLimit("account-email:" + user.id, 5)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Проверьте адрес почты");
  }
  const result = await transaction((q) =>
    requestEmailChange(q, user.id, data.password, data.email),
  );
  if (result.error) return fail(result.error, result.status);
  sendAfterResponse({
    to: data.email,
    ...emailChangeMail({
      name: result.user.name,
      link: accountLink("/confirm-email", result.token),
    }),
  });
  return json({ ok: true, sent: true });
});
