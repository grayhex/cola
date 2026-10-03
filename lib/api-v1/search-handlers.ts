import { CommunityError } from "../community-validation.ts";
import { componentHits } from "../discovery.ts";
import { db } from "../db.ts";
import {
  experienceBikeRefine,
  experienceJournalKeyset,
  experienceUserKeyset,
} from "../search.ts";
import type { SearchInput } from "../search.ts";
import { visibleBikePage } from "../showcase.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError, notFound } from "./errors.ts";
import { toBikeSummary, toJournalSummary, toUserSummary } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import {
  parseComponentSearchQuery,
  parseExperienceQuery,
  parseUsersSearchQuery,
} from "./schemas.ts";
import { viewerOf } from "./viewer.ts";

// Search of /api/v1 (#315). The site's two searches keep their rules: the
// discovery search (a literal match) for component suggestions and the
// experience search (the catalog's spelling rules, facets, classification) for
// bikes, journal entries and people. Every list is a keyset page with the same
// visibility as the lists they search: a hidden object cannot be found by
// searching for it. Each type is its own operation with the DTO of its own
// list, so that no response needs a discriminated union.

/** The experience query as the library takes it. */
function searchInput(
  query: ReturnType<typeof parseExperienceQuery>,
  type: SearchInput["type"],
): SearchInput {
  const { limit: _limit, cursor: _cursor, ...facets } = query;
  void _limit;
  void _cursor;
  return { ...facets, type, page: 1 };
}

/**
 * The engines throw their own errors: a 404 for a "similar" bike that is not
 * public, a 400 for a facet the catalog does not know (a purpose). Both are
 * answered in the API's envelope. The deferred conditions of the bike page run
 * inside it, so the whole call is wrapped.
 */
async function found<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommunityError && error.status === 404)
      throw notFound("Велосипед не найден.");
    if (error instanceof CommunityError && error.status === 400)
      throw new ApiError("invalid_request", "Проверьте параметры запроса.", {
        details: [{ path: "purpose", message: error.message }],
      });
    throw error;
  }
}

/** GET /api/v1/experience/bikes */
export function handleExperienceBikes(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parseExperienceQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const input = searchInput(query, "bikes");
    const page = await found(async () =>
      visibleBikePage(db, viewer?.id ?? null, {
        scope: "public",
        categories: [],
        search: "",
        limit: query.limit,
        after,
        refine: await experienceBikeRefine(db, input),
      }),
    );
    return ok({
      items: page.bikes.map(toBikeSummary),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/experience/journal */
export function handleExperienceJournal(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parseExperienceQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await found(() =>
      experienceJournalKeyset(
        db,
        viewer?.id ?? null,
        searchInput(query, "journal"),
        query.limit,
        after,
      ),
    );
    return ok({
      items: page.rows.map((row) => toJournalSummary(row, viewer?.id ?? null)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/experience/users */
export function handleExperienceUsers(req: Request) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parseUsersSearchQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await experienceUserKeyset(
      db,
      viewer?.id ?? null,
      query.q,
      query.limit,
      after,
    );
    return ok({
      items: page.rows.map((row) => toUserSummary(row, !!viewer)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/search/components */
export function handleSearchComponents(req: Request) {
  return safely(async () => {
    await viewerOf(req.headers);
    const query = parseComponentSearchQuery(new URL(req.url));
    return ok({ items: await componentHits(db, query.q, query.limit) });
  });
}
