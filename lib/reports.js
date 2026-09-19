import { changeRideComment } from "./ride-comments.js";
import { randomUUID } from "node:crypto";
import { CommunityError } from "./community-validation.js";
import { publicAuthor } from "./profile-dto.js";
import { changeComment, publicCommentBike } from "./comments.js";
import { audit } from "./site.js";
export async function createReport(q, user, input) {
  let author;
  if (input.entityType === "ride" || input.entityType === "ride_comment")
    author = (
      await q.query(
        `SELECT ${input.entityType === "ride" ? "r.owner_id" : "rc.author_id"} AS author FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id ${input.entityType === "ride_comment" ? "JOIN ride_comments rc ON rc.ride_id=r.id JOIN users ca ON ca.id=rc.author_id" : ""} WHERE ${input.entityType === "ride" ? "r.id=$1" : "rc.id=$1 AND rc.deleted_at IS NULL AND NOT ca.blocked"} AND r.is_public AND b.is_public AND NOT u.blocked`,
        [input.targetId],
      )
    ).rows[0]?.author;
  if (input.entityType === "bike")
    author = (await publicCommentBike(q, input.targetId)).owner_id;
  if (input.entityType === "profile")
    author = (
      await q.query("SELECT id FROM users WHERE id=$1 AND NOT blocked", [
        input.targetId,
      ])
    ).rows[0]?.id;
  if (input.entityType === "comment")
    author = (
      await q.query(
        `SELECT c.author_id FROM bike_comments c JOIN users a ON a.id=c.author_id JOIN bikes b ON b.id=c.bike_id JOIN users o ON o.id=b.owner_id WHERE c.id=$1 AND c.deleted_at IS NULL AND NOT a.blocked AND b.is_public AND NOT o.blocked`,
        [input.targetId],
      )
    ).rows[0]?.author_id;
  if (!author) throw new CommunityError("Объект недоступен", 404);
  if (author === user.id)
    throw new CommunityError("Нельзя жаловаться на собственный контент");
  const r = await q.query(
    `INSERT INTO community_reports(id,reporter_id,entity_type,target_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(reporter_id,entity_type,target_id) DO NOTHING RETURNING id`,
    [randomUUID(), user.id, input.entityType, input.targetId, input.reason],
  );
  return { ok: true, created: !!r.rowCount };
}
export async function reportPage(q, page = 1, status = "open") {
  const rows = (
    await q.query(
      `SELECT r.id,r.entity_type,r.target_id,r.reason,r.status,r.created_at,
 u.id reporter_id,u.username reporter_username,u.name reporter_name,u.avatar_id reporter_avatar,
 a.id profile_id,a.username profile_username,a.name profile_name,
 c.body,c.deleted_at,c.author_id,ca.username comment_username,ca.name comment_author_name,
 b.id bike_id,b.share_id,b.name bike_name,bo.username owner_username,rr.share_id AS ride_share_id,rr.title AS ride_title,rc.body AS ride_body,rc.deleted_at AS ride_deleted
 FROM community_reports r JOIN users u ON u.id=r.reporter_id
 LEFT JOIN users a ON r.entity_type='profile' AND a.id=r.target_id
 LEFT JOIN bike_comments c ON r.entity_type='comment' AND c.id=r.target_id
 LEFT JOIN users ca ON ca.id=c.author_id
 LEFT JOIN bikes b ON (r.entity_type='bike' AND b.id=r.target_id) OR b.id=c.bike_id
 LEFT JOIN users bo ON bo.id=b.owner_id
 LEFT JOIN ride_comments rc ON r.entity_type='ride_comment' AND rc.id=r.target_id
 LEFT JOIN rides rr ON (r.entity_type='ride' AND rr.id=r.target_id) OR rr.id=rc.ride_id
 WHERE r.status=$1 ORDER BY r.created_at DESC,r.id LIMIT 21 OFFSET $2`,
      [status, (page - 1) * 20],
    )
  ).rows;
  return {
    reports: rows.slice(0, 20).map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reporter: publicAuthor({
        id: r.reporter_id,
        username: r.reporter_username,
        name: r.reporter_name,
        avatar_id: r.reporter_avatar,
      }),
      target: {
        name:
          r.ride_title || r.profile_name || r.bike_name || "Удалённый объект",
        href: r.ride_share_id
          ? "/r/" +
            r.ride_share_id +
            (r.entity_type === "ride_comment"
              ? "?comment=" + r.target_id + "#discussion"
              : "")
          : r.profile_username
            ? "/u/" + r.profile_username
            : r.share_id
              ? "/b/" +
                r.share_id +
                (r.entity_type === "comment"
                  ? "?comment=" + r.target_id + "#discussion"
                  : "")
              : null,
        username:
          r.profile_username || r.comment_username || r.owner_username || null,
        body:
          r.ride_deleted || r.deleted_at ? null : r.ride_body || r.body || null,
        commentDeleted: !!(r.deleted_at || r.ride_deleted),
      },
    })),
    page,
    hasMore: rows.length > 20,
  };
}
export async function moderateReport(q, id, user, action) {
  const r = (
    await q.query(
      "SELECT entity_type,target_id FROM community_reports WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!r) throw new CommunityError("Жалоба не найдена", 404);
  if (action === "delete_comment") {
    if (!["comment", "ride_comment"].includes(r.entity_type))
      throw new CommunityError("Это не комментарий");
    await (
      r.entity_type === "ride_comment" ? changeRideComment : changeComment
    )(q, r.target_id, user, null);
  }
  if (action === "hide_ride") {
    if (r.entity_type !== "ride") throw new CommunityError("Это не покатушка");
    await q.query("UPDATE rides SET is_public=false WHERE id=$1", [
      r.target_id,
    ]);
  }
  await q.query(
    "UPDATE community_reports SET status='closed',reviewed_at=now(),reviewed_by=$2 WHERE id=$1",
    [id, user.id],
  );
  await audit(q, user.id, "community.report." + action, id);
  return { ok: true };
}
