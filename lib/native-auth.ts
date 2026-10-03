import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Queryable } from "./db.ts";
import { digest } from "./password.ts";

// Native sign-in with an external provider (#304, ADR D10 in #156). The app
// opens the system browser on the web flow of #151 with the S256 challenge of a
// secret it keeps; when the person is signed in, the server redirects to the
// app's own HTTPS link with a one-time ColaBike code. Only the holder of the
// verifier can exchange that code for device tokens, so a code seen in a
// redirect, a log or by another app is useless. The provider's tokens never
// leave the server.

export const NATIVE_CODE_PREFIX = "cola_ac_";
export const nativeCodePattern = /^cola_ac_[A-Za-z0-9_-]{43}$/;
/** The challenge: base64url of a SHA-256 digest, 43 characters, no padding. */
export const challengePattern = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 verifier: 43 to 128 unreserved characters. */
export const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * Where the browser is sent at the end: the HTTPS link of the app (a Universal
 * Link or an App Link), chosen by the operator, never by the request. Without
 * it native sign-in is off and the rest of the site is unaffected.
 */
export function nativeAuthReturnUrl(env = process.env): URL | null {
  const raw = env.NATIVE_AUTH_RETURN_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  return url;
}

/** The return link with the code, or with a fixed error code. */
export function nativeReturn(
  base: URL,
  result: { code: string } | { error: string },
) {
  const url = new URL(base);
  if ("code" in result) url.searchParams.set("code", result.code);
  else url.searchParams.set("error", result.error);
  return url;
}

/** The challenge of a verifier, as the app computes it. */
export const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/** Issues the code of a signed-in person for the app that sent `challenge`. */
export async function issueNativeCode(
  q: Queryable,
  userId: string,
  challenge: string,
) {
  const code = NATIVE_CODE_PREFIX + randomBytes(32).toString("base64url");
  await q.query("DELETE FROM native_auth_codes WHERE expires_at<now()");
  await q.query(
    "INSERT INTO native_auth_codes(code_hash,user_id,app_challenge) VALUES($1,$2,$3)",
    [digest(code), userId, challenge],
  );
  return code;
}

/**
 * Takes a code exactly once and checks the verifier against it. The code is
 * spent by the attempt, right or wrong: a wrong verifier does not leave it for
 * a second guess. A blocked person gets nothing. Null for every refusal, so
 * the caller cannot tell which one it was.
 */
export async function redeemNativeCode(
  q: Queryable,
  code: string,
  verifier: string,
) {
  if (!nativeCodePattern.test(code) || !verifierPattern.test(verifier))
    return null;
  const row = (
    await q.query<{ user_id: string; app_challenge: string }>(
      `DELETE FROM native_auth_codes WHERE code_hash=$1 AND expires_at>now()
       RETURNING user_id,app_challenge`,
      [digest(code)],
    )
  ).rows[0];
  if (!row) return null;
  const expected = Buffer.from(row.app_challenge);
  const given = Buffer.from(challengeOf(verifier));
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  const user = (
    await q.query<{ blocked: boolean }>(
      "SELECT blocked FROM users WHERE id=$1",
      [row.user_id],
    )
  ).rows[0];
  return user && !user.blocked ? row.user_id : null;
}
