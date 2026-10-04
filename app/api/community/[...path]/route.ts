import { errorMessage } from "../../../../lib/errors.ts";
import { z, ZodError } from "zod";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../../lib/email-policy.ts";
import { rideFeed } from "../../../../lib/ride-feed.ts";
import {
  bikeFollowing,
  setBikeFollow,
  savedPage,
} from "../../../../lib/journal-discovery.ts";
import { audit } from "../../../../lib/site.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import {
  json,
  fail,
  sameOrigin,
  readBytes,
  readJson,
} from "../../../../lib/http.ts";
import { traced, logError } from "../../../../lib/observability.ts";
import { uuid } from "../../../../lib/validation.ts";
import { limits } from "../../../../lib/limits.ts";
import {
  CommunityError,
  commentInput,
  commentEdit,
  reportInput,
  reportAction,
  communityPage,
} from "../../../../lib/community-validation.ts";
import {
  commentPage,
  replyPage,
  createComment,
  changeComment,
} from "../../../../lib/comments.ts";
import {
  decodeWatermark,
  inboxState,
  inboxWatermark,
  markNotificationsRead,
  notificationPage,
  readNotifications,
  unreadCount,
} from "../../../../lib/notifications.ts";
import { notificationCategoryKeys } from "../../../../lib/notification-catalog.ts";
import { noticeExpiringListings } from "../../../../lib/market.ts";
import {
  createReport,
  reportPage,
  moderateReport,
} from "../../../../lib/reports.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Read all" of the site (#341): the mark of the list the page showed, and
// optionally one category.
const readAllInput = z.strictObject({
  watermark: z.string().min(1).max(300).optional(),
  category: z.enum(notificationCategoryKeys).optional(),
});

async function handler(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: p } = await params,
      m = req.method,
      url = new URL(req.url);
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser(),
      page = () => communityPage.parse(url.searchParams.get("page") || 1);
    async function limited(key: string, max: number) {
      // Calls below are behind the authenticated-user guard.
      if (!(await rateLimit(key + ":" + user!.id, max)))
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
        requireVerifiedEmail(user);
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
      if (m === "PATCH") requireVerifiedEmail(user);
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
        return json(await inboxState(db, user.id));
      if (p.length === 2 && p[1] === "read-all" && m === "PATCH") {
        await limited("notification-read", limits.notificationReads);
        // The page sends the mark of the list it showed (#341): what arrived
        // after it stays unread. Without a body (an older page) it is
        // everything there is now.
        let bytes = Buffer.alloc(0);
        try {
          bytes = await readBytes(req, 1024);
        } catch (error) {
          if (errorMessage(error) !== "Пустой запрос") throw error;
        }
        const body = readAllInput.safeParse(
          bytes.length ? JSON.parse(bytes.toString()) : {},
        );
        if (!body.success) return fail("Проверьте запрос", 400);
        const mark = body.data.watermark
          ? decodeWatermark(body.data.watermark)
          : await inboxWatermark(db, user.id);
        if (body.data.watermark && !mark)
          return fail("Отметка не распознана. Обновите список.", 400);
        if (mark)
          await markNotificationsRead(db, user.id, {
            upTo: mark,
            ...(body.data.category ? { category: body.data.category } : {}),
          });
        return json({ ok: true, ...(await unreadCount(db, user.id)) });
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
    if (e instanceof EmailPolicyError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e instanceof ZodError || e instanceof SyntaxError)
      return fail("Проверьте поля. Текст — от 1 до 1000 символов.");
    if (errorMessage(e) === "Превышен допустимый размер запроса")
      return fail("Слишком большой запрос", 413);
    if (errorMessage(e) === "Пустой запрос") return fail("Пустой запрос");
    logError("community_request_failed", e);
    return fail("Не удалось выполнить запрос", 500);
  }
}
export const GET = traced(handler),
  PUT = traced(handler),
  POST = traced(handler),
  PATCH = traced(handler),
  DELETE = traced(handler);
