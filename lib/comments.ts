import type { CurrentUser as CurrentUserType } from "./contracts.ts";
import type { CommentInput as CommentInputType } from "./community-validation.ts";
export type CommentActor = Pick<CurrentUserType, "id" | "role">;
export interface CommentRow {
  id: string;
  bike_id: string;
  parent_id: string | null;
  body: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  author_id: string | null;
  username: string | null;
  name: string | null;
  avatar_id: string | null;
  blocked: boolean | null;
  reply_count?: number;
}
export type CommentPageArgs = [
  bikeId: string,
  user: CommentActor | null,
  page?: number,
  focus?: string | null,
];
export type ReplyPageArgs = [
  bikeId: string,
  parent: string,
  user: CommentActor | null,
  page?: number,
];
export type ChangeCommentArgs = [
  id: string,
  user: CommentActor,
  body?: string | null,
];
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { publicAuthor } from "./profile-dto.ts";
import { notify } from "./notifications.ts";
import { CommunityError } from "./community-validation.ts";
import { parseRichText } from "./rich-text.ts";
const alive = "c.deleted_at IS NULL AND a.id IS NOT NULL AND NOT a.blocked";
const columns =
  "c.id,c.bike_id,c.parent_id,c.body,c.created_at,c.updated_at,c.deleted_at,a.id AS author_id,a.username,a.name,a.avatar_id,a.blocked";
