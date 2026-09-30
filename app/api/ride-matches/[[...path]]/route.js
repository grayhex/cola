import { z } from "zod";
import { currentUser, rateLimit } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { json, fail, readJson, sameOrigin } from "../../../../lib/http.ts";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../../lib/email-policy.ts";
import { uuid } from "../../../../lib/validation.ts";
import { traced, logError } from "../../../../lib/observability.ts";
import {
  riderQuery,
  draftQuery,
  planQuery,
  groupsQuery,
  interestInvitationsInput,
  queryObject,
} from "../../../../lib/ride-match-input.js";
import {
  MatchError,
  matchRides,
  planInterest,
  draftInterest,
  interestGroups,
  inviteFromInterest,
} from "../../../../lib/ride-matching.js";
import { upcomingRides } from "../../../../lib/rides.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
// Matching (#232) and the organizer workspace (#234). Every call needs a
// session; answers are no-store and viewer-specific, so nothing is cached
// between viewers or privacy changes. The only write invites people whose
// intent fits an own plan, re-checked on the server.
/** @param {Request} req
 * @param {{params: Promise<{path?: string[]}>}} context */
async function handler(req, { params }) {
  try {
    if (req.method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    const p = (await params).path || [];
    if (
      req.method === "POST" &&
      p.length === 3 &&
      p[0] === "plans" &&
      p[2] === "invitations"
    ) {
      if (!(await rateLimit("ride-interest-invite:" + user.id, 20)))
        return fail("Слишком много приглашений. Попробуйте позже.", 429);
      requireVerifiedEmail(user);
      const rideId = uuid.parse(p[1]),
        input = interestInvitationsInput.parse(await readJson(req, 4096));
      return json(
        await transaction((q) => inviteFromInterest(q, user.id, rideId, input)),
      );
    }
    if (req.method !== "GET") return fail("Метод не поддерживается", 405);
    const search = queryObject(new URL(req.url).searchParams);
    if (!(await rateLimit("ride-match:" + user.id, 120)))
      return fail("Слишком много запросов. Попробуйте позже.", 429);
    if (p.length === 1 && p[0] === "upcoming") {
      z.object({}).strict().parse(search);
      return json({ rides: await upcomingRides(db, user.id) });
    }
    if (p.length === 1 && p[0] === "rides")
      return json(await matchRides(db, user.id, riderQuery.parse(search)));
    if (p.length === 1 && p[0] === "groups")
      return json(await interestGroups(db, user.id, groupsQuery.parse(search)));
    if (p.length === 1 && p[0] === "interest")
      return json(await draftInterest(db, user.id, draftQuery.parse(search)));
    if (p.length === 3 && p[0] === "plans" && p[2] === "interest")
      return json(
        await planInterest(
          db,
          user.id,
          uuid.parse(p[1]),
          planQuery.parse(search),
        ),
      );
    return fail("Не найдено", 404);
  } catch (error) {
    if (error instanceof MatchError) return fail(error.message, error.status);
    if (error instanceof EmailPolicyError)
      return fail(error.message, error.status);
    if (error instanceof z.ZodError)
      return fail(error.issues[0]?.message || "Проверьте параметры", 400);
    if (
      error instanceof SyntaxError ||
      /размер запроса|Пустой запрос/.test(error.message)
    )
      return fail("Некорректный запрос", 400);
    logError("ride_match_failed", error);
    return fail("Не удалось подобрать поездки. Попробуйте ещё раз.", 500);
  }
}
export const GET = traced(handler);
export const POST = traced(handler);
