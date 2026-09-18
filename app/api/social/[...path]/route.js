import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import {
  json,
  fail,
  sameOrigin,
  readJson,
  readBytes,
} from "../../../../lib/http.js";
import { traced, logError } from "../../../../lib/observability.js";
import {
  usernameInput,
  publicProfileInput,
  preferencesInput,
  socialPage,
} from "../../../../lib/social-validation.js";
import {
  getProfile,
  updateProfile,
  accountOverview,
} from "../../../../lib/profiles.js";
import { followPage, setFollow } from "../../../../lib/follows.js";
import { prepareAvatar, replaceAvatar } from "../../../../lib/avatars.js";
import { showcase } from "../../../../lib/showcase.js";
import { limits, QuotaError } from "../../../../lib/limits.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const { path: p } = await params,
      method = req.method;
    if (method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser();
    if (p[0] === "profiles" && p.length >= 2 && p.length <= 3) {
      const parsed = usernameInput.safeParse(p[1]);
      if (!parsed.success) return fail("Профиль недоступен", 404);
      const username = parsed.data;
      if (
        p.length === 3 &&
        p[2] === "follow" &&
        ["PUT", "DELETE"].includes(method)
      ) {
        if (!user) return fail("Войдите в аккаунт", 401);
        if (!(await rateLimit("follow:" + user.id, limits.follows)))
          return fail("Слишком много действий. Попробуйте позже.", 429);
        const result = await transaction((q) =>
          setFollow(q, user.id, username, method === "PUT"),
        );
        return result.error ? fail(result.error, result.status) : json(result);
      }
      if (method !== "GET") return fail("Не найдено", 404);
      const page = socialPage.parse(
        new URL(req.url).searchParams.get("page") || 1,
      );
      if (["followers", "following", "friends"].includes(p[2])) {
        const result = await followPage(db, username, user?.id, p[2], page);
        return result ? json(result) : fail("Профиль недоступен", 404);
      }
      const profile = await getProfile(db, username, user?.id);
      if (!profile) return fail("Профиль недоступен", 404);
      if (p.length === 2) return json({ profile });
      if (p[2] === "bikes")
        return json(
          await showcase(db, user?.id, { page, ownerId: profile.id }),
        );
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p.length === 1 && p[0] === "account" && method === "GET")
      return json(await accountOverview(db, user));
    if (p.length === 1 && p[0] === "me" && method === "PATCH") {
      if (!(await rateLimit("profile-edit:" + user.id, limits.profileEdits)))
        return fail("Слишком много изменений профиля", 429);
      const input = publicProfileInput.parse(await readJson(req, 8192));
      if (!(await updateProfile(db, user.id, input)))
        return fail("Пользователь недоступен", 404);
      return json({ profile: await getProfile(db, input.username, user.id) });
    }
    if (p.length === 1 && p[0] === "preferences" && method === "PATCH") {
      if (!(await rateLimit("profile-edit:" + user.id, limits.profileEdits)))
        return fail("Слишком много изменений", 429);
      const { preferences } = preferencesInput.parse(await readJson(req, 8192));
      await db.query("UPDATE users SET preferences=$2 WHERE id=$1", [
        user.id,
        JSON.stringify(preferences),
      ]);
      return json({ preferences });
    }
    if (
      p.length === 2 &&
      p[0] === "me" &&
      p[1] === "avatar" &&
      ["PUT", "DELETE"].includes(method)
    ) {
      if (!(await rateLimit("avatar:" + user.id, limits.avatarUploads)))
        return fail("Слишком много изменений аватара", 429);
      let bytes = null;
      if (method === "PUT") {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(
            req.headers.get("content-type"),
          )
        )
          return fail("Поддерживаются JPEG, PNG и WebP");
        const declared = Number(req.headers.get("content-length") || 0);
        if (declared > limits.avatarFileBytes)
          return fail("Аватар должен быть меньше 2 МБ", 413);
        try {
          bytes = await prepareAvatar(
            await readBytes(req, limits.avatarFileBytes),
          );
        } catch (e) {
          return fail(
            "Не удалось прочитать аватар. Используйте изображение до 2 МБ.",
            400,
          );
        }
      }
      return json(
        await replaceAvatar(
          transaction,
          user.id,
          bytes,
          process.env.UPLOAD_DIR || "uploads",
        ),
      );
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof QuotaError) return fail(e.message, e.status);
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Слишком большой запрос", 413);
    if (e.message === "Пустой запрос") return fail("Пустой запрос");
    if (e.code === "23505") return fail("Этот username уже занят", 409);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail(
        "Проверьте поля: username 3–30 латинских символов, цифр, точки, дефиса или подчёркивания; системные имена недоступны.",
      );
    logError("social_request_failed", e);
    return fail("Не удалось выполнить запрос", 500);
  }
}
export const GET = traced(handler),
  PATCH = traced(handler),
  PUT = traced(handler),
  DELETE = traced(handler);
