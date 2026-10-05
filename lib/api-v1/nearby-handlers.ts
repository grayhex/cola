import { db, transaction } from "../db.ts";
import { limits } from "../limits.ts";
import { logEvent } from "../observability.ts";
import {
  NearbyError,
  forgetNearby,
  nearbyAreaInput,
  nearbySettingsPatch,
  nearbyOffers,
  nearbyState,
  removeNearbyArea,
  saveNearbyArea,
  saveNearbySettings,
  type NearbyState,
} from "../nearby.ts";
import { ApiError } from "./errors.ts";
import { toNearby, toNearbyOffers } from "./mappers.ts";
import { signedIn } from "./personal-handlers.ts";
import { checkIfMatch, etagOf, parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  nearbyOffersQuerySchema,
  parseNoQuery,
  parseQuery,
} from "./schemas.ts";
import { requireOriginForCookie, limited } from "./write.ts";
import { authenticate } from "./viewer.ts";

// The private area of "rides near me" through /api/v1 (#343). It is the
// person's own, so a guest is 401 and nothing is shared. The area is written
// with the version that was read (`If-Match`, required), so two devices cannot
// overwrite each other unseen; the coordinates are never logged or echoed in
// an error, and the phone's area is accepted from the app's token only.

const etagOfNearby = (userId: string, version: string) =>
  etagOf("nearby", userId, version);
function respond(userId: string, state: NearbyState) {
  return ok(toNearby(state), 200, {
    ETag: etagOfNearby(userId, state.version),
  });
}
/** The engine's errors in the API's codes; the message carries no place. */
function refused(error: unknown): never {
  if (!(error instanceof NearbyError)) throw error;
  if (error.status === 401)
    throw new ApiError("unauthorized", "Войдите в аккаунт.");
  if (error.status === 409) throw new ApiError("conflict", error.message);
  if (error.status === 503)
    throw new ApiError("service_unavailable", error.message);
  throw new ApiError("invalid_request", error.message);
}
/** `If-Match` against the version in the row, under the person's lock. */
const versionOf =
  (req: Request, userId: string, required: boolean) => (version: string) =>
    checkIfMatch(req.headers, etagOfNearby(userId, version), { required });

async function writerWithCredential(req: Request) {
  const { credential, viewer } = await authenticate(req.headers);
  if (!viewer) throw new ApiError("unauthorized", "Войдите в аккаунт.");
  requireOriginForCookie(req, credential);
  return { viewer, credential };
}

/** GET /api/v1/me/nearby */
export function handleNearby(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    parseNoQuery(new URL(req.url));
    return respond(viewer.id, await nearbyState(db, viewer.id));
  });
}

/** PATCH /api/v1/me/nearby: the switch, the horizon, the preferences. */
export function handleNearbySettings(req: Request) {
  return safely(async () => {
    const { viewer } = await writerWithCredential(req);
    await limited("nearby:" + viewer.id, limits.nearbyWrites);
    const patch = await parseJsonBody(req, nearbySettingsPatch, 2048);
    const state = await transaction((q) =>
      saveNearbySettings(q, viewer.id, patch, {
        precondition: versionOf(req, viewer.id, false),
      }),
    ).catch(refused);
    logEvent("nearby_settings_saved", { enabled: state.enabled });
    return respond(viewer.id, state);
  });
}

/** PUT /api/v1/me/nearby/area: the one area. */
export function handleNearbyArea(req: Request) {
  return safely(async () => {
    const { viewer, credential } = await writerWithCredential(req);
    await limited("nearby:" + viewer.id, limits.nearbyWrites);
    const input = await parseJsonBody(req, nearbyAreaInput, 2048);
    if (input.source === "device" && credential?.scheme !== "bearer")
      throw new ApiError(
        "forbidden",
        "Положение подтверждает телефон: район с телефона принимается только с токеном приложения.",
      );
    const state = await transaction((q) =>
      saveNearbyArea(q, viewer.id, input, {
        precondition: versionOf(req, viewer.id, true),
      }),
    ).catch(refused);
    // Only that an area was saved and from where: never where.
    logEvent("nearby_area_saved", { source: input.source });
    return respond(viewer.id, state);
  });
}

/** DELETE /api/v1/me/nearby/area: the area goes, the switch and choices stay. */
export function handleNearbyAreaRemove(req: Request) {
  return safely(async () => {
    const { viewer } = await writerWithCredential(req);
    await limited("nearby:" + viewer.id, limits.nearbyWrites);
    const state = await transaction((q) =>
      removeNearbyArea(q, viewer.id, {
        precondition: versionOf(req, viewer.id, false),
      }),
    ).catch(refused);
    logEvent("nearby_area_removed", {});
    return respond(viewer.id, state);
  });
}

/** DELETE /api/v1/me/nearby: opt-out, everything is forgotten. */
export function handleNearbyForget(req: Request) {
  return safely(async () => {
    const { viewer } = await writerWithCredential(req);
    await limited("nearby:" + viewer.id, limits.nearbyWrites);
    await transaction((q) => forgetNearby(q, viewer.id)).catch(refused);
    logEvent("nearby_forgotten", {});
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/**
 * GET /api/v1/me/nearby/offers: the plans on now in the person's own area, asked
 * for on purpose (the feed after turning it on or moving). A read: it sends
 * nothing and keeps no record of what was shown or of where the person is.
 */
export function handleNearbyOffers(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const { limit } = parseQuery(new URL(req.url), nearbyOffersQuerySchema);
    await limited("nearby-offers:" + viewer.id, limits.nearbyOfferReads);
    const offers = await nearbyOffers(db, viewer.id, { limit });
    return ok(toNearbyOffers(offers.state, offers.rows, viewer.id), 200, {
      "Cache-Control": "no-store",
    });
  });
}
