import { db } from "../../../../lib/db.ts";
import { currentUser } from "../../../../lib/auth.ts";
import { withPublicReferences } from "../../../../lib/public-response.ts";
import {
  communityHome,
  discoveryInput,
  discoverySearch,
} from "../../../../lib/discovery.ts";
import { logError, traced } from "../../../../lib/observability.ts";
export const dynamic = "force-dynamic";
const json = async (data: unknown, status = 200) =>
  Response.json(status < 400 ? await withPublicReferences(data) : data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export const GET = traced(async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
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
});
