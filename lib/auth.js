import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { digest } from "./password.js";
export async function currentUser() {
  const token = (await cookies()).get("cola_session")?.value;
  if (!token) return null;
  const { rows } = await db.query(
    "SELECT u.id,u.email,u.name,u.role,u.preferences,u.username,u.bio,u.location,u.created_at,u.avatar_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.blocked=false",
    [digest(token)],
  );
  return rows[0] || null;
}
export async function startSession(userId) {
  const token = randomBytes(32).toString("base64url");
  await db.query("DELETE FROM sessions WHERE expires_at < now()");
  await db.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '30 days')",
    [digest(token), userId],
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
