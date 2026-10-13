import { ZodError } from "zod";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import {
  json,
  fail,
  sameOrigin,
  readJson,
  readBytes,
} from "../../../../lib/http.ts";
import { uuid } from "../../../../lib/validation.ts";
import {
  CommunityError,
  communityPage,
  commentInput,
  commentEdit,
} from "../../../../lib/community-validation.ts";
import { EmailPolicyError } from "../../../../lib/email-policy.ts";
import {
  clubPostList,
  clubPostDetail,
  postByRequest,
  createClubPost,
  editClubPost,
  deleteClubPost,
  moderateClubPost,
  clubPostCreateInput,
  clubPostEditInput,
  clubPostModerationInput,
} from "../../../../lib/club-posts.ts";
import { clubPostSocial } from "../../../../lib/club-post-social.ts";
import {
  saveClubPostPhoto,
  deleteClubPostPhoto,
} from "../../../../lib/club-post-storage.ts";
import { clubPostMedia } from "../media.ts";
import { mediaBusyResponse } from "../../../../lib/media-cache.ts";
import { preparePhoto } from "../../../../lib/images.ts";
import { limits, QuotaError } from "../../../../lib/limits.ts";
import { logError, traced } from "../../../../lib/observability.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
async function handler(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const p = (await params).path || [],
      url = new URL(req.url),
      m = req.method,
      user = await currentUser(),
      page = () => communityPage.parse(url.searchParams.get("page") || 1);
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const club = async (id: string) => {
      const row = (
        await db.query<{ club_id: string }>(
          "SELECT club_id FROM club_posts WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw new CommunityError("Публикация недоступна", 404);
      return row.club_id;
    };
    if (m === "GET") {
      if (!p.length) {
        const id = uuid.parse(url.searchParams.get("clubId"));
        if (url.searchParams.has("requestId"))
          return user
            ? json({
                post: await postByRequest(
                  db,
                  id,
                  user.id,
                  uuid.parse(url.searchParams.get("requestId")),
                ),
              })
            : fail("Войдите в аккаунт", 401);
        return json(
          await clubPostList(db, id, user?.id || null, {
            page: page(),
            own: url.searchParams.get("own") === "1",
          }),
        );
      }
      const id = uuid.parse(p[0]);
      if (p.length === 1)
        return json({
          post: await clubPostDetail(db, await club(id), id, user?.id),
        });
      if (p.length === 3 && p[1] === "media")
        return await clubPostMedia(
          req,
          await club(id),
          id,
          uuid.parse(p[2]),
          user?.id || null,
        );
      if (p.length === 2 && p[1] === "comments")
        return json(
          await clubPostSocial.page(
            db,
            id,
            user,
            page(),
            url.searchParams.has("focus")
              ? uuid.parse(url.searchParams.get("focus"))
              : null,
          ),
        );
      if (p.length === 4 && p[1] === "comments" && p[3] === "replies")
        return json(
          await clubPostSocial.replies(db, id, uuid.parse(p[2]), user, page()),
        );
      return fail("Не найдено", 404);
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    const photo = p[1] === "photos",
      comment = p[0] === "comments" || p[1] === "comments";
    if (
      !(await rateLimit(
        (photo ? "photo-upload" : comment ? "comments" : "club-post-write") +
          ":" +
          user.id,
        photo ? limits.photoUploads : 20,
      ))
    )
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (!p.length && m === "POST") {
      const input = clubPostCreateInput.parse(await readJson(req, 100000)),
        c = uuid.parse(url.searchParams.get("clubId"));
      return json(
        {
          post: await transaction((q) => createClubPost(q, c, user.id, input)),
        },
        201,
      );
    }
    if (
      p.length === 2 &&
      p[0] === "comments" &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      const body =
        m === "DELETE"
          ? null
          : commentEdit.parse(await readJson(req, 8192)).body;
      return json(
        await transaction((q) =>
          clubPostSocial.change(q, uuid.parse(p[1]), user, body),
        ),
      );
    }
    const id = uuid.parse(p[0]);
    if (p.length === 1 && m === "PATCH") {
      const input = clubPostEditInput.parse(await readJson(req, 100000));
      return json({
        post: await transaction(async (q) =>
          editClubPost(q, await club(id), id, user.id, input),
        ),
      });
    }
    if (p.length === 1 && m === "DELETE")
      return json(
        await transaction(async (q) =>
          deleteClubPost(q, await club(id), id, user.id),
        ),
      );
    if (p.length === 2 && p[1] === "moderation" && m === "POST") {
      const input = clubPostModerationInput.parse(await readJson(req, 8192));
      return json(
        await transaction(async (q) =>
          moderateClubPost(q, await club(id), id, user.id, input),
        ),
      );
    }
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      const input = commentInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) => clubPostSocial.create(q, id, user, input)),
        201,
      );
    }
    if (p.length === 2 && p[1] === "like" && ["PUT", "DELETE"].includes(m))
      return json(
        await transaction((q) =>
          clubPostSocial.like(q, id, user.id, m === "PUT"),
        ),
      );
    if (p.length === 2 && p[1] === "photos" && m === "POST") {
      const c = await club(id),
        post = await clubPostDetail(db, c, id, user.id);
      if (!post.canEdit)
        return fail("Фото добавляет только действующий участник — автор", 403);
      const request = uuid.parse(url.searchParams.get("requestId")),
        source = await readBytes(req, limits.fileBytes);
      let bytes: Buffer;
      try {
        bytes = await preparePhoto(source, { bikePhoto: false });
      } catch {
        throw new CommunityError(
          "Не удалось прочитать изображение. Используйте JPEG, PNG или WebP до 40 Мп.",
        );
      }
      return json(
        await saveClubPostPhoto(transaction, c, id, user.id, request, bytes),
        201,
      );
    }
    if (p.length === 3 && p[1] === "photos" && m === "DELETE")
      return json(
        await transaction(async (q) =>
          deleteClubPostPhoto(q, await club(id), id, uuid.parse(p[2]), user.id),
        ),
      );
    return fail("Не найдено", 404);
  } catch (error) {
    const busy = mediaBusyResponse(error);
    if (busy) return busy;
    if (error instanceof EmailPolicyError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof CommunityError || error instanceof QuotaError)
      return fail(error.message, error.status);
    if (error instanceof ZodError || error instanceof SyntaxError)
      return fail("Проверьте поля публикации");
    if (error instanceof Error && error.message === "UNSUPPORTED_IMAGE")
      return fail("Используйте JPEG, PNG или WebP");
    if (
      error instanceof Error &&
      error.message === "Превышен допустимый размер запроса"
    )
      return fail("Файл или текст слишком большой", 413);
    logError("club_post_failed", error);
    return fail("Не удалось обработать публикацию", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PATCH = route,
  PUT = route,
  DELETE = route;
