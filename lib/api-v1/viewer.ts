import type { CurrentUser } from "../contracts.ts";
import { db } from "../db.ts";
import { bearerFailure } from "../device-sessions.ts";
import { sessionHashOf, viewerFromCredential } from "../viewer-session.ts";
import type { SessionCredential } from "../viewer-session.ts";
import { requestCredential } from "./credentials.ts";
import { ApiError, bearerChallenge } from "./errors.ts";

// Who is asking an /api/v1 operation (#303): the credential of the request and
// the person behind it. A Bearer token that finds nobody is an error, never a
// guest; a cookie that finds nobody is, as before.

export interface Authenticated {
  credential: SessionCredential | null;
  viewer: CurrentUser | null;
}

export async function authenticate(headers: Headers): Promise<Authenticated> {
  const credential = requestCredential(headers);
  const viewer = await viewerFromCredential(db, credential);
  if (!viewer && credential?.scheme === "bearer") {
    // An access token that only ran out is renewed with the refresh token; an
    // unknown, revoked or blocked one means signing in again.
    if (
      (await bearerFailure(db, sessionHashOf(credential))) === "token_expired"
    )
      throw new ApiError(
        "token_expired",
        "Токен доступа истёк. Обновите его refresh-токеном.",
        { headers: bearerChallenge("The access token expired") },
      );
    throw new ApiError(
      "invalid_token",
      "Токен доступа недействителен или отозван. Войдите заново.",
      { headers: bearerChallenge() },
    );
  }
  return { credential, viewer };
}

/** The viewer of a request, or null for a guest. */
export async function viewerOf(headers: Headers) {
  return (await authenticate(headers)).viewer;
}
