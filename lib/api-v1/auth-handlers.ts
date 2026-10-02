import type { z } from "zod";
import { allowAuth, trustedIp } from "../auth-limits.ts";
import { listSessions, endSessionById } from "../account-data.ts";
import { rateLimit } from "../auth.ts";
import { db, transaction } from "../db.ts";
import {
  createDeviceSession,
  deviceSessionConfig,
  endDeviceSession,
  refreshDeviceSession,
  sessionOfRefreshToken,
} from "../device-sessions.ts";
import { readBytes, sameOrigin } from "../http.ts";
import { limits } from "../limits.ts";
import { logEvent } from "../observability.ts";
import { digest, verifyPassword } from "../password.ts";
import { credentials } from "../validation.ts";
import { sessionHashOf, viewerById } from "../viewer-session.ts";
import { ApiError, detailsOf } from "./errors.ts";
import { toAccountSession, toSessionGrant } from "./mappers.ts";
import { ok, safely } from "./respond.ts";
import {
  bikeIdSchema,
  createSessionRequestSchema,
  refreshRequestSchema,
} from "./schemas.ts";
import { authenticate } from "./viewer.ts";

// Session endpoints of /api/v1 (#303, ADR in #156): signing a device in, the
// refresh-token rotation, and ending or listing sessions. Everything about who
// may read a bike stays in handlers.ts; this file only issues, renews and ends
// credentials. Tokens and passwords are never written to a log.

const signIn = () => new ApiError("unauthorized", "Войдите в аккаунт.");
const tooMany = () =>
  new ApiError(
    "rate_limited",
    "Слишком много попыток. Попробуйте через 15 минут.",
    { headers: { "Retry-After": "900" } },
  );

/** A JSON body of at most `limit` bytes that matches `schema`, or invalid_request. */
async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
  limit = 8192,
): Promise<z.infer<T>> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? ""))
    throw new ApiError(
      "invalid_request",
      "Тело запроса должно быть application/json.",
    );
  let value: unknown;
  try {
    value = JSON.parse((await readBytes(req, limit)).toString("utf8"));
  } catch {
    throw new ApiError("invalid_request", "Тело запроса не разобрано.");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError("invalid_request", "Проверьте поля запроса.", {
      details: detailsOf(result.error),
    });
  return result.data;
}

/** A cookie is an ambient credential: changing anything with it needs our Origin. */
function requireOriginForCookie(
  req: Request,
  credential: { scheme: string } | null,
) {
  if (credential?.scheme === "cookie" && !sameOrigin(req))
    throw new ApiError("forbidden", "Недопустимый источник запроса.");
}

const noContent = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

// Matches the web sign-in: an unknown address costs the same as a wrong password.
const absentHash = "00000000000000000000000000000000:" + "00".repeat(64);

/** POST /api/v1/auth/sessions */
export function handleCreateSession(req: Request) {
  return safely(async () => {
    const input = await parseBody(req, createSessionRequestSchema);
    const email = credentials.shape.email.safeParse(input.email);
    // The same budgets as the web sign-in: per address, per account and global.
    if (
      !(await allowAuth(
        req,
        email.success ? email.data : input.email,
        rateLimit,
      ))
    )
      throw tooMany();
    const user = email.success
      ? (
          await db.query<{
            id: string;
            password_hash: string | null;
            blocked: boolean;
          }>("SELECT id,password_hash,blocked FROM users WHERE email=$1", [
            email.data,
          ])
        ).rows[0]
      : undefined;
    const valid = await verifyPassword(
      input.password,
      user?.password_hash || absentHash,
    );
    if (!user || !user.password_hash || !valid || user.blocked)
      throw new ApiError(
        "invalid_credentials",
        "Неверная почта или пароль либо аккаунт заблокирован.",
      );
    const grant = await transaction((q) =>
      createDeviceSession(
        q,
        user.id,
        {
          name: input.device.name,
          platform: input.device.platform,
          appVersion: input.device.appVersion ?? null,
        },
        req.headers.get("user-agent") ?? "",
      ),
    );
    logEvent("session_created", {
      sessionId: grant.sessionId,
      platform: input.device.platform,
    });
    return ok(await grantBody(grant, user.id), 201);
  });
}

async function grantBody(
  grant: Parameters<typeof toSessionGrant>[0],
  userId: string,
) {
  const [session] = (await listSessions(db, userId, null)).filter(
    (row) => row.id === grant.sessionId,
  );
  const viewer = await viewerById(db, userId);
  if (!session || !viewer) throw signIn();
  return toSessionGrant(grant, session, viewer);
}

/** POST /api/v1/auth/sessions/refresh */
export function handleRefreshSession(req: Request) {
  return safely(async () => {
    const input = await parseBody(req, refreshRequestSchema);
    // Separate budgets from sign-in: per address (when it can be trusted) and
    // per session, so one stuck client cannot spend the others' allowance.
    const ip = trustedIp(req);
    if (ip && !(await rateLimit("refresh:ip:" + digest(ip), limits.refreshIp)))
      throw tooMany();
    const sessionId = await sessionOfRefreshToken(db, input.refreshToken);
    if (
      sessionId &&
      !(await rateLimit("refresh:session:" + sessionId, limits.refreshSession))
    )
      throw tooMany();
    const result = await refreshDeviceSession(
      transaction,
      input.refreshToken,
      deviceSessionConfig(),
    );
    if (!result.ok) {
      if (result.reason === "reuse")
        logEvent("session_reuse_detected", { sessionId: result.sessionId });
      // A replayed token, an expired one and an unknown one look the same.
      throw new ApiError(
        "invalid_token",
        "Refresh-токен недействителен. Войдите заново.",
      );
    }
    logEvent("session_refreshed", { sessionId: result.grant.sessionId });
    return ok(await grantBody(result.grant, result.userId));
  });
}

/** DELETE /api/v1/auth/sessions/current */
export function handleRevokeCurrentSession(req: Request) {
  return safely(async () => {
    const { credential, viewer } = await authenticate(req.headers);
    if (!credential || !viewer) throw signIn();
    requireOriginForCookie(req, credential);
    const hash = sessionHashOf(credential);
    if (credential.scheme === "bearer") await endDeviceSession(db, hash);
    else await db.query("DELETE FROM sessions WHERE token_hash=$1", [hash]);
    logEvent("session_revoked", { by: "self" });
    return noContent();
  });
}

/** GET /api/v1/auth/sessions */
export function handleListSessions(req: Request) {
  return safely(async () => {
    const { credential, viewer } = await authenticate(req.headers);
    if (!credential || !viewer) throw signIn();
    const sessions = await listSessions(
      db,
      viewer.id,
      sessionHashOf(credential),
    );
    return ok({ items: sessions.map(toAccountSession) });
  });
}

/** DELETE /api/v1/auth/sessions/{id} */
export function handleRevokeSession(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return safely(async () => {
    const { credential, viewer } = await authenticate(req.headers);
    if (!credential || !viewer) throw signIn();
    requireOriginForCookie(req, credential);
    const { id } = await params;
    const found =
      bikeIdSchema.safeParse(id).success &&
      (await endSessionById(db, viewer.id, id));
    // Another person's session and a missing one are the same answer.
    if (!found) throw new ApiError("not_found", "Сессия не найдена.");
    logEvent("session_revoked", { sessionId: id, by: "owner" });
    return noContent();
  });
}
