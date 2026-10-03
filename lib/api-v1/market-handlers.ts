import { CommunityError } from "../community-validation.ts";
import { db } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import {
  marketApiDetail,
  marketContact,
  marketKeysetPage,
  sellerApiListings,
} from "../market.ts";
import { decodeMarketCursor, encodeMarketCursor } from "./cursor.ts";
import { ApiError, notFound } from "./errors.ts";
import { idOf } from "./journal-handlers.ts";
import { toMarketListing, toMarketListingDetail } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import { parseMarketQuery } from "./schemas.ts";
import { authenticate, viewerOf } from "./viewer.ts";
import { limited } from "./write.ts";

// Market reads of /api/v1 (#319). The visibility rule is the site's: a list
// holds only listings that are on the market now (active, inside their term,
// seller not blocked). A listing by its id is also readable once sold or
// expired (with the mark, without the contact); a draft only by its owner.
// Everything else, and an unknown id, is the same 404. The contact is never in
// a card: it is asked for one listing at a time.

type IdParams = { params: Promise<{ id: string }> };
const missing = () => notFound("Объявление не найдено.");
/** The engines throw their own 404; the API answers it in its own envelope. */
async function present<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommunityError && error.status === 404)
      throw missing();
    throw error;
  }
}

/** GET /api/v1/market */
export function handleMarket(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parseMarketQuery(new URL(req.url));
    const after = query.cursor
      ? decodeMarketCursor(query.cursor, query.sort)
      : null;
    // The heading names the seller even when nothing of theirs is on sale, so
    // an unknown or blocked seller is a 404 and not an empty page.
    let seller = "";
    if (query.seller) {
      const found = (
        await db.query<{ username: string }>(
          "SELECT username FROM users WHERE lower(username)=lower($1) AND NOT blocked",
          [query.seller],
        )
      ).rows[0];
      if (!found) throw notFound("Продавец не найден.");
      seller = found.username;
    }
    const page = await marketKeysetPage(db, viewer?.id, {
      category: query.category || null,
      listingType: query.type || null,
      condition: query.condition || null,
      priceMin: query.price_min === "" ? null : query.price_min,
      priceMax: query.price_max === "" ? null : query.price_max,
      city: query.city,
      search: query.q,
      seller,
      sort: query.sort,
      limit: query.limit,
      after,
    });
    return ok({
      items: page.items.map(toMarketListing),
      nextCursor: page.next ? encodeMarketCursor(page.next, query.sort) : null,
    });
  });
}

/** GET /api/v1/market/{id} */
export function handleGetListing(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const id = idOf((await params).id, "Объявление не найдено.");
    return ok(
      toMarketListingDetail(
        await present(() => marketApiDetail(db, id, viewer?.id)),
      ),
    );
  });
}

/** GET /api/v1/market/{id}/contact */
export function handleListingContact(req: Request, { params }: IdParams) {
  return safely(async () => {
    const { viewer } = await authenticate(req.headers);
    if (!viewer)
      throw new ApiError("unauthorized", "Войдите, чтобы увидеть контакт.");
    requireVerifiedEmail(viewer);
    const id = idOf((await params).id, "Объявление не найдено.");
    // The budget of the site's own contact route: one budget for both.
    await limited("market-contact:" + viewer.id, 20);
    return ok({
      contact: await present(() => marketContact(db, id, viewer.id, "id")),
    });
  });
}

/** GET /api/v1/market/{id}/others */
export function handleListingOthers(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const id = idOf((await params).id, "Объявление не найдено.");
    // Readable listing first: the others of a hidden one are not a way around it.
    const listing = await present(() => marketApiDetail(db, id, viewer?.id));
    const others = await sellerApiListings(db, listing.id, viewer?.id);
    return ok({
      items: others.items.map(toMarketListing),
      total: others.total,
    });
  });
}
