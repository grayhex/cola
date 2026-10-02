import type { CurrentUser } from "./contracts.ts";
import type { Queryable } from "./db.ts";
import { digest } from "./password.ts";

// The viewer layer (#134): who is asking, independent of the transport.
// Nothing here knows about Next, cookies or headers. A transport adapter reads
// its own credential and hands this module a SessionCredential; the browser
// adapter is lib/auth.ts (the HttpOnly cookie jar), the plain-Request adapter
// for /api/v1 is lib/api-v1/credentials.ts.

/** The cookie that carries the browser session token. */
export const SESSION_COOKIE = "cola_session";

/**
 * A credential a transport extracted from a request. A future transport (for
 * example a native client's token) adds a variant here and a case in
 * `sessionHashOf`; none is issued or accepted today (#156).
 */
export type SessionCredential = { scheme: "cookie"; token: string };

/** The digest the `sessions` table stores for this credential. */
export function sessionHashOf(credential: SessionCredential): string {
  return digest(credential.token);
}

/**
 * The signed-in person behind a session digest, or null: unknown or expired
 * session, or a blocked account. Every transport shares this one rule.
 */
export async function viewerFromSessionHash(
  q: Queryable,
  hash: string,
): Promise<CurrentUser | null> {
  // The device list shows when a session was last used (#70); the mark is
  // refreshed at most every five minutes, in the same round trip.
  const { rows } = await q.query<CurrentUser>(
    `WITH seen AS (
       UPDATE sessions SET last_seen_at=now()
       WHERE token_hash=$1 AND expires_at>now() AND last_seen_at<now()-interval '5 minutes'
     )
     SELECT u.id,u.email,u.name,u.role,u.preferences,u.username,u.bio,u.location,u.created_at,u.avatar_id,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.blocked=false`,
    [hash],
  );
  return rows[0] || null;
}

/** The viewer for a transport credential; no credential is a guest. */
export async function viewerFromCredential(
  q: Queryable,
  credential: SessionCredential | null,
): Promise<CurrentUser | null> {
  return credential
    ? viewerFromSessionHash(q, sessionHashOf(credential))
    : null;
}
