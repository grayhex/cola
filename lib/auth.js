import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { digest } from "./password.js";
/**
 * The signed-in person, as /api/me returns it. Public responses show other
 * people only through publicAuthor (profile-dto.js).
 * @typedef {object} CurrentUser
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {"user" | "admin"} role
 * @property {Record<string, unknown>} preferences
 * @property {string} username
 * @property {string} bio
 * @property {string} location
 * @property {Date} created_at
 * @property {string | null} avatar_id
 * @property {Date | null} email_verified_at
 */
/** The digest of this browser's session token, or null when signed out. */
export async function currentSessionHash() {
  const token = (await cookies()).get("cola_session")?.value;
  return token ? digest(token) : null;
}
/** @returns {Promise<CurrentUser | null>} */
export async function currentUser() {
  const hash = await currentSessionHash();
  if (!hash) return null;
  // The device list shows when a session was last used (#70); the mark is
  // refreshed at most every five minutes, in the same round trip.
  const { rows } = await db.query(
    `WITH seen AS (
       UPDATE sessions SET last_seen_at=now()
       WHERE token_hash=$1 AND expires_at>now() AND last_seen_at<now()-interval '5 minutes'
     )
     SELECT u.id,u.email,u.name,u.role,u.preferences,u.username,u.bio,u.location,u.created_at,u.avatar_id,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.blocked=false`,
    [hash],
  );
  return rows[0] || null;
}
export async function startSession(userId) {
  const token = randomBytes(32).toString("base64url");
  // The browser's own description names the device in the session list.
  const agent = ((await headers()).get("user-agent") || "").slice(0, 300);
  await db.query("DELETE FROM sessions WHERE expires_at < now()");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,user_agent) VALUES($1,$2,now()+interval '30 days',$3)",
    [digest(token), userId, agent],
  );
  (await cookies()).set("cola_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 2592000,
  });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get("cola_session")?.value;
  if (token)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete("cola_session");
}
export async function rateLimit(key, maximum = 15) {
  await db.query("DELETE FROM rate_limits WHERE expires_at < now()");
  const { rows } = await db.query(
    "INSERT INTO rate_limits VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count",
    [key],
  );
  return rows[0].count <= maximum;
}
