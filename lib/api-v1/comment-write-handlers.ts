import {
  commentKeysetPage,
  createComment,
  changeComment,
} from "../comments.ts";
import { CommunityError } from "../community-validation.ts";
import { transaction } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { limits } from "../limits.ts";
import { audit } from "../site.ts";
import type { Queryable } from "../db.ts";
import { ApiError, notFound } from "./errors.ts";
import { idempotencyKey, idempotent } from "./idempotency.ts";
import {
  engineOf,
  idOf,
  rideReadable,
  targetMissing,
} from "./journal-handlers.ts";
import type { Target } from "./journal-handlers.ts";
import { toComment } from "./mappers.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  createCommentRequestSchema,
  editCommentRequestSchema,
} from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";

// Writing comments through /api/v1 (#330). The engine is the site's own
// (`createComment`/`changeComment` and the wrappers of journal entries, rides
// and component models), so who may write, the locks and the notices are the
// same. What this layer adds are the conventions of #305: the credential's
// Origin rule, a request body of its own, the shared budgets, the verified
// e-mail policy and idempotent creation.

type CommentParams = { params: Promise<{ id: string; commentId: string }> };
type ObjectParams = { params: Promise<{ id: string }> };

/** The tables a comment of each object lives in, to check it belongs to the path. */
const homes: Record<Target, { table: string; key: string }> = {
  bike: { table: "bike_comments", key: "bike_id" },
  journal: { table: "journal_comments", key: "entry_id" },
  ride: { table: "ride_comments", key: "ride_id" },
  component: { table: "component_comments", key: "model_id" },
};

/** The engines throw their own errors; the API answers them in its envelope. */
async function throughEngine<T>(run: () => Promise<T>, missing: string) {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof CommunityError)) throw error;
    if (error.status === 404) throw notFound(missing);
    if (error.status === 403) throw new ApiError("forbidden", error.message);
    if (error.status === 429) throw new ApiError("rate_limited", error.message);
    throw new ApiError("invalid_request", error.message);
  }
}

/** The comment as the lists show it, read inside the transaction that wrote it. */
async function commentOf(
  q: Queryable,
  target: Target,
  id: string,
  commentId: string,
) {
  const engine = engineOf(target);
  const options = { limit: 1, cursor: null, focus: commentId };
  const page = await throughEngine(
    () =>
      engine
        ? engine.keysetPage(q, id, options)
        : commentKeysetPage(q, id, options),
    "Комментарий не найден.",
  );
  const row = page.focusPath[page.focusPath.length - 1];
  if (!row) throw notFound("Комментарий не найден.");
  return toComment(row);
}

/** A comment of another object under this path is not found, not edited. */
async function belongsTo(
  q: Queryable,
  target: Target,
  id: string,
  commentId: string,
) {
  const { table, key } = homes[target];
  // A merged component model keeps answering for the comments it had.
  const match =
    target === "component"
      ? `c.${key} IN (SELECT m.id FROM component_models m WHERE m.id=$2 OR m.merged_into=$2)`
      : `c.${key}=$2`;
  const found = await q.query(
    `SELECT 1 FROM ${table} c WHERE c.id=$1 AND ${match}`,
    [commentId, id],
  );
  if (!found.rows.length) throw notFound("Комментарий не найден.");
}

function createOf(target: Target) {
  return (req: Request, { params }: ObjectParams) =>
    safely(async () => {
      const viewer = await writer(req);
      const id = idOf((await params).id, targetMissing(target));
      requireVerifiedEmail(viewer);
      const input = await parseJsonBody(req, createCommentRequestSchema, 8192);
      await rideReadable(id, target);
      const engine = engineOf(target);
      // The site's budget of new comments: one for both transports. With a
      // key, a replay of a stored answer must not spend it, so the allowance
      // is taken inside the transaction, by the request that creates.
      const key = idempotencyKey(req.headers);
      const budget = "comments:" + viewer.id;
      if (key === null) await limited(budget, limits.comments);
      const { response, replayed } = await idempotent(
        transaction,
        {
          userId: viewer.id,
          route: `POST ${new URL(req.url).pathname}`,
          key,
          body: input,
        },
        async (q) => {
          if (key !== null) await limitedIn(q, budget, limits.comments);
          const created = await throughEngine(
            () =>
              engine
                ? engine.create(q, id, viewer, input)
                : createComment(q, id, viewer, input),
            targetMissing(target),
          );
          return {
            status: 201,
            body: await commentOf(q, target, id, created.id),
          };
        },
      );
      return ok(
        response.body,
        response.status,
        replayed ? { "Idempotency-Replayed": "true" } : {},
      );
    });
}

function editOf(target: Target) {
  return (req: Request, { params }: CommentParams) =>
    safely(async () => {
      const viewer = await writer(req);
      const { id: rawId, commentId: rawComment } = await params;
      const id = idOf(rawId, targetMissing(target));
      const commentId = idOf(rawComment, "Комментарий не найден.");
      requireVerifiedEmail(viewer);
      const input = await parseJsonBody(req, editCommentRequestSchema, 8192);
      await limited("comment-edit:" + viewer.id, limits.commentEdits);
      await rideReadable(id, target);
      const engine = engineOf(target);
      const comment = await transaction(async (q) => {
        await belongsTo(q, target, id, commentId);
        await throughEngine(
          () =>
            engine
              ? engine.change(q, commentId, viewer, input.body)
              : changeComment(q, commentId, viewer, input.body),
          "Комментарий не найден.",
        );
        return commentOf(q, target, id, commentId);
      });
      return ok(comment);
    });
}

function removeOf(target: Target) {
  return (req: Request, { params }: CommentParams) =>
    safely(async () => {
      const viewer = await writer(req);
      const { id: rawId, commentId: rawComment } = await params;
      const id = idOf(rawId, targetMissing(target));
      const commentId = idOf(rawComment, "Комментарий не найден.");
      await limited("comment-edit:" + viewer.id, limits.commentEdits);
      await rideReadable(id, target);
      const engine = engineOf(target);
      await transaction(async (q) => {
        await belongsTo(q, target, id, commentId);
        await throughEngine(
          () =>
            engine
              ? engine.change(q, commentId, viewer, null)
              : changeComment(q, commentId, viewer, null),
          "Комментарий не найден.",
        );
        // A moderator's deletion is on the record, as on the site.
        if (viewer.role === "admin")
          await audit(q, viewer.id, "community.comment.delete", commentId);
      });
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
}

/** POST /api/v1/{bikes,journal,rides,component-models}/{id}/comments */
export const handleCreateBikeComment = createOf("bike");
export const handleCreateJournalComment = createOf("journal");
export const handleCreateRideComment = createOf("ride");
export const handleCreateComponentComment = createOf("component");
/** PATCH …/comments/{commentId} */
export const handleEditBikeComment = editOf("bike");
export const handleEditJournalComment = editOf("journal");
export const handleEditRideComment = editOf("ride");
export const handleEditComponentComment = editOf("component");
/** DELETE …/comments/{commentId} */
export const handleDeleteBikeComment = removeOf("bike");
export const handleDeleteJournalComment = removeOf("journal");
export const handleDeleteRideComment = removeOf("ride");
export const handleDeleteComponentComment = removeOf("component");
