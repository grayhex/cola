// Public users are explicit DTOs. Never spread a row or expose preferences/email.
export const publicAuthorKeys = ["id", "username", "name", "avatar"];
export function publicAuthor(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatar: row.avatar_id ? "/api/avatars/" + row.avatar_id : null,
  };
}
export function relationship(row = {}) {
  const following = !!row.is_following,
    followedBy = !!row.followed_by;
  return {
    isSelf: !!row.is_self,
    following,
    followedBy,
    friends: following && followedBy,
  };
}
export function publicProfile(row, counts) {
  return {
    ...publicAuthor(row),
    bio: row.bio,
    location: row.location,
    createdAt: row.created_at,
    counts: {
      bikes: Number(counts.bikes),
      followers: Number(counts.followers),
      following: Number(counts.following),
      friends: Number(counts.friends),
    },
    relationship: relationship(row),
    badges: [],
  };
}
