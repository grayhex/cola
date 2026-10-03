import {
  componentCatalogFilters,
  componentModelCard,
  componentModelKeysetPage,
} from "../component-catalog.ts";
import { CommunityError } from "../community-validation.ts";
import { componentPhotoList } from "../component-photos.ts";
import { productCategory } from "../component-products.ts";
import { db } from "../db.ts";
import {
  decodeCursor,
  decodeRankCursor,
  encodeCursor,
  encodeRankCursor,
} from "./cursor.ts";
import { notFound } from "./errors.ts";
import { idOf } from "./journal-handlers.ts";
import { toComponentModel, toComponentPhoto } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import { parseComponentCatalogQuery } from "./schemas.ts";
import { viewerOf } from "./viewer.ts";

// Component catalog reads of /api/v1 (#317). The catalog is public data: which
// models exist, how many public bikes carry them and their photos. Who built
// with them, installations and private dates never leave the service. A model
// that was merged away leads to the one it was merged into; one that is not
// published, and an unknown id, are the same 404.

type IdParams = { params: Promise<{ id: string }> };
const missing = () => notFound("Модель не найдена.");

/** GET /api/v1/component-models */
export function handleComponentModels(req: Request) {
  return safely(async () => {
    await viewerOf(req.headers);
    const query = parseComponentCatalogQuery(new URL(req.url));
    // The cursor of the order in use; the other's shape is refused as a 400.
    const after = query.cursor
      ? query.sort === "new"
        ? decodeCursor(query.cursor)
        : decodeRankCursor(query.cursor)
      : null;
    const page = await componentModelKeysetPage(db, {
      q: query.q,
      category: productCategory(query.category) || query.category,
      brand: query.brand,
      sort: query.sort,
      limit: query.limit,
      after,
    });
    return ok({
      items: page.rows.map(toComponentModel),
      nextCursor: !page.next
        ? null
        : "rank" in page.next
          ? encodeRankCursor(page.next)
          : encodeCursor(page.next),
    });
  });
}

/** GET /api/v1/component-models/filters */
export function handleComponentFilters(req: Request) {
  return safely(async () => {
    await viewerOf(req.headers);
    return ok(await componentCatalogFilters(db));
  });
}

/** GET /api/v1/component-models/{id} */
export function handleGetComponentModel(req: Request, { params }: IdParams) {
  return safely(async () => {
    await viewerOf(req.headers);
    const id = idOf((await params).id, "Модель не найдена.");
    const row = await componentModelCard(db, id);
    if (!row) throw missing();
    return ok(toComponentModel(row));
  });
}

/** GET /api/v1/component-models/{id}/photos */
export function handleComponentPhotos(req: Request, { params }: IdParams) {
  return safely(async () => {
    await viewerOf(req.headers);
    const id = idOf((await params).id, "Модель не найдена.");
    try {
      const gallery = await componentPhotoList(db, id);
      return ok({
        modelId: gallery.modelId,
        items: gallery.rows.map((row, index) =>
          toComponentPhoto(row, index === 0),
        ),
      });
    } catch (error) {
      if (error instanceof CommunityError && error.status === 404)
        throw missing();
      throw error;
    }
  });
}
