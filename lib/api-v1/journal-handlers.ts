import { db } from "../db.ts";
import { commentKeysetPage, replyKeysetPage } from "../comments.ts";
import { CommunityError } from "../community-validation.ts";
import { entitySocial } from "../entity-social.ts";
import { journalKeysetPage, journalPhotos, journalRow } from "../journal.ts";
import { readableBikeSql } from "../bike-visibility.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { notFound } from "./errors.ts";
import { toComment, toJournalEntry, toJournalSummary } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import { bikeIdSchema, parseCommentsQuery, parsePageQuery } from "./schemas.ts";
import { viewerOf } from "./viewer.ts";

// Journal and comment reads of /api/v1 (#301). Who may read what is decided by
// the shared rules: `journalPublic` for entries (an owner sees their own
// drafts), `readable()` for comments (a hidden comment is a tombstone only
// while a readable reply remains), and the same predicates as the web pages.

type IdParams = { params: Promise<{ id: string }> };
type ReplyParams = { params: Promise<{ id: string; commentId: string }> };

/** The engines throw their own 404; the API answers it in its own envelope. */
async function readable<T>(run: () => Promise<T>, what: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommunityError && error.status === 404)
      throw notFound(what);
    throw error;
  }
}

/** A path id must be a UUID; anything else cannot name an object. */
function idOf(value: string, what: string) {
  if (!bikeIdSchema.safeParse(value).success) throw notFound(what);
  return value.toLowerCase();
}

/** GET /api/v1/bikes/{id}/journal */
export function handleBikeJournal(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const query = parsePageQuery(new URL(req.url));
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const bike = idOf((await params).id, "Велосипед не найден.");
    // A private or blocked owner's bike and a missing one look the same.
    const seen = await db.query(
      `SELECT 1 FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND ${readableBikeSql("$2")}`,
      [bike, viewer?.id ?? null],
    );
    if (!seen.rowCount) throw notFound("Велосипед не найден.");
    const page = await journalKeysetPage(
      db,
      bike,
      viewer?.id ?? null,
      query.limit,
      after,
    );
    return ok({
      items: page.rows.map((row) => toJournalSummary(row, viewer?.id ?? null)),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  });
}

/** GET /api/v1/journal/{id} */
export function handleGetJournalEntry(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await viewerOf(req.headers);
    const id = idOf((await params).id, "Запись не найдена.");
    const row = await journalRow(db, id, viewer?.id ?? null, "id");
    if (!row) throw notFound("Запись не найдена.");
    return ok(
      toJournalEntry(row, await journalPhotos(db, row.id), viewer?.id ?? null),
    );
  });
}

type Target = "bike" | "journal";
const entryComments = entitySocial("journal");
const targetMissing = (target: Target) =>
  target === "bike" ? "Велосипед не найден." : "Запись не найдена.";

function commentsOf(target: Target) {
  return (req: Request, { params }: IdParams) =>
    safely(async () => {
      // A bad Bearer token is refused here too; the comments themselves are
      // the same for every reader.
      await viewerOf(req.headers);
      const query = parseCommentsQuery(new URL(req.url));
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const id = idOf((await params).id, targetMissing(target));
      const options = {
        limit: query.limit,
        cursor,
        focus: query.focus ?? null,
      };
      const page = await readable(
        () =>
          target === "bike"
            ? commentKeysetPage(db, id, options)
            : entryComments.keysetPage(db, id, options),
        query.focus ? "Комментарий не найден." : targetMissing(target),
      );
      return ok({
        items: page.roots.map((thread) => ({
          comment: toComment(thread.comment),
          replies: thread.replies.map(toComment),
        })),
        nextCursor: page.next ? encodeCursor(page.next) : null,
        focusPath: page.focusPath.map(toComment),
      });
    });
}

function repliesOf(target: Target) {
  return (req: Request, { params }: ReplyParams) =>
    safely(async () => {
      await viewerOf(req.headers);
      const query = parsePageQuery(new URL(req.url));
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const { id: rawId, commentId } = await params;
      const id = idOf(rawId, targetMissing(target));
      const parent = idOf(commentId, "Комментарий не найден.");
      const options = { limit: query.limit, cursor };
      const page = await readable(
        () =>
          target === "bike"
            ? replyKeysetPage(db, id, parent, options)
            : entryComments.keysetReplies(db, id, parent, options),
        "Комментарий не найден.",
      );
      return ok({
        items: page.replies.map(toComment),
        nextCursor: page.next ? encodeCursor(page.next) : null,
      });
    });
}

/** GET /api/v1/bikes/{id}/comments and /api/v1/journal/{id}/comments */
export const handleBikeComments = commentsOf("bike");
export const handleJournalComments = commentsOf("journal");
/** GET …/comments/{commentId}/replies */
export const handleBikeReplies = repliesOf("bike");
export const handleJournalReplies = repliesOf("journal");
