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
  commentInput,
  commentEdit,
  communityPage,
} from "../../../../lib/community-validation.js";
import { RideError } from "../../../../lib/ride-gpx.js";
import {
  importGarmin,
  garminImportInput,
  planRide,
  planInput,
  attachRideTrack,
  respondRideInvitation,
  cancelPlannedRide,
  rideSettings,
  rideSettingsInput,
  previewRide,
  saveRide,
  deleteRide,
  rideDetail,
  rideList,
  rideInput,
  rideEdit,
} from "../../../../lib/rides.js";
import { parseGarminCsv } from "../../../../lib/garmin-csv.js";
import { z } from "zod";
import { cleanupRides } from "../../../../lib/ride-storage.js";
import {
  rideCommentPage,
  rideReplyPage,
  createRideComment,
  changeRideComment,
  likeRide,
} from "../../../../lib/ride-comments.js";
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
    const config = await rideSettings(db),
      page = () => communityPage.parse(url.searchParams.get("page") || 1);
    if (p[0] === "settings" && p.length === 1) {
      if (m === "GET") return json(config);
      if (user?.role !== "admin")
        return fail("Доступ только для администратора", 403);
      if (m === "PATCH") {
        const value = rideSettingsInput.parse(await readJson(req, 4096));
        await db.query("UPDATE ride_settings SET value=$1 WHERE id=1", [
          JSON.stringify(value),
        ]);
        return json(value);
      }
    }
    if (p[0] === "public" && p.length === 2 && m === "GET")
      return json({ ride: await rideDetail(db, uuid.parse(p[1]), user?.id) });
    if (!p.length && m === "GET") {
      const own = url.searchParams.get("own") === "1";
      if (own && !user) return fail("Войдите в аккаунт", 401);
      return json(
        await rideList(db, user?.id, {
          own,
          status: z
            .enum(["completed", "planned", "cancelled"])
            .nullable()
            .parse(url.searchParams.get("status")),
          username: url.searchParams.get("username"),
          bikeId: url.searchParams.has("bikeId")
            ? uuid.parse(url.searchParams.get("bikeId"))
            : null,
          page: page(),
        }),
      );
    }
    if (p.length >= 2 && p[1] === "comments" && m === "GET") {
      const id = uuid.parse(p[0]);
      if (p.length === 2)
        return json(
          await rideCommentPage(
            db,
            id,
            user,
            page(),
            url.searchParams.has("focus")
              ? uuid.parse(url.searchParams.get("focus"))
              : null,
          ),
        );
      if (p.length === 4 && p[3] === "replies")
        return json(
          await rideReplyPage(db, id, uuid.parse(p[2]), user, page()),
        );
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p[0] === "owner" && p.length === 2 && m === "GET")
      return json({
        ride: await rideDetail(db, uuid.parse(p[1]), user.id, true),
      });
    const key =
      ["preview", "import", "csv-preview"].includes(p[0]) || p[1] === "track"
        ? "ride-upload"
        : p[1] === "comments"
          ? "comments"
          : p[0] === "comments"
            ? "comment-edit"
            : "ride-write";
    if (
      !(await rateLimit(
        key + ":" + user.id,
        key === "ride-upload" ? config.uploadRate : 20,
      ))
    )
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (p[0] === "csv-preview" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const body = z
        .object({
          csv: z.string().max(2 * 1024 * 1024),
          utcOffsetMinutes: z.number().int().min(-720).max(840),
          units: z.enum(["metric", "imperial"]),
        })
        .strict()
        .parse(await readJson(req, 3 * 1024 * 1024));
      return json(parseGarminCsv(body.csv, body));
    }
    if (p[0] === "import" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const input = garminImportInput.parse(
        await readJson(req, 3 * 1024 * 1024),
      );
      const parsed = parseGarminCsv(input.csv, input);
      return json(
        await transaction((q) =>
          importGarmin(q, user.id, input, parsed, config),
        ),
        201,
      );
    }
    if (p[0] === "plan" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const input = planInput.parse(await readJson(req, 16384));
      const result = await transaction((q) =>
        planRide(q, user.id, input, config),
      );
      await cleanupRides(db).catch(() => {});
      return json(result, 201);
    }
    if (p.length === 2 && p[1] === "track" && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const bytes = await readBytes(req, config.maxGpxBytes);
      return json(
        await transaction((q) =>
          attachRideTrack(q, user.id, uuid.parse(p[0]), bytes, config),
        ),
      );
    }
    if (p.length === 2 && p[1] === "invitation" && m === "PATCH") {
      const input = z
        .object({ response: z.enum(["accepted", "declined"]) })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          respondRideInvitation(q, uuid.parse(p[0]), user.id, input.response),
        ),
      );
    }
    if (p.length === 2 && p[1] === "cancel" && m === "POST")
      return json(
        await transaction((q) =>
          cancelPlannedRide(q, uuid.parse(p[0]), user.id),
        ),
      );
    if (p[0] === "preview" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const bytes = await readBytes(req, config.maxGpxBytes);
      return json(
        await transaction((q) =>
          previewRide(q, user.id, bytes, config, {
            planned: url.searchParams.get("purpose") === "plan",
          }),
        ),
        201,
      );
    }
    if (!p.length && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const input = rideInput.parse(await readJson(req, 16384));
      const result = await transaction((q) =>
        saveRide(q, user.id, input, config),
      );
      await cleanupRides(db).catch(() => {});
      return json(result, 201);
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
          changeRideComment(q, uuid.parse(p[1]), user, body),
        ),
      );
    }
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      const input = commentInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          createRideComment(q, uuid.parse(p[0]), user, input),
        ),
        201,
      );
    }
    if (p.length === 2 && p[1] === "like" && ["PUT", "DELETE"].includes(m))
      return json(
        await transaction((q) =>
          likeRide(q, uuid.parse(p[0]), user.id, m === "PUT"),
        ),
      );
    if (p.length === 1 && m === "PATCH") {
      const input = rideEdit.parse(await readJson(req, 16384));
      return json(
        await transaction((q) =>
          saveRide(q, user.id, input, config, uuid.parse(p[0])),
        ),
      );
    }
    if (p.length === 1 && m === "DELETE") {
      const result = await transaction((q) =>
        deleteRide(q, user.id, uuid.parse(p[0])),
      );
      await cleanupRides(db).catch(() => {});
      return json(result);
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof RideError || e instanceof CommunityError)
      return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail("Проверьте поля запроса");
    if (e.code === "23505") return fail("Эта покатушка уже загружена", 409);
    if (e.message === "Превышен допустимый размер запроса")
      return fail("GPX-файл слишком большой", 413);
    return fail("Не удалось обработать покатушку", 500);
  }
}
export const GET = handler,
  POST = handler,
  PATCH = handler,
  DELETE = handler,
  PUT = handler;
