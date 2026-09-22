import { currentUser } from "../../../../lib/auth.js";
import { db, transaction } from "../../../../lib/db.js";
import { audit } from "../../../../lib/site.js";
import {
  adminLegalDocuments,
  saveLegalDocument,
  LegalError,
} from "../../../../lib/legal-documents.js";
import { json, fail, sameOrigin, readJson } from "../../../../lib/http.js";
import { traced, logError } from "../../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(req) {
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
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail("Проверьте документ и его версию.");
    if (e.message === "Превышен допустимый размер запроса")
      return fail(e.message, 413);
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
