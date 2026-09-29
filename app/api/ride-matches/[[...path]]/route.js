import { z } from "zod";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { db } from "../../../../lib/db.js";
import { json, fail } from "../../../../lib/http.js";
import { uuid } from "../../../../lib/validation.js";
import { traced, logError } from "../../../../lib/observability.js";
import {
  riderQuery,
  draftQuery,
  planQuery,
  queryObject,
} from "../../../../lib/ride-match-input.js";
import {
  MatchError,
  matchRides,
  planInterest,
  draftInterest,
} from "../../../../lib/ride-matching.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
// Read-only matching (#232). Every read needs a session; answers are no-store
// and viewer-specific, so nothing is cached between viewers or privacy changes.
/** @param {Request} req
 * @param {{params: Promise<{path?: string[]}>}} context */
async function handler(req, { params }) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    const p = (await params).path || [],
      search = queryObject(new URL(req.url).searchParams);
    if (!(await rateLimit("ride-match:" + user.id, 120)))
      return fail("Слишком много запросов. Попробуйте позже.", 429);
    if (p.length === 1 && p[0] === "rides")
      return json(await matchRides(db, user.id, riderQuery.parse(search)));
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
    if (error instanceof z.ZodError)
      return fail(error.issues[0]?.message || "Проверьте параметры", 400);
    logError("ride_match_failed", error);
    return fail("Не удалось подобрать поездки. Попробуйте ещё раз.", 500);
  }
}
export const GET = traced(handler);
