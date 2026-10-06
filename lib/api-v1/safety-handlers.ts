import { CommunityError } from "../community-validation.ts";
import { db, transaction } from "../db.ts";
import { limits } from "../limits.ts";
import { createReport } from "../reports.ts";
import { blockedKeysetPage, setBlock } from "../user-blocks.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError, notFound } from "./errors.ts";
import { profileOf } from "./handlers.ts";
import { toUserSummary } from "./mappers.ts";
import { signedIn } from "./personal-handlers.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  createReportRequestSchema,
  parseNoQuery,
  parsePageQuery,
} from "./schemas.ts";
import { limited, writer } from "./write.ts";

// Safety for the people of the app (#354): blocking a person and reporting an
// object. The rules are the site's (`setBlock` is new, `createReport` is the
// one behind the site's report buttons), so a report from the phone reaches the
// same admin queue as a report from the page.

type UserParams = { params: Promise<{ ref: string }> };

/** PUT/DELETE /api/v1/users/{ref}/block */
export function handleBlock(req: Request, { params }: UserParams) {
  return safely(async () => {
    const viewer = await writer(req);
    parseNoQuery(new URL(req.url));
    const enabled = req.method === "PUT";
    // An unblock is looked up in the same way: a person the site has blocked
    // has no profile, and the list does not show them either.
    const target = await profileOf((await params).ref, viewer.id);
    await limited("block:" + viewer.id, limits.follows);
    const result = await transaction((q) =>
      setBlock(q, viewer.id, target.id, enabled),
    );
    if (result.error !== undefined)
      throw result.status === 404
        ? notFound(result.error)
        : new ApiError(
            result.status === 401 ? "unauthorized" : "invalid_request",
            result.error,
          );
    return ok({ blocked: result.blocked });
  });
}

/** GET /api/v1/me/blocked: the people the viewer has blocked, newest first. */
export function handleBlockedPeople(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const page = await blockedKeysetPage(db, viewer.id, query.limit, after);
    return ok({
      items: page.rows.map((person) => toUserSummary(person, true)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** POST /api/v1/reports */
export function handleCreateReport(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    parseNoQuery(new URL(req.url));
    const body = await parseJsonBody(req, createReportRequestSchema, 2048);
    await limited("reports:" + viewer.id, limits.reports);
    try {
      const result = await transaction((q) => createReport(q, viewer, body));
      return ok({ created: result.created });
    } catch (error) {
      if (!(error instanceof CommunityError)) throw error;
      if (error.status === 404) throw notFound("Объект недоступен.");
      throw new ApiError("invalid_request", error.message);
    }
  });
}
