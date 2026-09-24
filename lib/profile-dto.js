// Public users are explicit DTOs. Never spread a row or expose preferences/email.
/**
 * @typedef {object} PublicAuthor
 * @property {string} id
 * @property {string} username
 * @property {string} name
 * @property {string | null} avatar path of the avatar image
 */
/** @satisfies {ReadonlyArray<keyof PublicAuthor>} */
export const publicAuthorKeys = /** @type {const} */ ([
  "id",
  "username",
  "name",
  "avatar",
]);
/** @returns {PublicAuthor | null} */
export function publicAuthor(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    avatar: row.avatar_id ? "/api/avatars/" + row.avatar_id : null,
  };
}
/**
 * How the viewer relates to a profile.
 * @typedef {object} Relationship
 * @property {boolean} isSelf
 * @property {boolean} following
 * @property {boolean} followedBy
 * @property {boolean} friends
 */
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
/**
 * @typedef {PublicAuthor & {
 *   bio: string,
 *   location: string,
 *   createdAt: Date | string,
 *   counts: {bikes: number, followers: number, following: number, friends: number},
 *   relationship: Relationship,
 *   badges: unknown[],
 * }} PublicProfile
 */
/** @returns {PublicProfile} */
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
