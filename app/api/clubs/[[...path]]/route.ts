import {
  clubNoticePreferences,
  setClubNoticePreferences,
  clubNoticePreferencesInput,
} from "../../../../lib/club-events.ts";
import { nearestClubRide } from "../../../../lib/club-nearest.ts";
import {
  changeMembership,
  manageClubMember,
  clubMembers,
  transferClub,
  clubAdministrativeState,
  membershipActionInput,
  memberManagementInput,
  transferInput,
} from "../../../../lib/club-membership.ts";
import {
  publicClubBadges,
  ownBadgePreferences,
  saveBadgePreferences,
  badgePreferencesInput,
} from "../../../../lib/club-badges.ts";
import { ZodError, z } from "zod";
import {
  clubRides,
  manageClubRide,
  clubRideOptions,
} from "../../../../lib/rides.ts";
import { RideError } from "../../../../lib/ride-gpx.ts";
import {
  clubChatState,
  setClubChatSettings,
  clubChatSettingsInput,
  deleteClubChatMessage,
} from "../../../../lib/club-chat.ts";
import { ChatError } from "../../../../lib/chat-provider.ts";
import { chatConfig } from "../../../../lib/chat-config.ts";
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
import { CommunityError } from "../../../../lib/community-validation.ts";
import { EmailPolicyError } from "../../../../lib/email-policy.ts";
import {
  clubArchiveInput,
  setClubArchived,
  clubCreateInput,
  clubEditInput,
  clubRulesInput,
  clubDetail,
  clubList,
  clubEligibility,
  createClub,
  editClub,
  editClubRules,
} from "../../../../lib/clubs.ts";
import {
  prepareClubPhoto,
  replaceClubPhoto,
  readClubPhoto,
  cleanupClubPhotos,
} from "../../../../lib/club-storage.ts";
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
      user = await currentUser();
    if (m !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    if (m === "GET") {
      if (p.length === 2 && p[1] === "nearest")
        return json(
          await nearestClubRide(db, uuid.parse(p[0]), user?.id || null),
        );
      if (p.length === 2 && p[1] === "notice-preferences")
        return user
          ? json(await clubNoticePreferences(db, uuid.parse(p[0]), user.id))
          : fail("Войдите в аккаунт", 401);
      if (p.length === 2 && p[1] === "chat")
        return user
          ? json(await clubChatState(db, uuid.parse(p[0]), user.id))
          : fail("Войдите в аккаунт", 401);
      if (p.length === 1 && p[0] === "ride-options")
        return user
          ? json(
              await clubRideOptions(
                db,
                user.id,
                z.coerce
                  .number()
                  .int()
                  .min(1)
                  .max(10000)
                  .parse(url.searchParams.get("page") || 1),
              ),
            )
          : fail("Войдите в аккаунт", 401);
      if (p.length === 2 && p[1] === "rides")
        return json(
          await clubRides(
            db,
            uuid.parse(p[0]),
            user?.id || null,
            z.coerce
              .number()
              .int()
              .min(1)
              .max(10000)
              .parse(url.searchParams.get("page") || 1),
          ),
        );
      if (p.length === 2 && p[0] === "badges")
        return json(
          (
            await publicClubBadges(
              db,
              [uuid.parse(p[1])],
              z.coerce
                .number()
                .int()
                .min(1)
                .max(10000)
                .parse(url.searchParams.get("page") || 1),
            )
          ).get(p[1]),
        );
      if (p.length === 1 && p[0] === "badge-preferences")
        return user
          ? json(await ownBadgePreferences(db, user.id))
          : fail("Войдите в аккаунт", 401);
      if (p.length === 2 && p[1] === "members")
        return json(
          await clubMembers(
            db,
            uuid.parse(p[0]),
            user?.id || null,
            z.coerce
              .number()
              .int()
              .min(1)
              .max(10000)
              .parse(url.searchParams.get("page") || 1),
            url.searchParams.get("manage") === "1",
          ),
        );
      if (p.length === 2 && p[1] === "administration")
        return user
          ? json(await clubAdministrativeState(db, uuid.parse(p[0]), user.id))
          : fail("Войдите в аккаунт", 401);

      if (!p.length)
        return json(
          await clubList(db, user?.id || null, {
            page: z.coerce
              .number()
              .int()
              .min(1)
              .max(10000)
              .parse(url.searchParams.get("page") || 1),
            search: url.searchParams.get("q") || "",
            city: url.searchParams.get("city") || "",
            format: url.searchParams.get("format") || "",
            own: url.searchParams.get("own") === "1",
            archived: url.searchParams.get("archived") === "1",
          }),
        );
      if (p.length === 1 && p[0] === "eligibility")
        return user
          ? json(await clubEligibility(db, user.id))
          : fail("Войдите в аккаунт", 401);
      if (p.length === 1)
        return json({
          club: await clubDetail(db, uuid.parse(p[0]), user?.id || null),
        });
      if (p.length === 3 && p[1] === "media")
        return new Response(
          new Uint8Array(
            await readClubPhoto(db, uuid.parse(p[0]), uuid.parse(p[2])),
          ),
          {
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      return fail("Не найдено", 404);
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p.length === 2 && p[1] === "notice-preferences" && m === "PATCH") {
      if (!(await rateLimit("club-notice-preferences:" + user.id, 30)))
        return fail("Слишком много действий", 429);
      const input = clubNoticePreferencesInput.parse(await readJson(req, 1024));
      return json(
        await transaction((q) =>
          setClubNoticePreferences(q, uuid.parse(p[0]), user.id, input),
        ),
      );
    }
    if (p.length === 2 && p[1] === "chat" && m === "PATCH") {
      if (!(await rateLimit("club-chat-settings:" + user.id, 20)))
        return fail("Слишком много действий", 429);
      const input = clubChatSettingsInput.parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          setClubChatSettings(q, uuid.parse(p[0]), user.id, input),
        ),
      );
    }
    if (
      p.length === 4 &&
      p[1] === "chat" &&
      p[2] === "messages" &&
      m === "DELETE"
    ) {
      if (!chatConfig()) return fail("Сообщения пока отключены", 503);
      if (!(await rateLimit("club-chat-moderation:" + user.id, 20)))
        return fail("Слишком много действий", 429);
      return json(
        await transaction((q) =>
          deleteClubChatMessage(q, uuid.parse(p[0]), user.id, p[3]),
        ),
      );
    }
    if (p.length === 3 && p[1] === "rides" && m === "PATCH") {
      if (!(await rateLimit("club-ride:" + user.id, 20)))
        return fail("Слишком много действий", 429);
      const input = z
        .object({ action: z.enum(["cancel", "pause"]) })
        .strict()
        .parse(await readJson(req, 8192));
      return json(
        await transaction((q) =>
          manageClubRide(
            q,
            uuid.parse(p[0]),
            uuid.parse(p[2]),
            user.id,
            input.action,
          ),
        ),
      );
    }
    if (!(await rateLimit("club-write:" + user.id, 20)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (p.length === 1 && p[0] === "badge-preferences" && m === "PATCH") {
      const input = badgePreferencesInput.parse(await readJson(req, 100000));
      return json(
        await transaction((q) => saveBadgePreferences(q, user.id, input)),
      );
    }
    if (p.length === 2 && p[1] === "membership" && m === "POST") {
      const input = membershipActionInput.parse(await readJson(req, 8192));
      return json({
        club: await transaction((q) =>
          changeMembership(q, uuid.parse(p[0]), user.id, input),
        ),
      });
    }
    if (p.length === 3 && p[1] === "members" && m === "PATCH") {
      const input = memberManagementInput.parse(await readJson(req, 8192));
      return json({
        club: await transaction((q) =>
          manageClubMember(
            q,
            uuid.parse(p[0]),
            user.id,
            uuid.parse(p[2]),
            input,
          ),
        ),
      });
    }
    if (p.length === 2 && p[1] === "transfer" && m === "POST") {
      const input = transferInput.parse(await readJson(req, 8192));
      return json({
        club: await transaction((q) =>
          transferClub(q, uuid.parse(p[0]), user.id, input),
        ),
      });
    }
    if (!p.length && m === "POST") {
      const input = clubCreateInput.parse(await readJson(req, 100000));
      return json(
        { club: await transaction((q) => createClub(q, user.id, input)) },
        201,
      );
    }
    if (p.length === 2 && p[1] === "archive" && m === "PATCH") {
      const input = clubArchiveInput.parse(await readJson(req, 8192));
      return json({
        club: await transaction((q) =>
          setClubArchived(q, uuid.parse(p[0]), user.id, input),
        ),
      });
    }
    if (p.length === 1 && m === "PATCH") {
      const input = clubEditInput.parse(await readJson(req, 100000));
      return json({
        club: await transaction((q) =>
          editClub(q, uuid.parse(p[0]), user.id, input),
        ),
      });
    }
    if (p.length === 2 && p[1] === "rules" && m === "PATCH") {
      const input = clubRulesInput.parse(await readJson(req, 100000));
      return json({
        club: await transaction((q) =>
          editClubRules(q, uuid.parse(p[0]), user.id, input),
        ),
      });
    }
    if (
      p.length === 2 &&
      ["logo", "cover"].includes(p[1]) &&
      ["PUT", "DELETE"].includes(m)
    ) {
      const purpose = z.enum(["logo", "cover"]).parse(p[1]),
        version = z.coerce
          .number()
          .int()
          .positive()
          .parse(url.searchParams.get("version"));
      const bytes =
        m === "DELETE"
          ? null
          : await prepareClubPhoto(await readBytes(req, 2 * 1048576), purpose);
      const club = await replaceClubPhoto(
        transaction,
        uuid.parse(p[0]),
        user.id,
        purpose,
        version,
        bytes,
      );
      await cleanupClubPhotos(db);
      return json({ club });
    }
    return fail("Не найдено", 404);
  } catch (error) {
    if (error instanceof EmailPolicyError)
      return json({ error: error.message, code: error.code }, error.status);
    if (
      error instanceof CommunityError ||
      error instanceof RideError ||
      error instanceof ChatError
    )
      return fail(error.message, error.status);
    if (error instanceof ZodError || error instanceof SyntaxError)
      return fail("Проверьте поля клуба");
    if (error instanceof Error && error.message === "UNSUPPORTED_IMAGE")
      return fail("Используйте JPEG, PNG или WebP");
    if (
      error instanceof Error &&
      error.message === "Превышен допустимый размер запроса"
    )
      return fail("Файл или текст слишком большой", 413);
    logError("club_failed", error);
    return fail("Не удалось обработать клуб", 500);
  }
}
const route = traced(handler);
export const GET = route,
  POST = route,
  PATCH = route,
  PUT = route,
  DELETE = route;
