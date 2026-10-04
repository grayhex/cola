import { db, transaction } from "../db.ts";
import { CommunityError } from "../community-validation.ts";
import { limits } from "../limits.ts";
import {
  decodeWatermark,
  markNotificationsRead,
  unreadCount,
} from "../notifications.ts";
import {
  notificationSettings,
  notificationSettingsPatch,
  saveNotificationSettings,
  type NotificationSettings,
} from "../notification-settings.ts";
import { ApiError } from "./errors.ts";
import { idOf } from "./journal-handlers.ts";
import { toNotificationSettings } from "./mappers.ts";
import { signedIn } from "./personal-handlers.ts";
import { checkIfMatch, etagOf, parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  notificationReadAllRequestSchema,
  notificationReadRequestSchema,
  parseNoQuery,
} from "./schemas.ts";
import { limited, writer } from "./write.ts";

// What a person does with their notifications (#341): marks them read, and
// reads and changes what they want to be told about. The services are the
// site's, so the site and the app share one read-state and one set of choices,
// and the budgets are the site's too (one window for both transports). Reading
// is the only fact the server keeps about a notice: fetching a list, showing a
// notification and swiping it away mark nothing.

type IdParams = { params: Promise<{ id: string }> };

async function readResult(userId: string, marked: number) {
  const state = await unreadCount(db, userId);
  return ok({ marked, unread: state.unread, capped: state.capped });
}

/** PUT /api/v1/me/notifications/{id}/read */
export function handleNotificationRead(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Уведомление не найдено.");
    await limited("notification-read:" + viewer.id, limits.notificationReads);
    const result = await markNotificationsRead(db, viewer.id, { ids: [id] });
    // Someone else's, not yet delivered and unknown are the same answer.
    if (!result.found)
      throw new ApiError("not_found", "Уведомление не найдено.");
    return readResult(viewer.id, result.marked);
  });
}

/** POST /api/v1/me/notifications/read */
export function handleNotificationsRead(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    await limited("notification-read:" + viewer.id, limits.notificationReads);
    const body = await parseJsonBody(req, notificationReadRequestSchema, 8192);
    // An id that is not the person's is not an error: it is simply not counted.
    const result = await markNotificationsRead(db, viewer.id, {
      ids: body.ids,
    });
    return readResult(viewer.id, result.marked);
  });
}

/** POST /api/v1/me/notifications/read-all */
export function handleNotificationsReadAll(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    await limited("notification-read:" + viewer.id, limits.notificationReads);
    const body = await parseJsonBody(
      req,
      notificationReadAllRequestSchema,
      1024,
    );
    const mark = decodeWatermark(body.watermark);
    if (!mark)
      throw new ApiError("invalid_request", "Проверьте поля запроса.", {
        details: [
          {
            path: "watermark",
            message:
              "Отметка не распознана: возьмите её из списка или счётчика уведомлений.",
          },
        ],
      });
    const result = await markNotificationsRead(db, viewer.id, {
      upTo: mark,
      ...(body.category ? { category: body.category } : {}),
    });
    return readResult(viewer.id, result.marked);
  });
}

/** The settings and the version they carry (`ETag`) as one response. */
function settingsResponse(userId: string, settings: NotificationSettings) {
  return ok(toNotificationSettings(settings), 200, {
    ETag: etagOf("notification-settings", userId, settings.version),
  });
}
/** The services answer with their own statuses; here they are the API's codes. */
function refused(error: CommunityError) {
  if (error.status === 403)
    return new ApiError("email_verification_required", error.message);
  if (error.status === 404) return new ApiError("not_found", error.message);
  if (error.status === 503)
    return new ApiError("service_unavailable", error.message);
  return new ApiError("invalid_request", error.message);
}

/** GET /api/v1/me/notification-settings */
export function handleNotificationSettings(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    parseNoQuery(new URL(req.url));
    try {
      return settingsResponse(
        viewer.id,
        await notificationSettings(db, viewer.id),
      );
    } catch (error) {
      if (error instanceof CommunityError) throw refused(error);
      throw error;
    }
  });
}

/**
 * PATCH /api/v1/me/notification-settings. Only what is given changes, so two
 * devices changing different switches do not undo each other; `If-Match` is
 * accepted for a client that wants its change to apply to the version it saw
 * (412 when it is not current), but it is not required.
 */
export function handleNotificationSettingsUpdate(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    // The budget of the site's own settings form: one window for both.
    await limited("notification-preferences:" + viewer.id, 30);
    const patch = await parseJsonBody(req, notificationSettingsPatch, 4096);
    try {
      const saved = await transaction((q) =>
        saveNotificationSettings(q, viewer.id, patch, {
          precondition: (version) =>
            checkIfMatch(
              req.headers,
              etagOf("notification-settings", viewer.id, version),
              { required: false },
            ),
        }),
      );
      return settingsResponse(viewer.id, saved);
    } catch (error) {
      if (error instanceof CommunityError) throw refused(error);
      throw error;
    }
  });
}
