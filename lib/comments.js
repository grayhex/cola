import { randomUUID } from "node:crypto";
import { publicAuthor } from "./profile-dto.js";
import { notify } from "./notifications.js";
import { CommunityError } from "./community-validation.js";
import { parseRichText } from "./rich-text.js";
const alive = "c.deleted_at IS NULL AND a.id IS NOT NULL AND NOT a.blocked";
const columns =
  "c.id,c.bike_id,c.parent_id,c.body,c.created_at,c.updated_at,c.deleted_at,a.id AS author_id,a.username,a.name,a.avatar_id,a.blocked";
const replyAlive =
  "r.deleted_at IS NULL AND ra.id IS NOT NULL AND NOT ra.blocked";
export const visibleCommentCount = `SELECT count(*)::int FROM bike_comments cc JOIN users ca ON ca.id=cc.author_id WHERE cc.bike_id=b.id AND cc.deleted_at IS NULL AND NOT ca.blocked`;
export async function publicCommentBike(q, id) {
  const b = (
    await q.query(
      "SELECT b.id,b.owner_id,b.share_id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked",
      [id],
    )
  ).rows[0];
  if (!b) throw new CommunityError("Велосипед недоступен", 404);
  return b;
}
export function commentDto(row, user) {
  const hidden = !!row.deleted_at || !row.author_id || row.blocked;
  return {
    id: row.id,
    parentId: row.parent_id,
    body: hidden ? null : row.body,
    // Parsed here, so readers render comments without the parser (#117).
    bodyDoc: hidden ? null : parseRichText(row.body),
    author: hidden
      ? null
      : publicAuthor({
          id: row.author_id,
          username: row.username,
          name: row.name,
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
export async function commentPage(q, bikeId, user, page = 1, focus = null) {
  await publicCommentBike(q, bikeId);
  let root = null;
  if (focus) {
    const r = (
      await q.query(
        `SELECT coalesce(c.parent_id,c.id) root FROM bike_comments c JOIN users a ON a.id=c.author_id WHERE c.id=$1 AND c.bike_id=$2 AND ${alive}`,
        [focus, bikeId],
      )
    ).rows[0];
    if (!r) throw new CommunityError("Комментарий недоступен", 404);
    root = r.root;
  }
  const rows = (
    await q.query(
      `SELECT ${columns} FROM bike_comments c LEFT JOIN users a ON a.id=c.author_id
 WHERE c.bike_id=$1 AND c.parent_id IS NULL AND ($3::uuid IS NULL OR c.id=$3) AND ((${alive}) OR EXISTS(SELECT 1 FROM bike_comments r JOIN users ra ON ra.id=r.author_id WHERE r.parent_id=c.id AND ${replyAlive}))
 ORDER BY c.created_at,c.id LIMIT 21 OFFSET $2`,
      [bikeId, root ? 0 : (page - 1) * 20, root],
    )
  ).rows;
  const roots = rows.slice(0, 20),
    ids = roots.map((r) => r.id);
  const replies = ids.length
    ? (
        await q.query(
          `SELECT * FROM (SELECT ${columns},row_number() OVER(PARTITION BY c.parent_id ORDER BY c.created_at,c.id) AS rank,count(*) OVER(PARTITION BY c.parent_id) AS reply_count FROM bike_comments c JOIN users a ON a.id=c.author_id WHERE c.parent_id=ANY($1::uuid[]) AND ${alive}) r WHERE rank<=3 OR id=$2 ORDER BY created_at,id`,
          [ids, focus],
        )
      ).rows
    : [];
  return {
    comments: roots.map((r) => ({
      ...commentDto(r, user),
      replyCount: Number(
        replies.find((x) => x.parent_id === r.id)?.reply_count || 0,
      ),
      replies: replies
        .filter((x) => x.parent_id === r.id)
        .map((x) => commentDto(x, user)),
    })),
    page,
    hasMore: !root && rows.length > 20,
    focused: !!root,
  };
}
export async function replyPage(q, bikeId, parent, user, page = 1) {
  await publicCommentBike(q, bikeId);
  const root = (
    await q.query(
      "SELECT 1 FROM bike_comments WHERE id=$1 AND bike_id=$2 AND parent_id IS NULL",
      [parent, bikeId],
    )
  ).rows[0];
  if (!root) throw new CommunityError("Обсуждение недоступно", 404);
  const rows = (
    await q.query(
      `SELECT ${columns} FROM bike_comments c JOIN users a ON a.id=c.author_id WHERE c.parent_id=$1 AND ${alive} ORDER BY c.created_at,c.id LIMIT 21 OFFSET $2`,
      [parent, (page - 1) * 20],
    )
  ).rows;
  return {
    comments: rows.slice(0, 20).map((r) => commentDto(r, user)),
    page,
    hasMore: rows.length > 20,
  };
}
async function lockBike(q, bikeId, user) {
  const b = await publicCommentBike(q, bikeId);
  const users = (
    await q.query(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([b.owner_id, user.id])]],
    )
  ).rows;
  if (users.some((u) => u.blocked) || !users.some((u) => u.id === user.id))
    throw new CommunityError("Пользователь недоступен", 404);
  await q.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [bikeId]);
  return publicCommentBike(q, bikeId);
}
/** @param {import("./community-validation.js").CommentInput} input */
export async function createComment(q, bikeId, user, input) {
  const bike = await lockBike(q, bikeId, user);
  let parent;
  if (input.parentId) {
    parent = (
      await q.query(
        `SELECT c.id,c.parent_id,c.author_id FROM bike_comments c JOIN users a ON a.id=c.author_id WHERE c.id=$1 AND c.bike_id=$2 AND ${alive} FOR UPDATE OF c`,
        [input.parentId, bikeId],
      )
    ).rows[0];
    if (!parent) throw new CommunityError("Комментарий недоступен", 404);
    if (parent.parent_id)
      throw new CommunityError("Можно ответить только на основной комментарий");
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
export async function changeComment(q, id, user, body = null) {
  const c = (
    await q.query("SELECT bike_id FROM bike_comments WHERE id=$1", [id])
  ).rows[0];
  if (!c) throw new CommunityError("Комментарий недоступен", 404);
  if (!(user.role === "admin" && body === null))
    await lockBike(q, c.bike_id, user);
  const row = (
    await q.query(
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
