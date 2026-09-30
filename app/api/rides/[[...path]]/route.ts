import { errorCode, errorMessage } from "../../../../lib/errors.ts";
import { ZodError } from "zod";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../../lib/email-policy.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import {
  json,
  fail,
  readJson,
  readBytes,
  sameOrigin,
} from "../../../../lib/http.ts";
import { uuid } from "../../../../lib/validation.ts";
import { logError, traced } from "../../../../lib/observability.ts";
import {
  CommunityError,
  commentInput,
  commentEdit,
  communityPage,
} from "../../../../lib/community-validation.ts";
import { RideError } from "../../../../lib/ride-gpx.ts";
import {
  importGarmin,
  garminImportInput,
  planRide,
  planInput,
  attachRideTrack,
  respondRideInvitation,
  respondRide,
  cancelPlannedRide,
  setRideRecruitment,
  rideSettings,
  rideSettingsInput,
  previewRide,
  previewParse,
  saveRide,
  deleteRide,
  rideDetail,
  refreshRideAnalysis,
  rideList,
  rideInput,
  rideEdit,
} from "../../../../lib/rides.ts";
import { parseGarminCsv } from "../../../../lib/garmin-csv.ts";
import { z } from "zod";
import { ridePlanOptions } from "../../../../lib/ride-plan-options.ts";
import { collectRideFiles } from "../../../../lib/ride-storage.ts";
import {
  rideCommentPage,
  rideReplyPage,
  createRideComment,
  changeRideComment,
  likeRide,
} from "../../../../lib/ride-comments.ts";
// Public filters of upcoming plans (#233); ignored for other statuses.
const planFilterKeys = [
  "from",
  "to",
  "pace",
  "purpose",
  "surface",
  "durationMin",
  "durationMax",
  "area",
];
const planChoice = (key: keyof typeof ridePlanOptions) =>
  z.enum(Object.keys(ridePlanOptions[key])).optional();
const planFilters = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    pace: planChoice("pace"),
    purpose: planChoice("purpose"),
    surface: planChoice("surface"),
    durationMin: z.coerce.number().int().min(0).max(10080).optional(),
    durationMax: z.coerce.number().int().min(1).max(10080).optional(),
    area: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const runtime = "nodejs",
  dynamic = "force-dynamic";
// #248: a saved or planned ride frees only the preview it consumed; the
// global storage pass runs in scripts/cleanup-rides.js, never in a request.
const releasePreview = (previewId: string | undefined) =>
  previewId
    ? collectRideFiles(db, [{ id: previewId, kind: "preview" }]).catch(() => {})
    : Promise.resolve();

