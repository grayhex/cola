import { ZodError } from "zod";
import { currentUser } from "./auth.ts";
import { fail, json, readJson, sameOrigin } from "./http.ts";
import { errorMessage } from "./errors.ts";
import { logError } from "./observability.ts";
import type { CurrentUser } from "./contracts.ts";

// What the admin endpoints of one feature share: the administrator on every
// read and write, the Origin rule for a change, and the same answers for a
// request that is wrong. The feature's own errors are mapped by the caller.
export async function adminOnly(
  req: Request,
  { change }: { change: boolean },
): Promise<{ user: CurrentUser } | { response: Response }> {
  const user = await currentUser();
  if (!user) return { response: await fail("Войдите в аккаунт", 401) };
  if (user.role !== "admin")
    return { response: await fail("Доступ только для администратора", 403) };
  if (change && !sameOrigin(req))
    return { response: await fail("Недопустимый источник запроса", 403) };
  return { user };
}
export const adminBody = readJson;
export async function adminProblem(
  error: unknown,
  event: string,
  fallback: string,
): Promise<Response> {
  if (error instanceof ZodError)
    return json(
      {
        error:
          "Проверьте поля: " +
          error.issues
            .map((i) => i.path.join(".") + " — " + i.message)
            .join("; "),
        code: "invalid_settings",
        problems: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  if (error instanceof SyntaxError) return fail("Некорректный запрос");
  if (errorMessage(error) === "Превышен допустимый размер запроса")
    return fail(errorMessage(error), 413);
  logError(event, error);
  return fail(fallback, 500);
}
