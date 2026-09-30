import { logError, traced } from "../../../lib/observability.ts";
import { getSite } from "../../../lib/site.ts";
import { json, fail } from "../../../lib/http.ts";
export const dynamic = "force-dynamic";
export const GET = traced(async function GET() {
  try {
    return json(await getSite());
  } catch (e) {
    logError("site_settings_failed", e);
    return fail("Не удалось загрузить настройки сайта", 503);
  }
});
