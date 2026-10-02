import { db } from "../db.ts";
import { getSite } from "../site.ts";
import { visibleBikeById, visibleBikePage } from "../showcase.ts";
import { viewerFromCredential } from "../viewer-session.ts";
import { requestCredential } from "./credentials.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError, notFound } from "./errors.ts";
import { toBike, toBikeSummary, toMe } from "./mappers.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { ok, safely } from "./respond.ts";
import { bikeIdSchema, categoriesOf, parseListQuery } from "./schemas.ts";

// The /api/v1 endpoints (#134). Each is a thin HTTP layer: who is asking,
// which parameters are valid, which DTO to answer, which status. The rules of
// who may read what live in lib/showcase.ts and lib/viewer-session.ts, shared
// with the web pages and the legacy API.

const signIn = () => new ApiError("unauthorized", "Войдите в аккаунт.");

/** GET /api/v1/me */
export function handleMe(req: Request) {
  return safely(async () => {
    const credential = requestCredential(req.headers);
    const viewer = await viewerFromCredential(db, credential);
    if (!viewer) throw signIn();
    return ok(toMe(viewer));
  });
}

/** GET /api/v1/bikes */
export function handleListBikes(req: Request) {
  return safely(async () => {
    const credential = requestCredential(req.headers);
    const query = parseListQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const viewer = await viewerFromCredential(db, credential);
    if (query.scope === "mine" && !viewer) throw signIn();
    const page = await visibleBikePage(db, viewer?.id ?? null, {
      scope: query.scope,
      categories: categoriesOf(query.category),
      search: query.q,
      limit: query.limit,
      after,
    });
    return ok({
      items: page.bikes.map(toBikeSummary),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/bikes/{id} */
export function handleGetBike(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return safely(async () => {
    const credential = requestCredential(req.headers);
    const { id } = await params;
    // A value that is not a UUID cannot name a bike.
    if (!bikeIdSchema.safeParse(id).success)
      throw notFound("Велосипед не найден.");
    const viewer = await viewerFromCredential(db, credential);
    // A private bike, a blocked owner's bike and a missing one look the same.
    const bike = await visibleBikeById(
      db,
      id,
      viewer?.id ?? null,
      await getSite(db),
    );
    if (!bike) throw notFound("Велосипед не найден.");
    return ok(toBike(bike));
  });
}

/** GET /api/v1/openapi.json: the contract of exactly what is implemented. */
export function handleOpenApi() {
  return safely(async () =>
    ok(buildOpenApiDocument(), 200, { "Cache-Control": "public, max-age=300" }),
  );
}

/** Any other address under /api/v1. */
export function handleUnknownPath() {
  return safely(async () => {
    throw notFound("Такого адреса в API v1 нет.");
  });
}
