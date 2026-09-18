import {notify} from './notifications.js';
import { authorColumns, relationshipColumns, profileRow } from "./profiles.js";
import { publicAuthor, relationship } from "./profile-dto.js";
export async function followPage(q, username, viewerId, kind, page = 1) {
  const target = await profileRow(q, username, viewerId);
  if (!target) return null;
  const incoming = kind === "followers";
  const join = incoming ? "f.follower_id" : "f.following_id";
  const where =
    ` WHERE ${incoming ? "f.following_id" : "f.follower_id"}=$1 AND NOT u.blocked` +
    (kind === "friends"
      ? " AND EXISTS(SELECT 1 FROM user_follows r WHERE r.follower_id=f.following_id AND r.following_id=$1)"
      : "");
  const from = ` FROM user_follows f JOIN users u ON u.id=${join}`;
  const count = await q.query("SELECT count(*)::int AS total" + from + where, [
    target.id,
  ]);
  const rows = await q.query(
    `SELECT ${authorColumns},${relationshipColumns}` +
      from +
      where +
      " ORDER BY f.created_at DESC,u.id LIMIT 20 OFFSET $3",
    [target.id, viewerId || null, (page - 1) * 20],
  );
  return {
    users: rows.rows.map((row) => ({
      ...publicAuthor(row),
      relationship: relationship(row),
    })),
    total: count.rows[0].total,
    page,
    pageSize: 20,
  };
}
// Transaction required. Stable lock order serializes opposite follows and admin blocking.
export async function setFollow(q, viewerId, username, enabled) {
  const target = (
    await q.query("SELECT id FROM users WHERE lower(username)=lower($1)", [
      username,
    ])
  ).rows[0];
  if (!target) return { error: "Профиль недоступен", status: 404 };
  if (target.id === viewerId)
    return { error: "Нельзя подписаться на себя", status: 400 };
  const users = (
    await q.query(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[viewerId, target.id]],
    )
  ).rows;
  if (users.length !== 2 || users.some((u) => u.blocked))
    return { error: "Профиль недоступен", status: 404 };
  if (enabled)
    await q.query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [viewerId, target.id],
    );
  else
    await q.query(
      "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
      [viewerId, target.id],
    );
  if(enabled) await notify(q,{recipient:target.id,actor:viewerId,type:'follow'});
  const reverse = await q.query(
    "SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [target.id, viewerId],
  );
  return {
    relationship: {
      isSelf: false,
      following: enabled,
      followedBy: !!reverse.rowCount,
      friends: enabled && !!reverse.rowCount,
    },
  };
}
