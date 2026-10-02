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
 * A credential a transport extracted from a request. The scheme is part of the
 * lookup (#303): a cookie opens only a browser session, a Bearer access token
 * only a device session, so a token of one kind never works as the other.
 */
export type SessionCredential = {
  scheme: "cookie" | "bearer";
  token: string;
};

/** The digest the `sessions` table stores for this credential. */
export function sessionHashOf(credential: SessionCredential): string {
  return digest(credential.token);
}

const VIEWER_COLUMNS =
  "u.id,u.email,u.name,u.role,u.preferences,u.username,u.bio,u.location,u.created_at,u.avatar_id,u.email_verified_at";

/** The viewer record of a user by id, e.g. right after a sign-in; blocked is null. */
export async function viewerById(
  q: Queryable,
  userId: string,
): Promise<CurrentUser | null> {
  const { rows } = await q.query<CurrentUser>(
    `SELECT ${VIEWER_COLUMNS} FROM users u WHERE u.id=$1 AND u.blocked=false`,
    [userId],
  );
  return rows[0] || null;
}

// A session is open for this scheme: a browser row by its idle expiry, a device
// row by the access token's own short expiry and both session limits (#303).
const openFor = (scheme: string) =>
  `((s.kind='browser' AND ${scheme}='cookie' AND s.expires_at>now())
    OR (s.kind='device' AND ${scheme}='bearer' AND s.expires_at>now() AND s.access_expires_at>now() AND s.absolute_expires_at>now()))`;

/**
 * The signed-in person behind a session digest, or null: unknown or expired
 * session, or a blocked account. Every transport shares this one rule.
 */
export async function viewerFromSessionHash(
  q: Queryable,
  hash: string,
  scheme: SessionCredential["scheme"] = "cookie",
): Promise<CurrentUser | null> {
  // The device list shows when a session was last used (#70); the mark is
  // refreshed at most every five minutes, in the same round trip. For a device
  // the first use of a fresh access token is also recorded: from then on the
  // client has surely received its latest refresh answer (#303). One UPDATE
  // sets both, since one statement must not change a row twice.
  const { rows } = await q.query<CurrentUser>(
    `WITH seen AS (
       UPDATE sessions s SET
         last_seen_at=CASE WHEN s.last_seen_at<now()-interval '5 minutes' THEN now() ELSE s.last_seen_at END,
         access_used_at=CASE WHEN s.kind='device' THEN coalesce(s.access_used_at,now()) ELSE s.access_used_at END
       WHERE s.token_hash=$1 AND ${openFor("$2::text")}
         AND (s.last_seen_at<now()-interval '5 minutes' OR (s.kind='device' AND s.access_used_at IS NULL))
     )
     SELECT ${VIEWER_COLUMNS} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND ${openFor("$2::text")} AND u.blocked=false`,
    [hash, scheme],
  );
  return rows[0] || null;
}

/** The viewer for a transport credential; no credential is a guest. */
export async function viewerFromCredential(
  q: Queryable,
  credential: SessionCredential | null,
): Promise<CurrentUser | null> {
  return credential
    ? viewerFromSessionHash(q, sessionHashOf(credential), credential.scheme)
    : null;
}
