import { z } from "zod";
import { rateLimit, startSession } from "../../../../../lib/auth.js";
import { trustedIp } from "../../../../../lib/auth-limits.js";
import { transaction } from "../../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.js";
import { digest } from "../../../../../lib/password.js";
import { passwordInput } from "../../../../../lib/validation.js";
import { resetPassword, tokenInput } from "../../../../../lib/account.js";
import { traced } from "../../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({ token: tokenInput, password: passwordInput }).strict();

export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const ip = trustedIp(req);
  if (
    (ip && !(await rateLimit("reset-confirm:ip:" + digest(ip), 10))) ||
    !(await rateLimit("reset-confirm:global", 300))
  )
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Пароль должен содержать от 10 до 128 символов");
  }
  const userId = await transaction((q) =>
    resetPassword(q, data.token, data.password),
  );
  if (!userId)
    return json(
      {
        error: "Ссылка недействительна или устарела. Запросите новую.",
        code: "TOKEN_INVALID",
      },
      400,
    );
  await startSession(userId);
  return json({ ok: true });
});
