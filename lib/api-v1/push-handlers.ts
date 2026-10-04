import { db, transaction } from "../db.ts";
import { logEvent } from "../observability.ts";
import { limits } from "../limits.ts";
import {
  pushDeviceOf,
  PushRegistryError,
  registerPushDevice,
  revokePushDevice,
} from "../push-devices.ts";
import { sessionHashOf } from "../viewer-session.ts";
import { ApiError } from "./errors.ts";
import { toPushDevice } from "./mappers.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import { pushDeviceRegistrationSchema } from "./schemas.ts";
import { requireOriginForCookie, limited } from "./write.ts";
import { authenticate } from "./viewer.ts";

// The push address of this phone (#342). The registration belongs to the device
// session the request is made with, so the person and the session come from
// the Bearer token and never from the body, and a browser cookie, which has no
// phone, is refused. The address is a secret: it is read from the body once,
// sealed by the registry, and not echoed, logged or kept anywhere else.

async function deviceSession(req: Request) {
  const { credential, viewer } = await authenticate(req.headers);
  if (!credential || !viewer)
    throw new ApiError("unauthorized", "Войдите в аккаунт.");
  requireOriginForCookie(req, credential);
  if (credential.scheme !== "bearer")
    throw new ApiError(
      "forbidden",
      "Push привязывается к сессии приложения на телефоне.",
    );
  const session = (
    await db.query<{ id: string }>(
      "SELECT id FROM sessions WHERE token_hash=$1 AND user_id=$2 AND kind='device'",
      [sessionHashOf(credential), viewer.id],
    )
  ).rows[0];
  if (!session)
    throw new ApiError("invalid_token", "Сессия не найдена. Войдите заново.");
  return { viewer, sessionId: session.id };
}

function registryFailure(error: unknown): never {
  if (error instanceof PushRegistryError) {
    if (error.problem === "unavailable")
      throw new ApiError("service_unavailable", error.message);
    if (error.problem === "project")
      throw new ApiError("invalid_request", error.message, {
        details: [{ path: "projectId", message: error.message }],
      });
    if (error.problem === "session")
      throw new ApiError("forbidden", error.message);
    throw new ApiError("conflict", error.message);
  }
  throw error;
}

/** GET /api/v1/me/push-device */
export function handlePushDevice(req: Request) {
  return safely(async () => {
    const { sessionId } = await deviceSession(req);
    const device = await pushDeviceOf(db, sessionId);
    if (!device)
      throw new ApiError("not_found", "Этот телефон не привязан к push.");
    return ok(toPushDevice(device));
  });
}

/** PUT /api/v1/me/push-device */
export function handlePushDeviceRegister(req: Request) {
  return safely(async () => {
    const { viewer, sessionId } = await deviceSession(req);
    await limited("push-device:" + viewer.id, limits.pushDeviceWrites);
    const body = await parseJsonBody(req, pushDeviceRegistrationSchema);
    const device = await transaction((q) =>
      registerPushDevice(q, { ...body, userId: viewer.id, sessionId }),
    ).catch(registryFailure);
    logEvent("push_device_registered", { generation: device.generation });
    return ok(toPushDevice(device));
  });
}

/** DELETE /api/v1/me/push-device */
export function handlePushDeviceRevoke(req: Request) {
  return safely(async () => {
    const { viewer, sessionId } = await deviceSession(req);
    await limited("push-device:" + viewer.id, limits.pushDeviceWrites);
    const revoked = await transaction((q) =>
      revokePushDevice(q, sessionId, "user"),
    );
    if (revoked) logEvent("push_device_revoked", { by: "self" });
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
