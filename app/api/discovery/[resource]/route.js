import { db } from "../../../../lib/db.js";
import { currentUser } from "../../../../lib/auth.js";
import {
  communityHome,
  discoveryInput,
  discoverySearch,
} from "../../../../lib/discovery.js";
import { logError } from "../../../../lib/observability.js";
export const dynamic = "force-dynamic";
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request, context) {
  const { resource } = await context.params;
  if (!["home", "search"].includes(resource))
    return json({ error: "Не найдено" }, 404);
  try {
    if (resource === "search") {
      const parsed = discoveryInput.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success)
        return json(
          { error: "Проверьте параметры поиска. Запрос — до 150 символов." },
          400,
        );
      return json(await discoverySearch(db, parsed.data));
    }
    const user = await currentUser();
    return json(await communityHome(db, user?.id));
  } catch (error) {
    logError("discovery_request_failed", error);
    return json(
      { error: "Не удалось загрузить данные. Попробуйте ещё раз." },
      500,
    );
  }
}
