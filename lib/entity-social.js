import * as comments from "./comments.js";
import { notify } from "./notifications.js";
import { CommunityError } from "./community-validation.js";
const targets = {
  ride: {
    table: "rides",
    comments: "ride_comments",
    likes: "ride_likes",
    key: "ride_id",
    guard: "r.is_public",
    label: "Покатушка",
  },
  article: {
    table: "journal_entries",
    comments: "journal_comments",
    likes: "journal_likes",
    key: "entry_id",
    guard: "r.kind='article' AND r.is_public AND r.status='published'",
    label: "Статья",
  },
  journal: {
    table: "journal_entries",
    comments: "journal_comments",
    likes: "journal_likes",
    key: "entry_id",
    guard: "r.is_public AND r.status='published'",
    label: "Запись",
  },
};
// Closed, application-owned identifiers only. Reuse the bike comment engine rather
// than introducing another pagination, reply-depth, moderation or notification model.
export function entitySocial(kind) {
  const t = targets[kind];
  if (!t) throw new Error("Unknown social target");
  const visible = `FROM ${t.table} r LEFT JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.id=$1 AND ${t.guard} AND ${kind === "ride" ? "b.is_public" : "(r.kind='article' OR b.is_public)"} AND NOT u.blocked`;
  const notificationKind = kind === "article" ? "journal" : kind;
  const event = (id, comment = null) =>
    kind === "ride"
      ? { ride: id, rideComment: comment }
      : { entry: id, entryComment: comment };
  function query(q) {
    return {
      query: async (sql, args) => {
        if (sql.includes("SELECT b.id,b.owner_id,b.share_id FROM bikes"))
          return q.query(`SELECT r.id,r.owner_id,r.share_id ${visible}`, args);
        if (sql.startsWith("SELECT id FROM bikes WHERE")) {
          await q.query(
            `SELECT b.id FROM bikes b JOIN ${t.table} r ON r.bike_id=b.id WHERE r.id=$1 FOR UPDATE OF b`,
            args,
          );
          return q.query(
            `SELECT id FROM ${t.table} WHERE id=$1 FOR UPDATE`,
            args,
          );
        }
        if (sql.includes("INSERT INTO notifications"))
          return notify(q, {
            recipient: args[1],
            actor: args[2],
            type: notificationKind + "_" + args[3],
            ...event(args[4], args[5]),
          });
        const r = await q.query(
          sql
            .replaceAll("bike_comments", t.comments)
            .replaceAll("bike_id", t.key),
          args,
        );
        return {
          ...r,
          rows: r.rows.map((row) => ({
            ...row,
            ...(t.key in row ? { bike_id: row[t.key] } : {}),
          })),
        };
      },
    };
  }
  async function like(q, id, user, enabled) {
    // Same lock order as comments / owner mutations: users -> bike -> entity.
    const initial = (
      await q.query(`SELECT r.owner_id,r.bike_id ${visible}`, [id])
    ).rows[0];
    if (!initial) throw new CommunityError(t.label + " недоступна", 404);
    const users = (
      await q.query(
        "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[...new Set([user, initial.owner_id])]],
      )
    ).rows;
    if (users.some((u) => u.blocked) || !users.some((u) => u.id === user))
      throw new CommunityError("Пользователь недоступен", 404);
    await q.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
      initial.bike_id,
    ]);
    const r = (
      await q.query(`SELECT r.owner_id ${visible} FOR UPDATE OF r`, [id])
    ).rows[0];
    if (!r) throw new CommunityError(t.label + " недоступна", 404);
    if (r.owner_id === user)
      throw new CommunityError(
        kind === "ride"
          ? "Нельзя поставить лайк своей покатушке"
          : "Нельзя поставить лайк своей записи",
        403,
      );
    if (enabled) {
      await q.query(
        `INSERT INTO ${t.likes}(${t.key},user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [id, user],
      );
      await notify(q, {
        recipient: r.owner_id,
        actor: user,
        type: notificationKind + "_like",
        ...event(id),
      });
    } else
      await q.query(`DELETE FROM ${t.likes} WHERE ${t.key}=$1 AND user_id=$2`, [
        id,
        user,
      ]);
    const n = (
      await q.query(
        `SELECT count(*)::int n FROM ${t.likes} l JOIN users u ON u.id=l.user_id WHERE l.${t.key}=$1 AND NOT u.blocked`,
        [id],
      )
    ).rows[0].n;
    return { liked: enabled, likes: n };
  }
  return {
    query,
    page: (q, ...a) => comments.commentPage(query(q), ...a),
    replies: (q, ...a) => comments.replyPage(query(q), ...a),
    create: (q, id, user, input) =>
      comments.createComment(query(q), id, user, input),
    change: (q, ...a) => comments.changeComment(query(q), ...a),
    like,
  };
}
