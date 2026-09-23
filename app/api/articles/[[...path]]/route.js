import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { json, fail, readJson, sameOrigin } from "../../../../lib/http.js";
import { uuid } from "../../../../lib/validation.js";
import {
  CommunityError,
  communityPage,
  commentInput,
  commentEdit,
} from "../../../../lib/community-validation.js";
import {
  articleInput,
  articleList,
  articleDetail,
  saveArticle,
  deleteArticle,
  articleSocial,
} from "../../../../lib/articles.js";
import { cleanupJournalPhotos } from "../../../../lib/journal-storage.js";
import { logError, traced } from "../../../../lib/observability.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const p = (await params).path || [],
      m = req.method,
      url = new URL(req.url),
      user = await currentUser();
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const page = () => communityPage.parse(url.searchParams.get("page") || 1);
    if (m === "GET") {
      if (!p.length) {
        const own = url.searchParams.get("own") === "1";
        if (own && !user) return fail("Войдите в аккаунт", 401);
        return json(
          await articleList(db, user?.id, {
            own,
            page: page(),
            topic: url.searchParams.get("topic")?.slice(0, 64) || null,
            search: (url.searchParams.get("q") || "").slice(0, 100),
          }),
        );
      }
      if (p[0] === "public" && p.length === 2)
        return json({
          article: await articleDetail(db, uuid.parse(p[1]), user?.id),
        });
      if (p.length === 2 && p[1] === "comments")
        return json(
          await articleSocial.page(
            db,
            uuid.parse(p[0]),
            user,
            page(),
            url.searchParams.has("focus")
              ? uuid.parse(url.searchParams.get("focus"))
              : null,
          ),
        );
      if (p.length === 4 && p[1] === "comments" && p[3] === "replies")
        return json(
          await articleSocial.replies(
            db,
            uuid.parse(p[0]),
            uuid.parse(p[2]),
            user,
            page(),
          ),
        );
      return fail("Не найдено", 404);
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    const key =
      p[1] === "comments"
        ? "comments"
        : p[0] === "comments"
          ? "comment-edit"
          : "journal-write";
    if (!(await rateLimit(key + ":" + user.id, 20)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (!p.length && m === "POST") {
      const input = articleInput.parse(await readJson(req, 100000));
      return json(
        await transaction((q) => saveArticle(q, user.id, input)),
        201,
      );
    }
    if (p.length === 1 && m === "PATCH") {
      const input = articleInput.parse(await readJson(req, 100000));
      return json(
        await transaction((q) =>
          saveArticle(q, user.id, input, uuid.parse(p[0])),
        ),
      );
    }
    if (p.length === 1 && m === "DELETE") {
      const result = await transaction((q) =>
        deleteArticle(q, uuid.parse(p[0]), user.id),
      );
      await cleanupJournalPhotos(db);
      return json(result);
    }
    if (
      p[0] === "comments" &&
      p.length === 2 &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      const body =
        m === "PATCH"
          ? commentEdit.parse(await readJson(req, 8192)).body
          : null;
      return json(
        await transaction((q) =>
          articleSocial.change(q, uuid.parse(p[1]), user, body),
        ),
      );
    }
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      const input = commentInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          articleSocial.create(q, uuid.parse(p[0]), user, input),
        ),
        201,
      );
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail(
        "Проверьте статью: для публикации нужны заголовок, текст и рубрика",
      );
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Текст слишком большой", 413);
    logError("article_failed", e);
    return fail("Не удалось обработать статью", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PATCH = route,
  DELETE = route;
