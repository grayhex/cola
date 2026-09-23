import { z } from "zod";
import { rateLimit } from "../../../../lib/auth.js";
import { trustedIp } from "../../../../lib/auth-limits.js";
import { transaction } from "../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.js";
import { digest } from "../../../../lib/password.js";
import { tokenInput, verifyEmail } from "../../../../lib/account.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Works without a session: the link may be opened on another device.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const ip = trustedIp(req);
  if (
    (ip && !(await rateLimit("verify:ip:" + digest(ip), 20))) ||
    !(await rateLimit("verify:global", 600))
  )
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let token;
  try {
    token = z.object({ token: tokenInput }).strict().parse(await readJson(req, 4096)).token;
  } catch {
    token = null;
  }
  const userId = token && (await transaction((q) => verifyEmail(q, token)));
  if (!userId)
    return json(
      {
        error: "Ссылка недействительна или устарела. Отправьте письмо ещё раз из кабинета.",
        code: "TOKEN_INVALID",
      },
      400,
    );
  return json({ ok: true });
});
