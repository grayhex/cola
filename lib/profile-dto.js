// Public users are explicit DTOs. Never spread a row or expose preferences/email.
/** @typedef {import("./contracts.js").PublicAuthor} PublicAuthor */
/** @satisfies {ReadonlyArray<keyof PublicAuthor>} */
export const publicAuthorKeys = /** @type {const} */ ([
  "id",
  "username",
  "name",
  "avatar",
]);
/** @typedef {import("./contracts.js").AuthorRow} AuthorRow */
/** @overload
 * @param {AuthorRow} row
 * @returns {PublicAuthor} */
/** @overload
 * @param {null | undefined} row
 * @returns {null} */
/** @overload
 * @param {AuthorRow | null | undefined} row
 * @returns {PublicAuthor | null} */
/** @param {AuthorRow | null | undefined} row
 * @returns {PublicAuthor | null} */
export function publicAuthor(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatar: row.avatar_id ? "/api/avatars/" + row.avatar_id : null,
  };
}
/** @typedef {import("./contracts.js").Relationship} Relationship */
/** @returns {Relationship} */
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
/** @typedef {import("./contracts.js").PublicProfile} PublicProfile */
/**
 * @param {AuthorRow & {bio: string, location: string, created_at: Date | string,
 * is_self?: boolean, is_following?: boolean, followed_by?: boolean}} row
 * @param {{bikes: number | string, followers: number | string, following: number | string, friends: number | string}} counts
 * @returns {PublicProfile}
 */
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
