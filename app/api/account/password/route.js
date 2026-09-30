import { z } from "zod";
import {
  currentSessionHash,
  currentUser,
  rateLimit,
} from "../../../../lib/auth.ts";
import { transaction } from "../../../../lib/db.ts";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.ts";
import { passwordInput } from "../../../../lib/validation.ts";
import { changePassword } from "../../../../lib/account-data.ts";
import { traced } from "../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: passwordInput,
  })
  .strict();

// A new password for the signed-in account; other sessions end (#70).
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!(await rateLimit("account-password:" + user.id, 10)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Новый пароль должен содержать от 10 до 128 символов");
  }
  const hash = await currentSessionHash();
  const result = await transaction((q) =>
    changePassword(q, user.id, data.currentPassword, data.password, hash),
  );
  if (result.error) return fail(result.error, result.status);
  return json({ ok: true });
});
