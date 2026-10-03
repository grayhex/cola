import type { CurrentUser } from "./contracts.ts";
import { ApiError, errorStatus } from "./api-v1/errors.ts";
import { authenticate } from "./api-v1/viewer.ts";

// Who asks for a media file (#324). The URLs that /api/v1 hands to a client
// point at the media routes of the site, and a private file (a private bike's
// photo, a journal draft's picture, a listing draft's photo) is for its owner
// only. A browser asks with its cookie; a native client with the Bearer token
// of its device session, the same credential as /api/v1. One boundary for all
// media routes, so none of them reads a credential on its own.

/** The answers of a media route depend on who asks, by cookie or by token. */
export const mediaVary = { Vary: "Cookie, Authorization" };

export type MediaViewer = { viewer: CurrentUser | null } | { denied: Response };

/**
 * The person asking: the Bearer token when the request carries one (a bad,
 * expired or revoked token is refused, never read as a guest; a token together
 * with a cookie is refused as ambiguous), otherwise the cookie's person.
 */
export async function mediaViewer(
  req: Request,
  cookieViewer: CurrentUser | null,
): Promise<MediaViewer> {
  if (!req.headers.has("authorization")) return { viewer: cookieViewer };
  try {
    return { viewer: (await authenticate(req.headers)).viewer };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      denied: Response.json(
        { error: error.message },
        {
          status: errorStatus[error.code],
          headers: {
            ...error.headers,
            ...mediaVary,
            "Cache-Control": "no-store",
          },
        },
      ),
    };
  }
}
