import { rideFeed } from "../../../../lib/ride-feed.js";
import {
  bikeFollowing,
  setBikeFollow,
  savedPage,
} from "../../../../lib/journal-discovery.js";
import { audit } from "../../../../lib/site.js";
import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { json, fail, sameOrigin, readJson } from "../../../../lib/http.js";
import { traced, logError } from "../../../../lib/observability.js";
import { uuid } from "../../../../lib/validation.js";
import { limits } from "../../../../lib/limits.js";
import {
  CommunityError,
  commentInput,
  commentEdit,
  reportInput,
  reportAction,
  communityPage,
} from "../../../../lib/community-validation.js";
import {
  commentPage,
  replyPage,
  createComment,
  changeComment,
} from "../../../../lib/comments.js";
import {
  notificationPage,
  unreadCount,
  readNotifications,
} from "../../../../lib/notifications.js";
import { noticeExpiringListings } from "../../../../lib/market.js";
import {
  createReport,
  reportPage,
  moderateReport,
} from "../../../../lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const { path: p } = await params,
      m = req.method,
      url = new URL(req.url);
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser(),
      page = () => communityPage.parse(url.searchParams.get("page") || 1);
    async function limited(key, max) {
      if (!(await rateLimit(key + ":" + user.id, max)))
        throw new CommunityError(
          "Слишком много действий. Попробуйте позже.",
          429,
        );
    }
    if (p[0] === "bikes" && p[2] === "comments") {
      const bike = uuid.parse(p[1]);
      if (p.length === 3 && m === "GET")
        return json(
          await commentPage(
            db,
            bike,
            user,
            page(),
            url.searchParams.has("focus")
              ? uuid.parse(url.searchParams.get("focus"))
              : null,
          ),
        );
      if (p.length === 5 && p[4] === "replies" && m === "GET")
        return json(await replyPage(db, bike, uuid.parse(p[3]), user, page()));
      if (p.length === 3 && m === "POST") {
        if (!user) return fail("Войдите, чтобы обсудить велосипед", 401);
        await limited("comments", limits.comments);
        const input = commentInput.parse(await readJson(req, 8192));
        return json(
          await transaction((q) => createComment(q, bike, user, input)),
          201,
        );
      }
    }
    if (p[0] === "feed" && p.length === 1 && m === "GET") {
      const type = url.searchParams.get("type") || "all",
        mode = url.searchParams.get("mode") || "following";
      if (
        !["all", "rides", "journal"].includes(type) ||
        !["new", "following"].includes(mode)
      )
        return fail("Неизвестный режим");
      if (!user && !(type === "journal" && mode === "new"))
        return fail("Войдите в аккаунт", 401);
      return json(await rideFeed(db, user?.id || null, page(), type, mode));
    }
    if (p[0] === "bikes" && p.length === 3 && p[2] === "follow" && m === "GET")
      return json(await bikeFollowing(db, uuid.parse(p[1]), user?.id || null));
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p[0] === "saved" && p.length === 1 && m === "GET")
      return json(await savedPage(db, user.id, page()));
    if (
      p[0] === "bikes" &&
      p.length === 3 &&
      p[2] === "follow" &&
      ["PUT", "DELETE"].includes(m)
    ) {
      await limited("bike-follow", 30);
      return json(
        await transaction((q) =>
          setBikeFollow(q, uuid.parse(p[1]), user.id, m === "PUT"),
        ),
      );
    }
    if (
      p[0] === "comments" &&
      p.length === 2 &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      await limited("comment-edit", limits.commentEdits);
      const id = uuid.parse(p[1]),
        body =
          m === "PATCH"
            ? commentEdit.parse(await readJson(req, 8192)).body
            : null;
      return json(
        await transaction(async (q) => {
          const result = await changeComment(q, id, user, body);
          if (user.role === "admin" && m === "DELETE")
            await audit(q, user.id, "community.comment.delete", id);
          return result;
        }),
      );
    }
    if (p[0] === "notifications") {
      // Reading notifications is when the site notices a listing's term
      // ending (#116); the header asks for the count on every page.
      if (m === "GET") await noticeExpiringListings(db, user.id);
      if (p.length === 1 && m === "GET")
        return json(await notificationPage(db, user.id, page()));
      if (p.length === 2 && p[1] === "count" && m === "GET")
        return json(await unreadCount(db, user.id));
      if (p.length === 2 && p[1] === "read-all" && m === "PATCH") {
        await limited("notification-read", limits.notificationReads);
        await readNotifications(db, user.id);
        return json({ ok: true });
      }
      if (p.length === 3 && p[2] === "read" && m === "PATCH") {
        await limited("notification-read", limits.notificationReads);
        return (await readNotifications(db, user.id, uuid.parse(p[1])))
          ? json({ ok: true })
          : fail("Уведомление недоступно", 404);
      }
    }
    if (p.length === 1 && p[0] === "reports" && m === "POST") {
      await limited("reports", limits.reports);
      const input = reportInput.parse(await readJson(req, 8192));
      return json(await transaction((q) => createReport(q, user, input)));
    }
    if (p[0] === "admin" && p[1] === "reports") {
      if (user.role !== "admin")
        return fail("Доступ только для администратора", 403);
      if (p.length === 2 && m === "GET") {
        const status = url.searchParams.get("status") || "open";
        if (!["open", "closed"].includes(status))
          return fail("Неверный статус");
        return json(await reportPage(db, page(), status));
      }
      if (p.length === 3 && m === "PATCH") {
        const action = reportAction.parse(await readJson(req, 2048)).action;
        return json(
          await transaction((q) =>
            moderateReport(q, uuid.parse(p[2]), user, action),
          ),
        );
      }
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail("Проверьте поля. Текст — от 1 до 1000 символов.");
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Слишком большой запрос", 413);
    if (e.message === "Пустой запрос") return fail("Пустой запрос");
    logError("community_request_failed", e);
    return fail("Не удалось выполнить запрос", 500);
  }
}
export const GET = traced(handler),
  PUT = traced(handler),
  POST = traced(handler),
  PATCH = traced(handler),
  DELETE = traced(handler);