// A hidden node is only a structural tombstone when a readable descendant
// remains. Walk by the existing parent index; never return hidden text/authors.
function readable(comment: string, author: string) {
  return `(${comment}.deleted_at IS NULL AND ${author}.id IS NOT NULL AND NOT ${author}.blocked) OR EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT d.id,d.author_id,d.deleted_at FROM bike_comments d WHERE d.parent_id=${comment}.id
      UNION ALL
      SELECT d.id,d.author_id,d.deleted_at FROM bike_comments d JOIN descendants p ON d.parent_id=p.id
    ) SELECT 1 FROM descendants d JOIN users da ON da.id=d.author_id
      WHERE d.deleted_at IS NULL AND NOT da.blocked
  )`;
}
const childCount = `(SELECT count(*)::int FROM bike_comments r LEFT JOIN users ra ON ra.id=r.author_id WHERE r.parent_id=c.id AND (${readable("r", "ra")})) AS reply_count`;
const nodeColumns = `${columns},${childCount}`;
export const visibleCommentCount = `SELECT count(*)::int FROM bike_comments cc JOIN users ca ON ca.id=cc.author_id WHERE cc.bike_id=b.id AND cc.deleted_at IS NULL AND NOT ca.blocked`;
export async function publicCommentBike(q: Queryable, id: string) {
  const b = (
    await q.query<{ id: string; owner_id: string; share_id: string }>(
      "SELECT b.id,b.owner_id,b.share_id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked",
      [id],
    )
  ).rows[0];
  if (!b) throw new CommunityError("Велосипед недоступен", 404);
  return b;
}
export function commentDto(
  row: CommentRow,
  user: Pick<CurrentUserType, "id" | "role"> | null,
) {
  const hidden = !!row.deleted_at || !row.author_id || row.blocked;
  return {
    id: row.id,
    parentId: row.parent_id,
    replyCount: Number(row.reply_count || 0),
    body: hidden ? null : row.body,
    // Parsed here, so readers render comments without the parser (#117).
    bodyDoc: hidden ? null : parseRichText(row.body),
    author: hidden
      ? null
      : publicAuthor({
          id: row.author_id!,
          username: row.username!,
          name: row.name!,
          avatar_id: row.avatar_id,
        }),
    createdAt: row.created_at,
    updatedAt: hidden ? null : row.updated_at,
    unavailable: hidden,
    canEdit: !hidden && user?.id === row.author_id,
    canDelete:
      !hidden && !!user && (user.id === row.author_id || user.role === "admin"),
  };
}
/** The chain from a readable comment up to its root, root first (a deep link). */
async function focusChain(q: Queryable, bikeId: string, focus: string) {
  return (
    await q.query<CommentRow>(
      `WITH RECURSIVE path AS (
          SELECT c.*,0 AS depth FROM bike_comments c JOIN users a ON a.id=c.author_id
          WHERE c.id=$1 AND c.bike_id=$2 AND ${alive}
          UNION ALL
          SELECT c.*,p.depth+1 FROM bike_comments c JOIN path p ON c.id=p.parent_id
        ) SELECT ${nodeColumns} FROM path c LEFT JOIN users a ON a.id=c.author_id ORDER BY c.depth DESC`,
      [focus, bikeId],
    )
  ).rows;
}
/** The first three readable replies of each root, plus the focused chain's nodes. */
async function replyPreviews(q: Queryable, ids: string[], focusIds: string[]) {
  if (!ids.length) return [];
  return (
    await q.query<CommentRow>(
      `SELECT ${nodeColumns} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
          WHERE c.id IN (
            SELECT preview.id FROM unnest($1::uuid[]) roots(parent_id)
            CROSS JOIN LATERAL (
              SELECT c.id FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
              WHERE c.parent_id=roots.parent_id AND (${readable("c", "a")})
              ORDER BY c.created_at,c.id LIMIT 3
            ) preview
            UNION SELECT id FROM bike_comments WHERE id=ANY($2::uuid[]) AND parent_id=ANY($1::uuid[])
          ) ORDER BY c.created_at,c.id`,
      [ids, focusIds],
    )
  ).rows;
}
export async function commentPage(
  q: Queryable,
  bikeId: string,
  user: Pick<CurrentUserType, "id" | "role"> | null,
  page = 1,
  focus: string | null = null,
) {
  await publicCommentBike(q, bikeId);
  // Only the ancestor chain, not the entire subtree, accompanies a deep link.
  const focusRows = focus ? await focusChain(q, bikeId, focus) : [];
  if (focus && !focusRows.length)
    throw new CommunityError("Комментарий недоступен", 404);
  const root = focusRows[0]?.id || null;
  const rows = (
    await q.query<CommentRow>(
      `SELECT ${nodeColumns} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
 WHERE c.bike_id=$1 AND c.parent_id IS NULL AND ($3::uuid IS NULL OR c.id=$3) AND (${readable("c", "a")})
 ORDER BY c.created_at,c.id LIMIT 21 OFFSET $2`,
      [bikeId, root ? 0 : (page - 1) * 20, root],
    )
  ).rows;
  const roots = rows.slice(0, 20),
    ids = roots.map((r) => r.id);
  const replies = await replyPreviews(
    q,
    ids,
    focusRows.map((r) => r.id),
  );
  return {
    comments: roots.map((r) => ({
      ...commentDto(r, user),
      replies: replies
        .filter((x) => x.parent_id === r.id)
        .map((x) => commentDto(x, user)),
    })),
    page,
    hasMore: !root && rows.length > 20,
    focused: !!root,
    focusPath: focusRows.map((r) => commentDto(r, user)),
  };
}
export async function replyPage(
  q: Queryable,
  bikeId: string,
  parent: string,
  user: Pick<CurrentUserType, "id" | "role"> | null,
  page = 1,
) {
  await publicCommentBike(q, bikeId);
  const root = (
    await q.query<{ "?column?": number }>(
      "SELECT 1 FROM bike_comments WHERE id=$1 AND bike_id=$2",
      [parent, bikeId],
    )
  ).rows[0];
  if (!root) throw new CommunityError("Обсуждение недоступно", 404);
  const rows = (
    await q.query<CommentRow>(
      `SELECT ${nodeColumns} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id WHERE c.parent_id=$1 AND (${readable("c", "a")}) ORDER BY c.created_at,c.id LIMIT 21 OFFSET $2`,
      [parent, (page - 1) * 20],
    )
  ).rows;
  return {
    comments: rows.slice(0, 20).map((r) => commentDto(r, user)),
    page,
    hasMore: rows.length > 20,
  };
}
// Keyset flavours for API v1 (#301): the same rows, the same `readable` rule
// and the same previews as the pages above, but by position instead of OFFSET.
// The order is oldest first, then id; `cursorAt` is the creation time as
// PostgreSQL prints it (microseconds), so equal milliseconds neither repeat
// nor drop a comment.
export interface CommentCursor {
  createdAt: string;
  id: string;
}
const cursorColumn = `to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`;
type KeysetRow = CommentRow & { cursor_at: string };
const after = (cursor: CommentCursor | null) => [
  cursor?.createdAt ?? null,
  cursor?.id ?? null,
];
const nextOf = (rows: KeysetRow[], limit: number): CommentCursor | null => {
  const last = rows[limit - 1];
  return rows.length > limit && last
    ? { createdAt: last.cursor_at, id: last.id }
    : null;
};

/** Root comments of a bike by position, with a preview of three replies each. */
export async function commentKeysetPage(
  q: Queryable,
  bikeId: string,
  {
    limit,
    cursor,
    focus,
  }: { limit: number; cursor: CommentCursor | null; focus: string | null },
) {
  await publicCommentBike(q, bikeId);
  const chain = focus ? await focusChain(q, bikeId, focus) : [];
  if (focus && !chain.length)
    throw new CommunityError("Комментарий недоступен", 404);
  // A deep link shows its own thread; paging is for the plain list.
  const root = chain[0]?.id ?? null;
  const [at, id] = after(cursor);
  const rows = (
    await q.query<KeysetRow>(
      `SELECT ${nodeColumns},${cursorColumn} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
       WHERE c.bike_id=$1 AND c.parent_id IS NULL AND ($3::uuid IS NULL OR c.id=$3) AND (${readable("c", "a")})
         AND ($4::timestamptz IS NULL OR (c.created_at,c.id)>($4::timestamptz,$5::uuid))
       ORDER BY c.created_at,c.id LIMIT $2`,
      [bikeId, limit + 1, root, at, id],
    )
  ).rows;
  const roots = rows.slice(0, limit);
  const replies = await replyPreviews(
    q,
    roots.map((r) => r.id),
    chain.map((r) => r.id),
  );
  return {
    roots: roots.map((r) => ({
      comment: r,
      replies: replies.filter((x) => x.parent_id === r.id),
    })),
    next: root ? null : nextOf(rows, limit),
    focusPath: chain,
  };
}

