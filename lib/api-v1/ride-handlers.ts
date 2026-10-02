import { db } from "../db.ts";
import {
  apiRideRow,
  publicRideAnalysis,
  rideKeysetPage,
  upcomingKeysetPage,
} from "../rides.ts";
import { readableBikeSql } from "../bike-visibility.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { notFound } from "./errors.ts";
import { idOf } from "./journal-handlers.ts";
import { toRide, toRideAnalysis, toRideSummary } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import { parsePageQuery } from "./schemas.ts";
import { viewerOf } from "./viewer.ts";

// Ride reads of /api/v1 (#302). Who may see what is decided in lib/rides.ts by
// the legacy public rule (`effectiveRide`) and "not called off"; a hidden,
// private, called-off, blocked-author or missing ride is the same 404. The
// geometry and the series are the stored public ones, so a point inside the
// privacy zone of the start or the end is not in any response.

type IdParams = { params: Promise<{ id: string }> };

const notFoundRide = () => notFound("Покатушка не найдена.");

type Page = typeof rideKeysetPage | typeof upcomingKeysetPage;

async function listPage(
  req: Request,
  page: Page,
  bike: Promise<{ id: string }> | null,
) {
  const viewer = await viewerOf(req.headers);
  const query = parsePageQuery(new URL(req.url));
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  let bikeId: string | null = null;
  if (bike) {
    bikeId = idOf((await bike).id, "Велосипед не найден.");
    const seen = await db.query(
      `SELECT 1 FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND ${readableBikeSql("$2")}`,
      [bikeId, viewer?.id ?? null],
    );
    if (!seen.rowCount) throw notFound("Велосипед не найден.");
  }
  const result = await page(db, viewer?.id ?? null, {
    bikeId,
    limit: query.limit,
    after,
  });
  return ok({
    items: result.rows.map((row) => toRideSummary(row, viewer?.id ?? null)),
    nextCursor: result.next ? encodeCursor(result.next) : null,
  });
}

/** GET /api/v1/rides: finished public rides, newest first. */
export const handleListRides = (req: Request) =>
  safely(() => listPage(req, rideKeysetPage, null));
/** GET /api/v1/bikes/{id}/rides */
export const handleBikeRides = (req: Request, { params }: IdParams) =>
  safely(() => listPage(req, rideKeysetPage, params));
/** GET /api/v1/rides/upcoming: public plans, soonest first. */
export const handleUpcomingRides = (req: Request) =>
  safely(() => listPage(req, upcomingKeysetPage, null));

/** GET /api/v1/rides/{id} */
export function handleGetRide(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const id = idOf((await params).id, "Покатушка не найдена.");
    const row = await apiRideRow(db, id, viewer?.id ?? null);
    if (!row) throw notFoundRide();
    return ok(toRide(row, viewer?.id ?? null));
  });
}

/** GET /api/v1/rides/{id}/analysis: the public series, separate from the card. */
export function handleRideAnalysis(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const id = idOf((await params).id, "Покатушка не найдена.");
    const row = await apiRideRow(db, id, viewer?.id ?? null);
    if (!row) throw notFoundRide();
    const series = await publicRideAnalysis(db, row);
    if (!series) throw notFound("Разбор трека недоступен.");
    return ok(toRideAnalysis(series));
  });
}
