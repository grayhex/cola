import { z } from "zod";
import { currentUser, rateLimit } from "../../../../../lib/auth.ts";
import { db, transaction } from "../../../../../lib/db.ts";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.ts";
import {
  confirmPassword,
  unlinkIdentity,
} from "../../../../../lib/identities.ts";
import { traced } from "../../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({ password: z.string().min(1).max(128) }).strict();

// Unlinks Yandex ID (#151). The password confirms it, and the last way to
// sign in cannot be removed: an account without a password keeps its provider
// until the owner sets a password through recovery.
export const DELETE = traced(async function DELETE(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!(await rateLimit("account-identity:" + user.id, 10)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Введите пароль");
  }
  const confirmed = await confirmPassword(db, user.id, data.password);
  if (confirmed === "no_password")
    return json(
      {
        error:
          "Это единственный способ входа. Сначала задайте пароль через «Забыли пароль?».",
        code: "last_method",
      },
      409,
    );
  if (confirmed !== "ok") return fail("Пароль не подходит", 403);
  const result = await transaction((q) => unlinkIdentity(q, user.id, "yandex"));
  if (result === "not_linked")
    return fail("Яндекс не привязан к аккаунту", 404);
  if (result === "last_method")
    return json(
      { error: "Это единственный способ входа.", code: "last_method" },
      409,
    );
  return json({ ok: true });
});
