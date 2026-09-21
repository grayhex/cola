import path from "node:path";
import { unlink } from "node:fs/promises";
import { currentUser } from "../../../../../lib/auth.js";
import { db, transaction } from "../../../../../lib/db.js";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.js";
import { audit } from "../../../../../lib/site.js";
import { uuid } from "../../../../../lib/validation.js";
import { traced, logError } from "../../../../../lib/observability.js";
import { listAssetLibrary, deleteUnusedAssets } from "../../../../../lib/site-asset-library.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin") return fail("Доступ только для администратора", 403);
    if (req.method === "GET") return json({ assets: await listAssetLibrary(db) });
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const input = await readJson(req);
    if (!Array.isArray(input?.ids) || !input.ids.length || input.ids.length > 500 ||
        !input.ids.every((id) => uuid.safeParse(id).success)) {
      return fail("Выберите от 1 до 500 изображений для удаления");
    }
    const result = await transaction(async (q) => {
      const deleted = await deleteUnusedAssets(q, input.ids);
      for (const asset of deleted.deleted) await audit(q, user.id, "asset.delete", asset.id);
      return deleted;
    });
    let cleanupWarning = false;
    await Promise.all(result.deleted.map(async (asset) => {
      try {
        await unlink(path.join(process.env.UPLOAD_DIR || "uploads", asset.filename));
      } catch (error) {
        if (error.code !== "ENOENT") {
          cleanupWarning = true;
          logError("asset_cleanup_file_error", error);
        }
      }
    }));
    return json({
      deletedIds: result.deleted.map((asset) => asset.id),
      skippedIds: result.skippedIds,
      cleanupWarning,
    });
  } catch (error) {
    if (error instanceof SyntaxError) return fail("Некорректный запрос");
    logError("asset_library_error", error);
    return fail("Не удалось обновить медиатеку", 500);
  }
}
const route = traced(handler);
export { route as GET, route as DELETE };
