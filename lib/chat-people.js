/** @typedef {{ id: string, name: string, username: string, avatar_id: string | null }} ChatPerson */
/**
 * Empty search suggests only people the viewer follows, never a global user dump.
 * Return the same public fields for suggestions and search; eligibility is checked
 * again under lock when a channel is created.
 * @param {import('./repository.js').Queryable} q
 * @param {string} viewerId
 * @param {string} input
 * @returns {Promise<{ people: ChatPerson[], mode: 'following' | 'search' }>}
 */
export async function chatPeople(q, viewerId, input) {
  const term = input.trim().replace(/^@/, "");
  const mode = input.trim() ? "search" : "following";
  if (mode === "search" && (term.length < 2 || term.length > 80))
    return { people: [], mode };
  const { rows } = await q.query(
    `SELECT u.id,u.name,u.username,u.avatar_id FROM users u
     WHERE u.id<>$1 AND NOT u.blocked AND u.email_verified_at IS NOT NULL
       AND ${
         mode === "following"
           ? "EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=u.id)"
           : "(u.username ILIKE $2 OR u.name ILIKE $2)"
       }
     ORDER BY u.username,u.id LIMIT 20`,
    mode === "following"
      ? [viewerId]
      : [viewerId, "%" + term.replace(/[\\%_]/g, "\\$&") + "%"],
  );
  return { people: rows, mode };
}
