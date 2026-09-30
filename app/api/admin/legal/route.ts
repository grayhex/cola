import { errorMessage } from "../../../../lib/errors.ts";
import { ZodError } from "zod";
import { currentUser } from "../../../../lib/auth.ts";
import { db, transaction } from "../../../../lib/db.ts";
import { audit } from "../../../../lib/site.ts";
import {
  adminLegalDocuments,
  saveLegalDocument,
  LegalError,
} from "../../../../lib/legal-documents.ts";
import { json, fail, sameOrigin, readJson } from "../../../../lib/http.ts";
import { traced, logError } from "../../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin")
      return fail("Доступ только для администратора", 403);
    if (req.method === "GET") return json(await adminLegalDocuments(db));
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const input = await readJson(req);
    return json({
      document: await transaction((q) =>
        saveLegalDocument(q, user.id, input, req.method === "POST", audit),
      ),
    });
  } catch (e) {
    if (e instanceof LegalError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof ZodError || e instanceof SyntaxError)
      return fail("Проверьте документ и его версию.");
    if (errorMessage(e) === "Превышен допустимый размер запроса")
      return fail(errorMessage(e), 413);
    logError("legal_admin_error", e);
    return fail(
      "Не удалось сохранить документ. Изменения остались в редакторе.",
      500,
    );
  }
}
export const GET = traced(handler);
export const PUT = traced(handler);
export const POST = traced(handler);
