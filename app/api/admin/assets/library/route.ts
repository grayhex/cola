import { errorCode } from "../../../../../lib/errors.ts";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { currentUser } from "../../../../../lib/auth.ts";
import { db, transaction } from "../../../../../lib/db.ts";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.ts";
import { audit } from "../../../../../lib/site.ts";
import { uuid } from "../../../../../lib/validation.ts";
import { traced, logError } from "../../../../../lib/observability.ts";
import {
  listAssetLibrary,
  deleteUnusedAssets,
} from "../../../../../lib/site-asset-library.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin")
      return fail("Доступ только для администратора", 403);
    if (req.method === "GET")
      return json({ assets: await listAssetLibrary(db) });
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const input = await readJson(req);
    if (
      !input ||
      typeof input !== "object" ||
      !("ids" in input) ||
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 500 ||
      !input.ids.every((id) => uuid.safeParse(id).success)
    ) {
      return fail("Выберите от 1 до 500 изображений для удаления");
    }
    // Each ID passed the UUID schema above; retain that contract across the callback.
    const ids = input.ids as string[];
    const result = await transaction(async (q) => {
      const deleted = await deleteUnusedAssets(q, ids);
      for (const asset of deleted.deleted)
        await audit(q, user.id, "asset.delete", asset.id);
      return deleted;
    });
    let cleanupWarning = false;
    await Promise.all(
      result.deleted.map(async (asset) => {
        try {
          await unlink(
            /*turbopackIgnore: true*/ path.join(
              /*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads",
              asset.filename,
            ),
          );
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            cleanupWarning = true;
            logError("asset_cleanup_file_error", error);
          }
        }
      }),
    );
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
