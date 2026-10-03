import { errorMessage } from "../../../../lib/errors.ts";
import { ZodError } from "zod";
import { currentUser } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { audit } from "../../../../lib/site.ts";
import {
  adminMobileSettings,
  saveMobileSettings,
  MobileSettingsError,
} from "../../../../lib/mobile-settings.ts";
import { json, fail, sameOrigin, readJson } from "../../../../lib/http.ts";
import { traced, logError } from "../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Settings of the native apps (#338): admins only, on every read and write.
// Apps read the public form at GET /api/v1/app-config.
async function handler(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin")
      return fail("Доступ только для администратора", 403);
    if (req.method === "GET") return json(await adminMobileSettings(db));
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const input = await readJson(req);
    return json(
      await transaction((q) => saveMobileSettings(q, user.id, input, audit)),
    );
  } catch (e) {
    if (e instanceof MobileSettingsError)
      return json(
        {
          error: e.message,
          code: e.code,
          ...(e.problems ? { problems: e.problems } : {}),
          ...(e.confirm ? { confirm: e.confirm } : {}),
        },
        e.status,
      );
    if (e instanceof ZodError)
      return json(
        {
          error:
            "Проверьте поля: " +
            e.issues
              .map((i) => i.path.join(".") + " — " + i.message)
              .join("; "),
          code: "invalid_settings",
          problems: e.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    if (e instanceof SyntaxError) return fail("Некорректный запрос");
    if (errorMessage(e) === "Превышен допустимый размер запроса")
      return fail(errorMessage(e), 413);
    logError("mobile_settings_error", e);
    return fail(
      "Не удалось сохранить настройки приложения. Изменения остались в редакторе.",
      500,
    );
  }
}
export const GET = traced(handler);
export const PUT = traced(handler);
