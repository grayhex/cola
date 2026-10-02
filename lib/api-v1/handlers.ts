import { db } from "../db.ts";
import { followKeysetPage } from "../follows.ts";
import { profileCounts, profileRow, profileRowById } from "../profiles.ts";
import { getSite } from "../site.ts";
import { visibleBikeById, visibleBikePage } from "../showcase.ts";
import { viewerOf } from "./viewer.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError, notFound } from "./errors.ts";
import {
  toBike,
  toBikeSummary,
  toMe,
  toProfile,
  toUserSummary,
} from "./mappers.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { ok, safely } from "./respond.ts";
import {
  bikeIdSchema,
  categoriesOf,
  parseListQuery,
  parsePageQuery,
  userRefSchema,
} from "./schemas.ts";

// The /api/v1 endpoints (#134). Each is a thin HTTP layer: who is asking,
// which parameters are valid, which DTO to answer, which status. The rules of
// who may read what live in lib/showcase.ts and lib/viewer-session.ts, shared
// with the web pages and the legacy API.

const signIn = () => new ApiError("unauthorized", "Войдите в аккаунт.");

/** GET /api/v1/me */
export function handleMe(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    if (!viewer) throw signIn();
    return ok(toMe(viewer));
  });
}

/** GET /api/v1/bikes */
export function handleListBikes(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parseListQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
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
    const viewer = await viewerOf(req.headers);
    const { id } = await params;
    // A value that is not a UUID cannot name a bike.
    if (!bikeIdSchema.safeParse(id).success)
      throw notFound("Велосипед не найден.");
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

/**
 * The profile `{ref}` names for this viewer, or a 404: an unknown or malformed
 * ref, a blocked person and an old username all look the same. Only the
 * current username resolves; the stable key is the id.
 */
async function profileOf(ref: string, viewerId: string | null) {
  const parsed = userRefSchema.safeParse(ref);
  const row = !parsed.success
    ? null
    : "id" in parsed.data
      ? await profileRowById(db, parsed.data.id, viewerId)
      : await profileRow(db, parsed.data.username, viewerId);
  if (!row) throw notFound("Профиль не найден.");
  return row;
}

type UserParams = { params: Promise<{ ref: string }> };

/** GET /api/v1/users/{ref} */
export function handleGetUser(req: Request, { params }: UserParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const row = await profileOf((await params).ref, viewer?.id ?? null);
    return ok(toProfile(row, await profileCounts(db, row.id), !!viewer));
  });
}

/** GET /api/v1/users/{ref}/bikes: the person's public bikes, newest first. */
export function handleUserBikes(req: Request, { params }: UserParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const row = await profileOf((await params).ref, viewer?.id ?? null);
    // The same page and the same visibility rule as /bikes, narrowed to one
    // owner. A private bike never appears here, the owner's own included.
    const page = await visibleBikePage(db, viewer?.id ?? null, {
      scope: "public",
      categories: [],
      search: "",
      limit: query.limit,
      after,
      ownerId: row.id,
    });
    return ok({
      items: page.bikes.map(toBikeSummary),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

function followList(kind: "followers" | "following") {
  return (req: Request, { params }: UserParams) =>
    safely(async () => {
      const viewer = await viewerOf(req.headers);
      const query = parsePageQuery(new URL(req.url));
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const row = await profileOf((await params).ref, viewer?.id ?? null);
      const page = await followKeysetPage(
        db,
        row.id,
        viewer?.id ?? null,
        kind,
        query.limit,
        after,
      );
      return ok({
        items: page.rows.map((person) => toUserSummary(person, !!viewer)),
        nextCursor: page.next ? encodeCursor(page.next) : null,
      });
    });
}

/** GET /api/v1/users/{ref}/followers and /following */
export const handleUserFollowers = followList("followers");
export const handleUserFollowing = followList("following");

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
