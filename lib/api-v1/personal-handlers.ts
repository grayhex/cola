import { db } from "../db.ts";
import { savedKeysetPage } from "../journal-discovery.ts";
import { savedApiKeysetPage } from "../market.ts";
import { notificationKeysetPage, unreadCount } from "../notifications.ts";
import { myUpcomingEntries, ownRideKeysetPage } from "../rides.ts";
import { noticeExpiringListings } from "../market.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError } from "./errors.ts";
import {
  toJournalSummary,
  toMarketListing,
  toMyUpcomingRide,
  toNotification,
  toOwnRideSummary,
} from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import { parseNoQuery, parsePageQuery } from "./schemas.ts";
import { authenticate } from "./viewer.ts";

// Personal reads of /api/v1 (#321): only for the person asking, so a guest is
// 401 and nothing is shared between two people (`no-store` as everywhere). The
// services are the site's, with a cursor in place of OFFSET: what a notice
// says and which saved entries still show is decided at read time.

async function signedIn(req: Request) {
  const { viewer } = await authenticate(req.headers);
  if (!viewer) throw new ApiError("unauthorized", "Войдите в аккаунт.");
  return viewer;
}

/** GET /api/v1/me/notifications */
export function handleNotifications(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    // As on the site, reading the notices is when the end of a listing's term
    // is noticed; once per term.
    await noticeExpiringListings(db, viewer.id);
    const page = await notificationKeysetPage(
      db,
      viewer.id,
      query.limit,
      after,
    );
    return ok({
      items: page.items.map(toNotification),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/me/notifications/count */
export function handleNotificationCount(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    // No parameters: a typo is an error, not a silent default.
    parseNoQuery(new URL(req.url));
    await noticeExpiringListings(db, viewer.id);
    return ok(await unreadCount(db, viewer.id));
  });
}

/** GET /api/v1/me/saved/journal */
export function handleSavedJournal(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await savedKeysetPage(db, viewer.id, query.limit, after);
    return ok({
      items: page.rows.map((row) => toJournalSummary(row, viewer.id)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/me/saved/market */
export function handleSavedMarket(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await savedApiKeysetPage(db, viewer.id, query.limit, after);
    return ok({
      items: page.items.map(toMarketListing),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/me/rides */
export function handleMyRides(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await ownRideKeysetPage(db, viewer.id, {
      limit: query.limit,
      after,
    });
    return ok({
      items: page.rows.map((row) => toOwnRideSummary(row, viewer.id)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/me/rides/upcoming */
export function handleMyUpcomingRides(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    // A short list without a cursor: no parameters at all.
    parseNoQuery(new URL(req.url));
    const entries = await myUpcomingEntries(db, viewer.id);
    return ok({ items: entries.map((e) => toMyUpcomingRide(e, viewer.id)) });
  });
}
