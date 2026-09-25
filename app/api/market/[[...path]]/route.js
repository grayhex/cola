import { z } from "zod";
import { listingTypeKeys, marketSorts } from "../../../../lib/market-types.js";
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
  marketContact,
  saveListing,
  deleteListing,
  saveMarketPhoto,
  marketPhotoFilename,
  readMarketPhotoFile,
  removeMarketPhoto,
  cleanupMarketPhotos,
  sellerListings,
  extendListing,
  setListingSaved,
  savedListings,
} from "../../../../lib/market.js";
import { publicAuthor } from "../../../../lib/profile-dto.js";
import { usernamePattern } from "../../../../lib/usernames.js";
import { preparePhoto } from "../../../../lib/images.js";
import {
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
} from "../../../../lib/media-cache.js";
import { logError, traced } from "../../../../lib/observability.js";
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
    const price = (name) => {
      const value = url.searchParams.get(name);
      return value === null || value === ""
        ? null
        : z.coerce.number().int().min(0).max(9999999999).parse(value);
    };
    if (method === "GET" && !p.length) {
      const own = url.searchParams.get("own") === "1";
      if (own && !user) return fail("Войдите в аккаунт", 401);
      // One seller's listings (#116): the heading names the seller even when
      // nothing of theirs is on the market now.
      const sellerName = z
        .string()
        .regex(usernamePattern)
        .nullable()
        .parse(url.searchParams.get("seller") || null);
      const seller = sellerName
        ? (
            await db.query(
              "SELECT id,username,name,avatar_id FROM users WHERE lower(username)=lower($1) AND NOT blocked",
              [sellerName],
            )
          ).rows[0]
        : null;
      if (sellerName && !seller) return fail("Продавец не найден", 404);
      const list = await marketList(db, user?.id, {
          seller: seller?.username || "",
          own,
          category: z
            .enum(["bikes", "components", "accessories"])
            .nullable()
            .parse(url.searchParams.get("category")),
          listingType: z.enum(listingTypeKeys).nullable().parse(url.searchParams.get("type")),
          condition: z.enum(["new", "used"]).nullable().parse(url.searchParams.get("condition")),
          priceMin: price("price_min"),
          priceMax: price("price_max"),
          city: z
            .string()
            .trim()
            .max(100)
            .parse(url.searchParams.get("city") || ""),
          sort: z
            .enum(Object.keys(marketSorts))
            .parse(url.searchParams.get("sort") || "new"),
          page: communityPage.parse(url.searchParams.get("page") || 1),
          search: z
            .string()
            .max(100)
            .parse(url.searchParams.get("q") || ""),
        });
      return json(seller ? { ...list, seller: publicAuthor(seller) } : list);
    }
    // Contacts are shown one listing at a time to signed-in people only.
    if (method === "GET" && p[0] === "public" && p[2] === "contact" && p.length === 3) {
      if (!user) return fail("Войдите, чтобы увидеть контакт", 401);
      if (!(await rateLimit("market-contact:" + user.id, 20)))
        return fail("Слишком много запросов контактов. Попробуйте позже.", 429);
      return json({
        contact: await marketContact(db, uuid.parse(p[1]), user.id),
      });
    }
    if (method === "GET" && p[0] === "public" && p.length === 2) {
      const listing = await marketDetail(db, uuid.parse(p[1]), user?.id);
      return json({
        listing,
        others: await sellerListings(db, listing.id, user?.id),
      });
    }
    if (method === "GET" && p[0] === "media" && p.length === 2) {
      const id = uuid.parse(p[1]),
        width = mediaWidth(url.searchParams.get("width"));
      if (width === undefined) return fail("Неверный размер фото");
      // Access is checked on every request, including revalidation.
      const filename = await marketPhotoFilename(db, id, user?.id),
        etag = mediaEtag(id, width),
        headers = { Vary: "Cookie" };
      if (notModified(req, etag)) return notModifiedResponse(etag, { headers });
      const original = () => readMarketPhotoFile(filename);
      return mediaResponse(
        width ? await mediaVariant(id, width, original) : await original(),
        etag,
        { headers },
      );
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (method === "GET" && p.length === 1 && p[0] === "saved")
      return json(
        await savedListings(
          db,
          user.id,
          communityPage.parse(url.searchParams.get("page") || 1),
        ),
      );
    if (!(await rateLimit("market-write:" + user.id, 30)))
      return fail("Слишком много действий. Попробуйте позже.", 429);
    if (p.length === 2 && p[1] === "extend" && method === "POST")
      return json(
        await transaction((q) => extendListing(q, uuid.parse(p[0]), user.id)),
      );
    if (p.length === 2 && p[1] === "save" && ["PUT", "DELETE"].includes(method))
      return json(
        await transaction((q) =>
          setListingSaved(q, uuid.parse(p[0]), user.id, method === "PUT"),
        ),
      );
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
const route = traced(handler);
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route,
  DELETE = route;
