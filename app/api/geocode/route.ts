import { errorMessage } from "../../../lib/errors.ts";
import { z } from "zod";
import { currentUser, rateLimit } from "../../../lib/auth.ts";
import { fail, json } from "../../../lib/http.ts";
import { logError, traced } from "../../../lib/observability.ts";
import {
  GeocoderError,
  queryMax,
  searchPlaces,
} from "../../../lib/geocoding.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
// Place search for choosing a ride's area (#370): only for a signed-in person
// (a guest has no intent to place), a limited number of questions, answers
// never cached. The question is not logged and not kept: it is the person's.
const query = z.object({ q: z.string().max(queryMax) }).strict();

async function handler(req: Request) {
  try {
    if (req.method !== "GET") return fail("Метод не поддерживается", 405);
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    const input = query.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!(await rateLimit("geocode:" + user.id, 60)))
      return fail("Слишком много поисков. Попробуйте позже.", 429);
    return json({ places: await searchPlaces(input.q) });
  } catch (error) {
    if (error instanceof GeocoderError)
      return fail(error.message, error.status);
    if (error instanceof z.ZodError)
      return fail("Запрос слишком длинный или неверный", 400);
    logError("geocode_failed", error);
    return fail(errorMessage(error) || "Не удалось выполнить поиск", 500);
  }
}
export const GET = traced(handler);
export const POST = traced(handler);
