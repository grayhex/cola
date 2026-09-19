import * as comments from "./comments.js";
import { RideError } from "./ride-gpx.js";
import { notify } from "./notifications.js";
import { randomUUID } from "node:crypto";
// Closed adapter reuses pagination, depth, edit and moderation semantics. No user SQL identifiers.
export function rideCommentQuery(q) {
  return {
    query: async (sql, args) => {
      if (sql.includes("SELECT b.id,b.owner_id,b.share_id FROM bikes"))
        return q.query(
          "SELECT r.id,r.owner_id,r.share_id FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.id=$1 AND r.is_public AND b.is_public AND NOT u.blocked",
          args,
        );
      if (sql.startsWith("SELECT id FROM bikes WHERE")) {
        await q.query(
          "SELECT b.id FROM bikes b JOIN rides r ON r.bike_id=b.id WHERE r.id=$1 FOR UPDATE OF b",
          args,
        );
        return q.query("SELECT id FROM rides WHERE id=$1 FOR UPDATE", args);
      }
      if (sql.includes("INSERT INTO notifications")) {
        return notify(q, {
          recipient: args[1],
          actor: args[2],
          type: "ride_" + args[3],
          ride: args[4],
          rideComment: args[5],
        });
      }
      const mapped = sql
        .replaceAll("bike_comments", "ride_comments")
        .replaceAll("bike_id", "ride_id");
      const r = await q.query(mapped, args);
      return {
        ...r,
        rows: r.rows.map((row) => ({
          ...row,
          ...("ride_id" in row ? { bike_id: row.ride_id } : {}),
        })),
      };
    },
  };
}
export const rideCommentPage = (q, ...args) =>
  comments.commentPage(rideCommentQuery(q), ...args);
export const rideReplyPage = (q, ...args) =>
  comments.replyPage(rideCommentQuery(q), ...args);
export const createRideComment = (q, ...args) =>
  comments.createComment(rideCommentQuery(q), ...args);
export const changeRideComment = (q, ...args) =>
  comments.changeComment(rideCommentQuery(q), ...args);
export async function likeRide(q, id, user, enabled) {
  const r = (
    await q.query(
      "SELECT r.owner_id FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE r.id=$1 AND r.is_public AND b.is_public AND NOT u.blocked FOR UPDATE OF r,b",
      [id],
    )
  ).rows[0];
  if (!r) throw new RideError("Покатушка недоступна", 404);
  if (r.owner_id === user)
    throw new RideError("Нельзя поставить лайк своей покатушке", 403);
  if (enabled) {
    await q.query(
      "INSERT INTO ride_likes(ride_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, user],
    );
    await notify(q, {
      recipient: r.owner_id,
      actor: user,
      type: "ride_like",
      ride: id,
    });
  } else
    await q.query("DELETE FROM ride_likes WHERE ride_id=$1 AND user_id=$2", [
      id,
      user,
    ]);
  const n = (
    await q.query(
      "SELECT count(*)::int n FROM ride_likes l JOIN users u ON u.id=l.user_id WHERE l.ride_id=$1 AND NOT u.blocked",
      [id],
    )
  ).rows[0].n;
  return { liked: enabled, likes: n };
}
