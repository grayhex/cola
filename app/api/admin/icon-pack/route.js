import { createHash } from "node:crypto";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { transaction } from "../../../../lib/db.js";
import { audit } from "../../../../lib/site.js";
import { json, fail, sameOrigin, readBytes } from "../../../../lib/http.js";
import { traced, logError } from "../../../../lib/observability.js";
import { iconPackByName } from "../../../../lib/icon-pack.js";
import { readIconPack, IconPackError, ICON_ZIP_LIMIT, ICON_FILE_LIMIT } from "../../../../lib/icon-pack-zip.js";
import { prepareIcon } from "../../../../lib/icon-pack-images.js";
import { stageIconAssets } from "../../../../lib/icon-pack-storage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(req) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin") return fail("Доступ только для администратора", 403);
    if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const params = new URL(req.url).searchParams;
    const action = params.get("action") || "preview";
    if (!["preview", "stage", "single"].includes(action)) return fail("Неизвестное действие");
    if (!(await rateLimit("icon-pack:" + user.id, 12))) return fail("Слишком много загрузок. Повторите через минуту.", 429);
    const slot = params.get("slot");
    if (action === "single" && !Object.hasOwn(iconPackByName, slot)) return fail("Неизвестный слот иконки");
    let bytes;
    try { bytes = await readBytes(req, action === "single" ? ICON_FILE_LIMIT : ICON_ZIP_LIMIT); }
    catch { return fail("Пустой или слишком большой файл (ZIP до 10 МБ, иконка до 2 МБ)", 413); }
    if (action === "single") {
      const icon = { key: slot, ...await prepareIcon(bytes) };
      return json(await stageIconAssets([icon], user.id, { transaction, audit }), 201);
    }
    const fingerprint = createHash("sha256").update(bytes).digest("hex");
    if (action === "stage" && params.get("fingerprint") !== fingerprint)
      return fail("Архив изменился. Выполните предпросмотр заново.", 409);
    const pack = await readIconPack(bytes);
    let selected = pack.icons;
    if (action === "stage") {
      const keys = (params.get("keys") || "").split(",").filter(Boolean);
      if (!keys.length || keys.length > 64 || new Set(keys).size !== keys.length || keys.some((key) => !pack.icons.some((icon) => icon.key === key)))
        return fail("Выберите известные иконки из предпросмотра");
      const wanted = new Set(keys);
      selected = pack.icons.filter((icon) => wanted.has(icon.key));
    }
    const prepared = [];
    for (const icon of selected) {
      try { prepared.push({ key: icon.key, filename: icon.filename, ...await prepareIcon(icon.bytes) }); }
      catch (error) {
        if (error instanceof IconPackError) throw new IconPackError(icon.filename + ": " + error.message, error.status);
        throw error;
      }
    }
    if (action === "preview") return json({
      fingerprint,
      icons: prepared.map(({ bytes: _bytes, ...icon }) => icon),
      ignoredCount: pack.ignored.length,
      ignored: pack.ignored.slice(0, 20),
    });
    return json(await stageIconAssets(prepared, user.id, { transaction, audit }), 201);
  } catch (error) {
    if (error instanceof IconPackError) return fail(error.message, error.status);
    logError("icon_pack_import_error", error);
    return fail("Не удалось импортировать иконки. Настройки сайта не изменены.", 500);
  }
}
export const POST = traced(handler);
