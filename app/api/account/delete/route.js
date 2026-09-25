import { z } from "zod";
import { currentUser, endSession, rateLimit } from "../../../../lib/auth.js";
import { transaction } from "../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../lib/http.js";
import {
  deleteAccount,
  removeAccountFiles,
} from "../../../../lib/account-data.js";
import { traced } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z
  .object({
    password: z.string().min(1).max(128),
    confirm: z.literal("УДАЛИТЬ"),
  })
  .strict();

// Deletes the signed-in account and everything it owns (#70).
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!(await rateLimit("account-delete:" + user.id, 5)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Введите пароль и слово УДАЛИТЬ для подтверждения");
  }
  const result = await transaction((q) =>
    deleteAccount(q, user.id, data.password),
  );
  if (result.error) return fail(result.error, result.status);
  // Rows are gone; bike photos and the avatar leave the disk now, other
  // files through their queues.
  await removeAccountFiles(result.files);
  await endSession();
  return json({ ok: true });
});
