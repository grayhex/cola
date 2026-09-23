import { randomBytes } from "node:crypto";
import { z } from "zod";
import { digest, hashPassword } from "./password.js";

// Raw tokens exist only in the emailed link (base64url, 32 random bytes).
export const tokenInput = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const lifetimeMinutes = {
  password_reset: 60,
  email_verify: 24 * 60,
  email_change: 24 * 60,
};

// Links carry the token in the fragment: it is not sent in the page request,
// so it never reaches server or proxy access logs.
export function accountLink(route, token, env = process.env) {
  return new URL(
    route + "#" + token,
    env.APP_ORIGIN || "http://localhost:3000",
  ).toString();
}

// A new link replaces older unused links of the same purpose.
export async function issueToken(q, userId, purpose, email = null) {
  const token = randomBytes(32).toString("base64url");
  await q.query(
    "DELETE FROM auth_tokens WHERE (user_id=$1 AND purpose=$2 AND used_at IS NULL) OR expires_at<now()-interval '7 days'",
    [userId, purpose],
  );
  await q.query(
    "INSERT INTO auth_tokens(token_hash,user_id,purpose,email,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(mins=>$5))",
    [digest(token), userId, purpose, email, lifetimeMinutes[purpose]],
  );
  return token;
}

// Atomically marks a valid token as used; concurrent reuse gets null.
export async function consumeToken(q, token, purpose) {
  if (!tokenInput.safeParse(token).success) return null;
  return (
    (
      await q.query(
        `UPDATE auth_tokens t SET used_at=now() FROM users u
         WHERE t.token_hash=$1 AND t.purpose=$2 AND t.used_at IS NULL AND t.expires_at>now()
           AND u.id=t.user_id AND NOT u.blocked
         RETURNING t.user_id,t.email,u.email current_email,u.name`,
        [digest(token), purpose],
      )
    ).rows[0] || null
  );
}

export async function requestPasswordReset(q, email) {
  const user = (
    await q.query(
      "SELECT id,name,email FROM users WHERE email=$1 AND NOT blocked",
      [email],
    )
  ).rows[0];
  if (!user) return null;
  // The address the link is sent to; an email change invalidates the link.
  return {
    user,
    token: await issueToken(q, user.id, "password_reset", user.email),
  };
}

// Returns the user ID, or null for an invalid, used or expired link.
export async function resetPassword(q, token, password) {
  const row = await consumeToken(q, token, "password_reset");
  if (!row || row.email !== row.current_email) return null;
  const hash = await hashPassword(password);
  // Opening the link proves control of the mailbox, so the address is verified.
  await q.query(
    "UPDATE users SET password_hash=$2,password_changed_at=now(),email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1",
    [row.user_id, hash],
  );
  await q.query(
    "DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset'",
    [row.user_id],
  );
  // Every existing session ends, including a possibly compromised one.
  await q.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
  return row.user_id;
}

export async function requestEmailVerification(q, userId) {
  const user = (
    await q.query(
      "SELECT id,name,email,email_verified_at FROM users WHERE id=$1 AND NOT blocked",
      [userId],
    )
  ).rows[0];
  if (!user || user.email_verified_at) return null;
  return {
    user,
    token: await issueToken(q, user.id, "email_verify", user.email),
  };
}

export async function verifyEmail(q, token) {
  const row = await consumeToken(q, token, "email_verify");
  // A link confirms only the address it was sent to.
  if (!row || row.email !== row.current_email) return null;
  await q.query(
    "UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1",
    [row.user_id],
  );
  return row.user_id;
}
