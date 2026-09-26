import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import {
  json,
  fail,
  sameOrigin,
  readJson,
  readBytes,
} from "../../../../lib/http.js";
import { uuid } from "../../../../lib/validation.js";
import { limits, QuotaError } from "../../../../lib/limits.js";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../../lib/email-policy.js";
import {
  CommunityError,
  communityPage,
  commentInput,
  commentEdit,
} from "../../../../lib/community-validation.js";
import {
  componentCatalog,
  componentCatalogInput,
} from "../../../../lib/component-catalog.js";
import { componentSocial } from "../../../../lib/component-social.js";
import {
  componentGallery,
  authorizeComponentPhoto,
  saveComponentPhoto,
  changeComponentPhoto,
  changeComponentGallery,
  componentPhotoEdit,
  componentGalleryEdit,
  componentPhotoFilename,
  readComponentPhotoFile,
  cleanupComponentPhotos,
} from "../../../../lib/component-photos.js";
import { preparePhoto } from "../../../../lib/images.js";
import {
  mediaWidth,
  mediaEtag,
  notModified,
  notModifiedResponse,
  mediaResponse,
  mediaVariant,
} from "../../../../lib/media-cache.js";
import { audit } from "../../../../lib/site.js";
import { traced, logError } from "../../../../lib/observability.js";

export const runtime = "nodejs",
  dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const p = (await params).path || [],
      m = req.method,
      url = new URL(req.url);
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser();
    const page = () => communityPage.parse(url.searchParams.get("page") || 1);
    if (m === "GET") {
      if (!p.length)
        return json(
          await componentCatalog(
            db,
            componentCatalogInput.parse(Object.fromEntries(url.searchParams)),
          ),
        );
      if (p[0] === "media" && p.length === 2) {
        const id = uuid.parse(p[1]),
          width = mediaWidth(url.searchParams.get("width"));
        if (width === undefined) return fail("Неверный размер изображения");
        const filename = await componentPhotoFilename(db, id, user);
        const etag = mediaEtag(id, width),
          headers = { Vary: "Cookie" };
        if (notModified(req, etag))
          return notModifiedResponse(etag, { headers });
        const original = () => readComponentPhotoFile(filename);
        return mediaResponse(
          width ? await mediaVariant(id, width, original) : await original(),
          etag,
          { headers },
        );
      }
      if (p.length === 2 && p[1] === "photos")
        return json(await componentGallery(db, uuid.parse(p[0]), user));
      if (p.length === 2 && p[1] === "comments")
        return json(
          await componentSocial.page(
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
          await componentSocial.replies(
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
          : m === "POST"
            ? "photo-upload"
            : "component-photo-edit";
    const max =
      key === "comments"
        ? limits.comments
        : key === "photo-upload"
          ? limits.photoUploads
          : limits.commentEdits;
    if (!(await rateLimit(key + ":" + user.id, max)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      requireVerifiedEmail(user);
      const input = commentInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          componentSocial.create(q, uuid.parse(p[0]), user, input),
        ),
        201,
      );
    }
    if (
      p[0] === "comments" &&
      p.length === 2 &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      if (m === "PATCH") requireVerifiedEmail(user);
      const id = uuid.parse(p[1]),
        body =
          m === "PATCH"
            ? commentEdit.parse(await readJson(req, 8192)).body
            : null;
      return json(
        await transaction(async (q) => {
          const result = await componentSocial.change(q, id, user, body);
          if (m === "DELETE" && user.role === "admin")
            await audit(q, user.id, "community.component_comment.delete", id);
          return result;
        }),
      );
    }
    if (p.length === 2 && p[1] === "photos" && m === "POST") {
      requireVerifiedEmail(user);
      const id = uuid.parse(p[0]);
      await authorizeComponentPhoto(db, id, user);
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(
          req.headers.get("content-type"),
        )
      )
        return fail("Поддерживаются JPEG, PNG и WebP");
      const raw = await readBytes(req, limits.fileBytes);
      let bytes;
      try {
        bytes = await preparePhoto(raw);
      } catch (e) {
        return fail(
          e.message?.startsWith("Фото слишком")
            ? e.message
            : "Не удалось прочитать изображение",
        );
      }
      return json(await saveComponentPhoto(transaction, id, user, bytes), 201);
    }
    if (p.length === 2 && p[1] === "photos" && m === "PATCH") {
      const input = componentGalleryEdit.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          changeComponentGallery(q, uuid.parse(p[0]), user, input),
        ),
      );
    }
    if (
      p.length === 3 &&
      p[1] === "photos" &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      const input =
        m === "PATCH"
          ? componentPhotoEdit.parse(await readJson(req, 4096))
          : null;
      const result = await transaction((q) =>
        changeComponentPhoto(
          q,
          uuid.parse(p[0]),
          uuid.parse(p[2]),
          user,
          input,
        ),
      );
      if (m === "DELETE") await cleanupComponentPhotos(db);
      return json(result);
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof EmailPolicyError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof CommunityError || e instanceof QuotaError)
      return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail("Проверьте поля запроса");
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Слишком большой запрос", 413);
    if (e.message === "Пустой запрос") return fail("Выберите файл");
    logError("component_community_failed", e);
    return fail("Не удалось выполнить запрос", 500);
  }
}
export const GET = traced(handler),
  POST = traced(handler),
  PATCH = traced(handler),
  DELETE = traced(handler);
