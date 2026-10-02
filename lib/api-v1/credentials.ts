import type { SessionCredential } from "../viewer-session.ts";
import { SESSION_COOKIE } from "../viewer-session.ts";
import { ApiError } from "./errors.ts";

// The /api/v1 adapter of the viewer layer (#134): it reads a credential from a
// plain Request, with no Next cookie jar. The browser's HttpOnly session cookie
// is the only credential; no production Bearer token is issued (#156).

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

/**
 * The credential of an /api/v1 request, or null for a guest. An
 * `Authorization` header is reserved for a future transport: a client that
 * sends one is told it is unsupported rather than silently served as a guest.
 */
export function requestCredential(headers: Headers): SessionCredential | null {
  if (headers.has("authorization"))
    throw new ApiError(
      "unsupported_authentication",
      "Заголовок Authorization пока не поддерживается: API v1 принимает только сессию входа в браузере.",
    );
  const token = readSessionCookie(headers.get("cookie"));
  return token ? { scheme: "cookie", token } : null;
}
