import { rateLimit } from "../auth.ts";
import type { CurrentUser } from "../contracts.ts";
import { db } from "../db.ts";
import { sameOrigin } from "../http.ts";
import { ApiError } from "./errors.ts";
import { authenticate } from "./viewer.ts";

// Who may write, and how much (#305). The request rules are request.ts, the
// idempotent creation is idempotency.ts.

/**
 * A cookie is an ambient credential: anything it changes needs our Origin. A
 * Bearer token is sent on purpose by the application, so Origin does not apply
 * to it (the native client sends none).
 */
export function requireOriginForCookie(
  req: Request,
  credential: { scheme: string } | null,
) {
  if (credential?.scheme === "cookie" && !sameOrigin(req))
    throw new ApiError("forbidden", "Недопустимый источник запроса.");
}

/**
 * The person making a change, or an error: signed in (401) and, for a cookie,
 * from our own site (403). The check belongs to the credential, so a handler
 * cannot forget it for one method.
 */
export async function writer(req: Request): Promise<CurrentUser> {
  const { credential, viewer } = await authenticate(req.headers);
  requireOriginForCookie(req, credential);
  if (!viewer) throw new ApiError("unauthorized", "Войдите в аккаунт.");
  return viewer;
}

/**
 * Counts one action against a budget of the person; over the budget it is 429
 * with the seconds until the window ends in `Retry-After`. The window is the
 * one `rateLimit` keeps in `rate_limits`, shared with the legacy routes.
 */
export async function limited(key: string, maximum: number) {
  if (await rateLimit(key, maximum)) return;
  const { rows } = await db.query<{ seconds: number }>(
    "SELECT greatest(1,ceil(extract(epoch FROM expires_at-now()))::int) AS seconds FROM rate_limits WHERE key=$1",
    [key],
  );
  throw new ApiError(
    "rate_limited",
    "Слишком много действий. Попробуйте позже.",
    { headers: { "Retry-After": String(rows[0]?.seconds ?? 900) } },
  );
}
