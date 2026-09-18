import { randomUUID } from "node:crypto";
import { publicAuthor } from "./profile-dto.js";
// Keep one lifetime follow/like event; comments/replies coalesce per actor/bike/15m.
// Never reset created_at or read_at on conflict, including unlike/like and refollow.
export async function notify(
  q,
  { recipient, actor, type, bike = null, comment = null },
) {
  if (!recipient || recipient === actor) return;
  const key = ["follow", "like"].includes(type)
    ? `${type}:${actor}:${bike || ""}`
    : `${type}:${actor}:${bike}`;
  await q.query(
    `INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key)
 SELECT $1,$2,$3,$4,$5,$6,$7 || CASE WHEN $4 IN ('comment','reply') THEN ':' || floor(extract(epoch from now())/900)::bigint::text ELSE '' END WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND NOT blocked) AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND NOT blocked)
 ON CONFLICT(recipient_id,dedup_key) DO NOTHING`,
    [randomUUID(), recipient, actor, type, bike, comment, key],
  );
}
// Evaluate visibility at read time: no stored bike names, URLs, HTML or private snapshots.
const from = ` FROM notifications n JOIN users a ON a.id=n.actor_id
 LEFT JOIN bikes b ON b.id=n.bike_id LEFT JOIN users o ON o.id=b.owner_id
 LEFT JOIN bike_comments c ON c.id=n.comment_id`;
const visible = `n.recipient_id=$1 AND NOT a.blocked AND (
 (n.type='follow' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=n.actor_id AND f.following_id=n.recipient_id)) OR
 (b.is_public AND NOT o.blocked AND (
  (n.type='like' AND EXISTS(SELECT 1 FROM bike_likes l WHERE l.bike_id=b.id AND l.user_id=n.actor_id)) OR
  (n.type IN ('comment','reply') AND c.deleted_at IS NULL AND c.author_id=n.actor_id))))`;
export async function unreadCount(q, id) {
  const r = await q.query(
    "SELECT n.id" +
      from +
      " WHERE " +
      visible +
      " AND n.read_at IS NULL ORDER BY n.created_at DESC,n.id LIMIT 100",
    [id],
  );
  return { unread: r.rows.length, capped: r.rows.length === 100 };
}
export async function notificationPage(q, id, page = 1) {
  const r = await q.query(
    `SELECT n.id,n.type,n.created_at,n.read_at,n.comment_id,b.id AS bike_id,b.share_id,b.name AS bike_name,a.id AS actor_id,a.username,a.name,a.avatar_id` +
      from +
      " WHERE " +
      visible +
      " ORDER BY n.created_at DESC,n.id LIMIT 21 OFFSET $2",
    [id, (page - 1) * 20],
  );
  return {
    notifications: r.rows.slice(0, 20).map((n) => ({
      id: n.id,
      type: n.type,
      createdAt: n.created_at,
      readAt: n.read_at,
      actor: publicAuthor({
        id: n.actor_id,
        username: n.username,
        name: n.name,
        avatar_id: n.avatar_id,
      }),
      target:
        n.type === "follow"
          ? {
              type: "profile",
              id: n.actor_id,
              name: n.name,
              href: "/u/" + n.username,
            }
          : {
              type: "bike",
              id: n.bike_id,
              name: n.bike_name,
              href:
                "/b/" +
                n.share_id +
                (n.comment_id
                  ? "?comment=" + n.comment_id + "#discussion"
                  : ""),
            },
    })),
    page,
    hasMore: r.rows.length > 20,
    ...(await unreadCount(q, id)),
  };
}
export async function readNotifications(q, userId, id = null) {
  const r = await q.query(
    "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE recipient_id=$1 AND (($2::uuid IS NULL AND read_at IS NULL) OR id=$2) RETURNING id",
    [userId, id],
  );
  return id ? !!r.rowCount : true;
}