async function handler(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
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
          plan: planFilters.parse(
            Object.fromEntries(
              [...url.searchParams].filter(([key]) =>
                planFilterKeys.includes(key),
              ),
            ),
          ),
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
    if (p.length === 2 && p[1] === "analysis" && m === "POST")
      return json(
        await transaction((q) =>
          refreshRideAnalysis(q, user.id, uuid.parse(p[0]), config),
        ),
      );
    if (p[0] === "import" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const input = garminImportInput.parse(
        await readJson(req, 3 * 1024 * 1024),
      );
      if (input.isPublic) requireVerifiedEmail(user);
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
      if (input.isPublic) requireVerifiedEmail(user);
      const result = await transaction((q) =>
        planRide(q, user.id, input, config),
      );
      // #248: only the preview this request consumed, never a storage scan.
      await releasePreview(input.previewId);
      return json(result, 201);
    }
    if (p.length === 2 && p[1] === "track" && m === "POST") {
      const ride = (
        await db.query<{ is_public: boolean }>(
          "SELECT is_public FROM rides WHERE id=$1 AND owner_id=$2",
          [uuid.parse(p[0]), user.id],
        )
      ).rows[0];
      if (!ride) return fail("Покатушка недоступна", 404);
      if (ride.is_public) requireVerifiedEmail(user);
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const bytes = await readBytes(req, config.maxGpxBytes);
      return json(
        await transaction((q) =>
          attachRideTrack(q, user.id, uuid.parse(p[0]), bytes, config),
        ),
      );
    }
    if (p.length === 2 && p[1] === "rsvp" && m === "PATCH") {
      const input = z
        .object({
          response: z.enum(["accepted", "declined", "maybe"]),
          occurrenceAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          respondRide(
            q,
            uuid.parse(p[0]),
            user.id,
            input.response,
            input.occurrenceAt,
          ),
        ),
      );
    }
    if (p.length === 2 && p[1] === "invitation" && m === "PATCH") {
      const input = z
        .object({ response: z.enum(["accepted", "declined", "maybe"]) })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          respondRideInvitation(q, uuid.parse(p[0]), user.id, input.response),
        ),
      );
    }
    if (p.length === 2 && p[1] === "cancel" && m === "POST") {
      // No body cancels the plan or the whole series; `occurrenceAt` of a
      // weekly series cancels only that date (#235).
      const input = req.headers.get("content-type")?.includes("json")
        ? z
            .object({
              occurrenceAt: z.iso.datetime({ offset: true }).optional(),
            })
            .strict()
            .parse(await readJson(req, 1024))
        : {};
      return json(
        await transaction((q) =>
          cancelPlannedRide(
            q,
            uuid.parse(p[0]),
            user.id,
            input.occurrenceAt || null,
          ),
        ),
      );
    }
    if (p.length === 2 && p[1] === "recruitment" && m === "PATCH") {
      const input = z
        .object({
          open: z.boolean(),
          occurrenceAt: z.iso.datetime({ offset: true }),
        })
        .strict()
        .parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          setRideRecruitment(
            q,
            uuid.parse(p[0]),
            user.id,
            input.open,
            input.occurrenceAt,
          ),
        ),
      );
    }
    if (p[0] === "preview" && p.length === 1 && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const bytes = await readBytes(req, config.maxGpxBytes);
      // Parse before the transaction: no connection is held while decoding.
      const parsed = previewParse(bytes, config);
      return json(
        await transaction((q) =>
          previewRide(q, user.id, bytes, config, {
            planned: url.searchParams.get("purpose") === "plan",
            parsed,
          }),
        ),
        201,
      );
    }
    if (!p.length && m === "POST") {
      if (!config.enabled)
        return fail("Загрузка покатушек временно выключена", 403);
      const input = rideInput.parse(await readJson(req, 16384));
      if (input.isPublic) requireVerifiedEmail(user);
      const result = await transaction((q) =>
        saveRide(q, user.id, input, config),
      );
      await releasePreview(input.previewId);
      return json(result, 201);
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
          changeRideComment(q, uuid.parse(p[1]), user, body),
        ),
      );
    }
    if (p.length === 2 && p[1] === "comments" && m === "POST") {
      requireVerifiedEmail(user);
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
      if (input.isPublic) requireVerifiedEmail(user);
      return json(
        await transaction((q) =>
          saveRide(q, user.id, input, config, uuid.parse(p[0])),
        ),
      );
    }
    if (p.length === 1 && m === "DELETE") {
      const { fileId, ...result } = await transaction((q) =>
        deleteRide(q, user.id, uuid.parse(p[0])),
      );
      // The deleted ride's own file; a failure stays queued for the job.
      await collectRideFiles(db, [{ id: fileId, kind: "ride" }]).catch(
        () => {},
      );
      return json(result);
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof EmailPolicyError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof RideError || e instanceof CommunityError)
      return fail(e.message, e.status);
    if (e instanceof ZodError || e instanceof SyntaxError)
      return fail("Проверьте поля запроса");
    if (errorCode(e) === "23505")
      return fail("Эта покатушка уже загружена", 409);
    if (errorMessage(e) === "Превышен допустимый размер запроса")
      return fail("GPX-файл слишком большой", 413);
    logError("rides_failed", e);
    return fail("Не удалось обработать покатушку", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PATCH = route,
  DELETE = route,
  PUT = route;
