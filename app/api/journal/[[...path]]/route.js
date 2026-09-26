import { requireVerifiedEmail, EmailPolicyError } from "../../../../lib/email-policy.js";
import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import {
  json,
  fail,
  readJson,
  readBytes,
  sameOrigin,
} from "../../../../lib/http.js";
import { uuid } from "../../../../lib/validation.js";
import {
  CommunityError,
  communityPage,
  commentInput,
  commentEdit,
} from "../../../../lib/community-validation.js";
import {
  journalInput,
  journalDetail,
  journalList,
  saveJournal,
  deleteJournal,
  journalBikeLock,
} from "../../../../lib/journal.js";
import { journalSocial } from "../../../../lib/journal-social.js";
import { setSaved, setSolution } from "../../../../lib/journal-discovery.js";
import { preparePhoto } from "../../../../lib/images.js";
import { limits, QuotaError } from "../../../../lib/limits.js";
import {
  saveJournalPhoto,
  journalPhotoFilename,
  readJournalPhotoFile,
  cleanupJournalPhotos,
} from "../../../../lib/journal-storage.js";
import {
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.js";
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
      if (p[0] === "media" && p.length === 2) {
        const id = uuid.parse(p[1]),
          width = mediaWidth(url.searchParams.get("width"));
        if (width === undefined) return fail("Неверный размер изображения");
        // Access is checked on every request, including revalidation.
        const filename = await journalPhotoFilename(db, id, user?.id),
          etag = mediaEtag(id, width),
          headers = { Vary: "Cookie" };
        if (notModified(req, etag))
          return notModifiedResponse(etag, { headers });
        const original = () => readJournalPhotoFile(filename);
        return mediaResponse(
          width ? await mediaVariant(id, width, original) : await original(),
          etag,
          { headers },
        );
      }
      if (!p.length)
        return json(
          await journalList(
            db,
            uuid.parse(url.searchParams.get("bikeId")),
            user?.id,
            page(),
          ),
        );
      if (p[0] === "public" && p.length === 2)
        return json({
          entry: await journalDetail(db, uuid.parse(p[1]), user?.id),
        });
      if (p.length === 2 && p[1] === "comments")
        return json(
          await journalSocial.page(
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
          await journalSocial.replies(
            db,
            uuid.parse(p[0]),
            uuid.parse(p[2]),
            user,
            page(),
          ),
        );
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (m === "GET") return fail("Не найдено", 404);
    const key =
      p[1] === "comments"
        ? "comments"
        : p[0] === "comments"
          ? "comment-edit"
          : p[1] === "photos"
            ? "photo-upload"
            : "journal-write";
    if (
      !(await rateLimit(
        key + ":" + user.id,
        key === "photo-upload" ? limits.photoUploads : 20,
      ))
    )
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (!p.length && m === "POST") {
      const input = journalInput.parse(await readJson(req, 100000));
      if (input.status === "published" && input.isPublic) requireVerifiedEmail(user);
      return json(
        await transaction((q) => saveJournal(q, user.id, input)),
        201,
      );
    }
    if (p.length === 2 && p[1] === "save" && ["PUT", "DELETE"].includes(m))
      return json(
        await transaction((q) =>
          setSaved(q, uuid.parse(p[0]), user.id, m === "PUT"),
        ),
      );
    if (p.length === 2 && p[1] === "solution" && m === "PUT") {
      const input = await readJson(req, 2048);
      const comment = uuid.nullable().parse(input?.commentId);
      return json(
        await transaction((q) =>
          setSolution(q, uuid.parse(p[0]), user.id, comment),
        ),
      );
    }
    if (p.length === 1 && m === "PATCH") {
      const input = journalInput.parse(await readJson(req, 100000));
      if (input.status === "published" && input.isPublic) requireVerifiedEmail(user);
      return json(
        await transaction((q) =>
          saveJournal(q, user.id, input, uuid.parse(p[0])),
        ),
      );
    }
    if (p.length === 1 && m === "DELETE") {
      const r = await transaction((q) =>
        deleteJournal(q, uuid.parse(p[0]), user.id),
      );
      await cleanupJournalPhotos(db);
      return json(r);
    }
    if (p.length === 2 && p[1] === "photos" && m === "POST") {
      // Authorize before decoding an image; quota is reserved again under owner lock.
      const id = uuid.parse(p[0]);
      const entry = (await db.query(
        "SELECT status,is_public FROM journal_entries WHERE id=$1 AND owner_id=$2",
        [id, user.id],
      )).rows[0];
      if (!entry) return fail("Запись недоступна", 404);
      if (entry.status === "published" && entry.is_public) requireVerifiedEmail(user);
      const bytes = await preparePhoto(await readBytes(req, limits.fileBytes), {
        bikePhoto: false,
      });
      return json(await saveJournalPhoto(transaction, id, user.id, bytes), 201);
    }
    if (p.length === 3 && p[1] === "photos" && m === "DELETE") {
      await transaction(async (q) => {
        const e = (
          await q.query(
            "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
            [uuid.parse(p[0]), user.id],
          )
        ).rows[0];
        if (!e) throw new CommunityError("Запись недоступна", 404);
        await journalBikeLock(q, e.bike_id, user.id);
        if (
          !(
            await q.query(
              "DELETE FROM journal_photos WHERE id=$1 AND entry_id=$2",
              [uuid.parse(p[2]), p[0]],
            )
          ).rowCount
        )
          throw new CommunityError("Изображение недоступно", 404);
      });
      await cleanupJournalPhotos(db);
      return json({ ok: true });
    }
    if (
      p[0] === "comments" &&
      p.length === 2 &&
      ["PATCH", "DELETE"].includes(m)
    ) {
      if (m === "PATCH") requireVerifiedEmail(user);
      const body =
        m === "PATCH"
          ? commentEdit.parse(await readJson(req, 8192)).body
          : null;
      return json(
        await transaction((q) =>
          journalSocial.change(q, uuid.parse(p[1]), user, body),
        ),
      );
    }
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      requireVerifiedEmail(user);
      const input = commentInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          journalSocial.create(q, uuid.parse(p[0]), user, input),
        ),
        201,
      );
    }
    if (p.length === 2 && p[1] === "like" && ["PUT", "DELETE"].includes(m))
      return json(
        await transaction((q) =>
          journalSocial.like(q, uuid.parse(p[0]), user.id, m === "PUT"),
        ),
      );
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof EmailPolicyError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof CommunityError || e instanceof QuotaError)
      return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail(
        "Проверьте поля записи: для публикации нужны заголовок и текст",
      );
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Файл или текст слишком большой", 413);
    if (
      e.message === "UNSUPPORTED_IMAGE" ||
      /Input buffer|unsupported image|pixel limit/i.test(e.message)
    )
      return fail("Нужна фотография JPEG, PNG или WebP");
    logError("journal_failed", e);
    return fail("Не удалось обработать запись", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PATCH = route,
  DELETE = route,
  PUT = route;
