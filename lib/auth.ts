import type { CurrentUser as CurrentUserType } from "./contracts.ts";
import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";
import { digest } from "./password.ts";
import { SESSION_COOKIE, viewerFromSessionHash } from "./viewer-session.ts";

// The browser adapter of the viewer layer (#134): the HttpOnly session cookie
// through Next's cookie jar. Who a session belongs to is decided by
// lib/viewer-session.ts, shared with every other transport.

/** The digest of this browser's session token, or null when signed out. */
export async function currentSessionHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? digest(token) : null;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const hash = await currentSessionHash();
  return hash ? viewerFromSessionHash(db, hash) : null;
}
export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  // The browser's own description names the device in the session list.
  const agent = ((await headers()).get("user-agent") || "").slice(0, 300);
  await db.query("DELETE FROM sessions WHERE expires_at < now()");
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at,user_agent) VALUES($1,$2,now()+interval '30 days',$3)",
    [digest(token), userId, agent],
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 2592000,
  });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete(SESSION_COOKIE);
}
export async function rateLimit(key: unknown, maximum = 15) {
  await db.query("DELETE FROM rate_limits WHERE expires_at < now()");
  const { rows } = await db.query<{ count: number }>(
    "INSERT INTO rate_limits VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count",
    [key],
  );
  return rows[0].count <= maximum;
}

export type CurrentUser = CurrentUserType;
