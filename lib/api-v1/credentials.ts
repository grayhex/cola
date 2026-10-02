import type { SessionCredential } from "../viewer-session.ts";
import { SESSION_COOKIE } from "../viewer-session.ts";
import { accessTokenPattern } from "../device-sessions.ts";
import { ApiError, bearerChallenge } from "./errors.ts";

// The /api/v1 adapter of the viewer layer (#134): it reads a credential from a
// plain Request, with no Next cookie jar: the browser's HttpOnly session cookie
// or a device session's Bearer access token (#303).

// A session token is 32 random bytes in base64url (lib/auth.ts startSession).
const sessionToken = /^[A-Za-z0-9_-]{43}$/;

/**
 * The session token in a Cookie header, or null. The first cookie of that
 * name wins, as in the browser's own jar; a malformed value is no session.
 */
export function readSessionCookie(header: string | null): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const equals = pair.indexOf("=");
    if (equals < 0 || pair.slice(0, equals).trim() !== SESSION_COOKIE) continue;
    const value = pair.slice(equals + 1).trim();
    return sessionToken.test(value) ? value : null;
  }
  return null;
}

/** True when the Cookie header carries a session cookie of any value. */
function hasSessionCookie(header: string | null) {
  return (header ?? "")
    .split(";")
    .some((pair) => pair.slice(0, pair.indexOf("=")).trim() === SESSION_COOKIE);
}

/**
 * The credential of an /api/v1 request, or null for a guest.
 *
 * - A browser session cookie.
 * - `Authorization: Bearer cola_at_…`, a device session's access token (#303).
 *   A token of the wrong shape is refused at once; it never becomes a guest.
 * - Both together is ambiguous and refused, not resolved silently.
 * - Any other `Authorization` scheme is unsupported.
 */
export function requestCredential(headers: Headers): SessionCredential | null {
  const authorization = headers.get("authorization");
  if (authorization === null) {
    const token = readSessionCookie(headers.get("cookie"));
    return token ? { scheme: "cookie", token } : null;
  }
  const match = /^([A-Za-z][A-Za-z0-9._~+-]*)[ \t]+(\S+)[ \t]*$/.exec(
    authorization,
  );
  if (!match || match[1].toLowerCase() !== "bearer")
    throw new ApiError(
      "unsupported_authentication",
      "Эта схема Authorization не поддерживается: используйте Bearer-токен доступа устройства или сессию входа в браузере.",
    );
  if (hasSessionCookie(headers.get("cookie")))
    throw new ApiError(
      "ambiguous_authentication",
      "Запрос содержит и cookie сессии, и заголовок Authorization. Оставьте один способ входа.",
    );
  if (!accessTokenPattern.test(match[2]))
    throw new ApiError(
      "invalid_token",
      "Токен доступа не распознан. Войдите заново.",
      { headers: bearerChallenge() },
    );
  return { scheme: "bearer", token: match[2] };
}
