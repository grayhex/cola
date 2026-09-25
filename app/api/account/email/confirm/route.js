import { rateLimit } from "../../../../../lib/auth.js";
import { trustedIp } from "../../../../../lib/auth-limits.js";
import { transaction } from "../../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.js";
import { digest } from "../../../../../lib/password.js";
import { tokenInput } from "../../../../../lib/account.js";
import { confirmEmailChange } from "../../../../../lib/account-data.js";
import { emailChangedMail } from "../../../../../lib/mail-templates.js";
import { sendAfterResponse } from "../../../../../lib/account-mail.js";
import { traced } from "../../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Opens an address-change link from the mailbox; works without a session,
// the token alone identifies the account (#70).
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const ip = trustedIp(req);
  if (
    (ip && !(await rateLimit("email-change:ip:" + digest(ip), 10))) ||
    !(await rateLimit("email-change:global", 300))
  )
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let token;
  try {
    token = tokenInput.parse((await readJson(req, 4096)).token);
  } catch {
    token = null;
  }
  const result = token
    ? await transaction((q) => confirmEmailChange(q, token))
    : null;
  if (!result)
    return json(
      {
        error: "Ссылка недействительна или устарела. Запросите новую.",
        code: "TOKEN_INVALID",
      },
      400,
    );
  if (result.taken)
    return json(
      {
        error:
          "Этот адрес уже занят другим аккаунтом. Запросите смену на другой.",
        code: "EMAIL_TAKEN",
      },
      409,
    );
  sendAfterResponse({
    to: result.previous,
    ...emailChangedMail({
      name: result.name,
      email: result.email,
      link: new URL(
        "/forgot-password",
        process.env.APP_ORIGIN || "http://localhost:3000",
      ).toString(),
    }),
  });
  return json({ ok: true, email: result.email });
});
