import { z } from "zod";
import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import {
  json,
  fail,
  readJson,
  readBytes,
  sameOrigin,
} from "../../../../lib/http.js";
import { uuid } from "../../../../lib/validation.js";
import {
  CommunityError,
  communityPage,
} from "../../../../lib/community-validation.js";
import {
  listingInput,
  marketList,
  marketDetail,
  saveListing,
  deleteListing,
  saveMarketPhoto,
  marketPhoto,
  removeMarketPhoto,
  cleanupMarketPhotos,
} from "../../../../lib/market.js";
import { preparePhoto, prepareThumbnail } from "../../../../lib/images.js";
import { logError } from "../../../../lib/observability.js";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const p = (await params).path || [],
      method = req.method,
      url = new URL(req.url),
      user = await currentUser();
    if (method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    if (method === "GET" && !p.length) {
      const own = url.searchParams.get("own") === "1";
      if (own && !user) return fail("Войдите в аккаунт", 401);
      return json(
        await marketList(db, user?.id, {
          own,
          category: z
            .enum(["bikes", "components", "accessories"])
            .nullable()
            .parse(url.searchParams.get("category")),
          page: communityPage.parse(url.searchParams.get("page") || 1),
          search: z
            .string()
            .max(100)
            .parse(url.searchParams.get("q") || ""),
        }),
      );
    }
    if (method === "GET" && p[0] === "public" && p.length === 2)
      return json({
        listing: await marketDetail(db, uuid.parse(p[1]), user?.id),
      });
    if (method === "GET" && p[0] === "media" && p.length === 2) {
      const width = z
          .enum(["160", "320"])
          .nullable()
          .parse(url.searchParams.get("width")),
        bytes = await marketPhoto(db, uuid.parse(p[1]), user?.id);
      return new Response(
        width ? await prepareThumbnail(bytes, Number(width)) : bytes,
        {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (!(await rateLimit("market-write:" + user.id, 30)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (method === "POST" && !p.length) {
      const input = listingInput.parse(await readJson(req, 16384));
      return json(
        await transaction((q) => saveListing(q, user.id, input)),
        201,
      );
    }
    if (p[0] === "media" && p.length === 2 && method === "DELETE") {
      const result = await transaction((q) =>
        removeMarketPhoto(q, uuid.parse(p[1]), user.id),
      );
      await cleanupMarketPhotos(db);
      return json(result);
    }
    if (p.length === 2 && p[1] === "photos" && method === "POST") {
      const id = uuid.parse(p[0]),
        raw = await readBytes(req, 10 * 1024 * 1024);
      let bytes;
      try {
        bytes = await preparePhoto(raw, { bikePhoto: false });
      } catch {
        return fail("Выберите JPEG, PNG или WebP до 10 МБ");
      }
      return json(await saveMarketPhoto(transaction, id, user.id, bytes), 201);
    }
    if (p.length === 1 && method === "PATCH") {
      const input = listingInput.parse(await readJson(req, 16384));
      return json(
        await transaction((q) =>
          saveListing(q, user.id, input, uuid.parse(p[0])),
        ),
      );
    }
    if (p.length === 1 && method === "DELETE") {
      const result = await transaction((q) =>
        deleteListing(q, uuid.parse(p[0]), user.id),
      );
      await cleanupMarketPhotos(db);
      return json(result);
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e.name === "ZodError" || e instanceof SyntaxError)
      return fail("Проверьте поля объявления");
    if (e.message === "Превышен допустимый размер запроса")
      return fail("Файл слишком большой", 413);
    logError("market_error", e);
    return fail("Не удалось обработать объявление", 500);
  }
}
export const GET = handler,
  POST = handler,
  PATCH = handler,
  DELETE = handler;