/** Replies to one comment by position, oldest first. */
export async function replyKeysetPage(
  q: Queryable,
  bikeId: string,
  parent: string,
  { limit, cursor }: { limit: number; cursor: CommentCursor | null },
) {
  await publicCommentBike(q, bikeId);
  const root = (
    await q.query<{ "?column?": number }>(
      "SELECT 1 FROM bike_comments WHERE id=$1 AND bike_id=$2",
      [parent, bikeId],
    )
  ).rows[0];
  if (!root) throw new CommunityError("Обсуждение недоступно", 404);
  const [at, id] = after(cursor);
  const rows = (
    await q.query<KeysetRow>(
      `SELECT ${nodeColumns},${cursorColumn} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
       WHERE c.parent_id=$1 AND (${readable("c", "a")})
         AND ($3::timestamptz IS NULL OR (c.created_at,c.id)>($3::timestamptz,$4::uuid))
       ORDER BY c.created_at,c.id LIMIT $2`,
      [parent, limit + 1, at, id],
    )
  ).rows;
  return { replies: rows.slice(0, limit), next: nextOf(rows, limit) };
}

async function lockBike(
  q: Queryable,
  bikeId: string,
  user: { id: string },
  recipient?: string | null,
) {
  const b = await publicCommentBike(q, bikeId);
  const users = (
    await q.query<{ id: string; blocked: boolean }>(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([b.owner_id, user.id, recipient].filter(Boolean))]],
    )
  ).rows;
  if (users.some((u) => u.blocked) || !users.some((u) => u.id === user.id))
    throw new CommunityError("Пользователь недоступен", 404);
  await q.query<{ id: string }>("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
    bikeId,
  ]);
  return publicCommentBike(q, bikeId);
}

export async function createComment(
  q: Queryable,
  bikeId: string,
  user: Pick<CurrentUserType, "id" | "role">,
  input: CommentInputType,
) {
  // Reserve every notification participant in one sorted lock order, before
  // the entity/comment locks. Revalidate the parent after waiting for them.
  const recipient = input.parentId
    ? (
        await q.query<{ author_id: string | null }>(
          "SELECT author_id FROM bike_comments WHERE id=$1 AND bike_id=$2",
          [input.parentId, bikeId],
        )
      ).rows[0]?.author_id
    : null;
  const bike = await lockBike(q, bikeId, user, recipient);
  let parent;
  if (input.parentId) {
    parent = (
      await q.query<{ id: string; parent_id: string; author_id: string }>(
        `SELECT c.id,c.parent_id,c.author_id FROM bike_comments c JOIN users a ON a.id=c.author_id WHERE c.id=$1 AND c.bike_id=$2 AND ${alive} FOR UPDATE OF c`,
        [input.parentId, bikeId],
      )
    ).rows[0];
    if (!parent) throw new CommunityError("Комментарий недоступен", 404);
  }
  const id = randomUUID();
  await q.query(
    "INSERT INTO bike_comments(id,bike_id,author_id,parent_id,body) VALUES($1,$2,$3,$4,$5)",
    [id, bikeId, user.id, parent?.id || null, input.body],
  );
  if (parent)
    await notify(q, {
      recipient: parent.author_id,
      actor: user.id,
      type: "reply",
      bike: bikeId,
      comment: id,
    });
  if (bike.owner_id !== parent?.author_id)
    await notify(q, {
      recipient: bike.owner_id,
      actor: user.id,
      type: "comment",
      bike: bikeId,
      comment: id,
    });
  return { id };
}
export async function changeComment(
  q: Queryable,
  id: string,
  user: Pick<CurrentUserType, "id" | "role">,
  body: string | null = null,
) {
  const c = (
    await q.query<{ bike_id: string }>(
      "SELECT bike_id FROM bike_comments WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!c) throw new CommunityError("Комментарий недоступен", 404);
  if (!(user.role === "admin" && body === null))
    await lockBike(q, c.bike_id, user);
  const row = (
    await q.query<{ author_id: string; deleted_at: Date }>(
      "SELECT author_id,deleted_at FROM bike_comments WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) throw new CommunityError("Комментарий недоступен", 404);
  if (row.author_id !== user.id && !(user.role === "admin" && body === null))
    throw new CommunityError("Недостаточно прав", 403);
  if (row.deleted_at) {
    if (body === null) return { ok: true };
    throw new CommunityError("Комментарий удалён", 404);
  }
  await q.query(
    body === null
      ? "UPDATE bike_comments SET body='',deleted_at=now(),updated_at=now() WHERE id=$1"
      : "UPDATE bike_comments SET body=$2,updated_at=now() WHERE id=$1",
    body === null ? [id] : [id, body],
  );
  return { ok: true };
}
