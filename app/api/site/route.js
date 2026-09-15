import { getSite } from "../../../lib/site.js";
import { json, fail } from "../../../lib/http.js";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return json(await getSite());
  } catch (e) {
    console.error(e);
    return fail("Не удалось загрузить настройки сайта", 503);
  }
}
