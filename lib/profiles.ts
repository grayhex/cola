import type { PublicProfileInput as PublicProfileInputType } from "./social-validation.ts";
import type { CurrentUser } from "./contracts.ts";
import type { Queryable } from "./db.ts";
import { publicProfile } from "./profile-dto.ts";
export const authorColumns = "u.id,u.username,u.name,u.avatar_id";
export const relationshipColumns = `u.id=$2 AS is_self,
 EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$2 AND following_id=u.id) AS is_following,
 EXISTS(SELECT 1 FROM user_follows WHERE follower_id=u.id AND following_id=$2) AS followed_by`;
export async function profileRow(
  q: Queryable,
  username: string,
  viewerId: string | null | undefined,
) {
  return (
    (
      await q.query<{
        id: string;
        username: string;
        name: string;
        avatar_id: string;
        bio: string;
        location: string;
        created_at: Date;
        is_self: boolean;
        is_following: boolean;
        followed_by: boolean;
      }>(
        `SELECT ${authorColumns},u.bio,u.location,u.created_at,${relationshipColumns}
    FROM users u WHERE lower(u.username)=lower($1) AND u.blocked=false`,
        [username, viewerId || null],
      )
    ).rows[0] || null
  );
}
export async function profileCounts(q: Queryable, id: string) {
  return (
    await q.query<{
      bikes: string;
      followers: string;
      following: string;
      friends: string;
    }>(
      `SELECT
    (SELECT count(*) FROM bikes WHERE owner_id=$1 AND is_public=true) AS bikes,
    (SELECT count(*) FROM user_follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=$1 AND NOT u.blocked) AS followers,
    (SELECT count(*) FROM user_follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 AND NOT u.blocked) AS following,
    (SELECT count(*) FROM user_follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1 AND NOT u.blocked AND EXISTS(SELECT 1 FROM user_follows r WHERE r.follower_id=f.following_id AND r.following_id=$1)) AS friends`,
      [id],
    )
  ).rows[0];
}
export async function getProfile(
  q: Queryable,
  username: string,
  viewerId: string | null | undefined,
) {
  const row = await profileRow(q, username, viewerId);
  return row ? publicProfile(row, await profileCounts(q, row.id)) : null;
}

export async function updateProfile(
  q: Queryable,
  id: string,
  input: PublicProfileInputType,
) {
  const r = await q.query<{ id: string }>(
    "UPDATE users SET username=$2,name=$3,bio=$4,location=$5 WHERE id=$1 AND blocked=false RETURNING id",
    [id, input.username, input.name, input.bio, input.location],
  );
  return (r.rowCount ?? 0) > 0;
}
export async function accountOverview(q: Queryable, user: CurrentUser) {
  const profile = await getProfile(q, user.username, user.id);
  const stats = (
    await q.query<{ bikes: number; private: number; likes: number }>(
      `SELECT
    (SELECT count(*)::int FROM bikes WHERE owner_id=$1) AS bikes,
    (SELECT count(*)::int FROM bikes WHERE owner_id=$1 AND NOT is_public) AS private,
    (SELECT count(*)::int FROM bike_likes l JOIN bikes b ON b.id=l.bike_id JOIN users u ON u.id=l.user_id WHERE b.owner_id=$1 AND b.is_public AND NOT u.blocked) AS likes`,
      [user.id],
    )
  ).rows[0];
  return {
    profile,
    stats: { ...stats, public: profile?.counts.bikes || 0 },
    email: user.email,
    preferences: user.preferences,
  };
}
