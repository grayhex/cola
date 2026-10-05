import { ZodError } from "zod";
import { transaction, db } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { limits } from "../limits.ts";
import { IntentError, intentInput } from "../ride-intent-input.ts";
import {
  closeIntent,
  createIntent,
  intentKeysetPage,
  intentVersioned,
  updateIntent,
} from "../ride-intents.ts";
import { RideError } from "../ride-gpx.ts";
import { respondRide, rideParticipation } from "../rides.ts";
import { stableUuid } from "../stable-uuid.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { ApiError, detailsOf, errorStatus, notFound } from "./errors.ts";
import { idempotencyKey, idempotent } from "./idempotency.ts";
import { idOf } from "./journal-handlers.ts";
import { toRideIntent, toRideParticipation } from "./mappers.ts";
import { signedIn } from "./personal-handlers.ts";
import { checkIfMatch, etagOf, parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  parseNoQuery,
  parseParticipationQuery,
  parsePageQuery,
  rideParticipationRequestSchema,
} from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";

// Planning together through /api/v1 (#343): intentions to ride, and a person's
// own part in a planned ride. The engines are the site's (`ride-intents.ts`,
// `respondRide`), so who may see what, the windows and zones, the quota, the
// locks and the notices are the same. What this layer adds are the conventions
// of #305: the credential's Origin rule, a body of its own, the shared budgets,
// the verified e-mail policy, versions (`ETag`) and idempotent creation.

type IdParams = { params: Promise<{ id: string }> };

const missingIntent = () => notFound("Намерение не найдено.");
const missingRide = () => notFound("Покатушка недоступна.");

/** The engine's errors, in the API's envelope. */
async function throughIntents<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ZodError)
      throw new ApiError("invalid_request", "Проверьте поля запроса.", {
        details: detailsOf(error),
      });
    if (!(error instanceof IntentError)) throw error;
    if (error.status === 404) throw missingIntent();
    if (error.status === 401)
      throw new ApiError("unauthorized", "Войдите в аккаунт.");
    if (error.status === 409) throw new ApiError("conflict", error.message);
    throw new ApiError("invalid_request", error.message);
  }
}

/** The same person with the same key always makes the same intention, nobody else's. */
const intentIdOf = (owner: string, key: string) =>
  stableUuid(`ride-intent:${owner}:${key}`);

const etagOfIntent = (id: string, version: string) =>
  etagOf("ride-intent", id, version);

/** The intention and its ETag, read in `q`. */
async function intentResponse(
  q: Parameters<typeof intentVersioned>[0],
  viewer: string,
  id: string,
) {
  const { intent, version } = await intentVersioned(q, viewer, id);
  return { body: toRideIntent(intent), etag: etagOfIntent(id, version) };
}

function listOf(own: boolean) {
  return (req: Request) =>
    safely(async () => {
      const viewer = await signedIn(req);
      const query = parsePageQuery(new URL(req.url));
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const page = await intentKeysetPage(db, viewer.id, {
        own,
        limit: query.limit,
        after,
      });
      return ok({
        items: page.items.map(toRideIntent),
        nextCursor: page.next ? encodeCursor(page.next) : null,
      });
    });
}

/** GET /api/v1/me/ride-intents: own intentions in every state but deleted. */
export const handleOwnRideIntents = listOf(true);
/** GET /api/v1/ride-intents: the community's active intentions. */
export const handleCommunityRideIntents = listOf(false);

/** GET /api/v1/ride-intents/{id} */
export function handleGetRideIntent(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await signedIn(req);
    parseNoQuery(new URL(req.url));
    const id = idOf((await params).id, "Намерение не найдено.");
    const { body, etag } = await throughIntents(() =>
      intentResponse(db, viewer.id, id),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** POST /api/v1/ride-intents */
export function handleCreateRideIntent(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    const input = await parseJsonBody(req, intentInput, 8192);
    // Publishing to the community needs a confirmed address, as on the site.
    if (input.visibility === "community") requireVerifiedEmail(viewer);
    const key = idempotencyKey(req.headers);
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key,
        body: input,
        // The key is the identity of the intention: a retry must find the same one.
        required: true,
      },
      async (q) => {
        await limitedIn(
          q,
          "ride-intent-write:" + viewer.id,
          limits.rideIntentWrites,
        );
        const id = intentIdOf(viewer.id, key as string);
        const { created } = await throughIntents(() =>
          createIntent(q, viewer.id, { ...input, requestId: id }),
        );
        const { body, etag } = await intentResponse(q, viewer.id, id);
        return { status: created ? 201 : 200, body, headers: { ETag: etag } };
      },
    );
    return ok(response.body, response.status, {
      ...response.headers,
      ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
  });
}

/** PUT /api/v1/ride-intents/{id}: a full replacement of an own intention. */
export function handleReplaceRideIntent(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Намерение не найдено.");
    const input = await parseJsonBody(req, intentInput, 8192);
    if (input.visibility === "community") requireVerifiedEmail(viewer);
    await limited("ride-intent-write:" + viewer.id, limits.rideIntentWrites);
    const { body, etag } = await transaction((q) =>
      throughIntents(async () => {
        await updateIntent(q, viewer.id, id, input, (version) =>
          // The version this edit replaces, under the owner's lock: a second
          // device that edited first makes this one 412, never a silent overwrite.
          checkIfMatch(req.headers, etagOfIntent(id, version), {
            required: false,
          }),
        );
        return intentResponse(q, viewer.id, id);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** POST /api/v1/ride-intents/{id}/cancel: calls the intention off; it stays in the own list. */
export function handleCancelRideIntent(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Намерение не найдено.");
    await limited("ride-intent-write:" + viewer.id, limits.rideIntentWrites);
    const { body, etag } = await transaction((q) =>
      throughIntents(async () => {
        await closeIntent(q, viewer.id, id, false);
        return intentResponse(q, viewer.id, id);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** DELETE /api/v1/ride-intents/{id}: removes the intention; a repeat is 204 too. */
export function handleDeleteRideIntent(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Намерение не найдено.");
    await limited("ride-intent-write:" + viewer.id, limits.rideIntentWrites);
    await transaction((q) =>
      throughIntents(() => closeIntent(q, viewer.id, id, true)),
    );
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** GET /api/v1/rides/{id}/participation[?occurrenceAt=] */
export function handleRideParticipation(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await signedIn(req);
    const id = idOf((await params).id, "Покатушка недоступна.");
    const query = parseParticipationQuery(new URL(req.url));
    const state = await rideParticipation(
      db,
      id,
      viewer.id,
      query.occurrenceAt ? new Date(query.occurrenceAt) : null,
    );
    if (!state) throw missingRide();
    return ok(toRideParticipation(state, viewer.id));
  });
}

/**
 * PUT /api/v1/rides/{id}/participation: "going", "maybe" or "not going" for one
 * date, to the conditions the person has seen. When the date or the conditions
 * are no longer the ones they saw (or the state does not allow the answer) the
 * answer is not taken: 409 with the state as it is now, never a silent yes.
 */
export function handleRespondToRide(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Покатушка недоступна.");
    const body = await parseJsonBody(req, rideParticipationRequestSchema, 2048);
    if (
      body.response !== "declined" &&
      body.expectedAgreementRevision === undefined
    )
      throw new ApiError("invalid_request", "Проверьте поля запроса.", {
        details: [
          {
            path: "expectedAgreementRevision",
            message:
              "Для «иду» и «возможно» нужна редакция условий, которую видел человек.",
          },
        ],
      });
    await limited("ride-write:" + viewer.id, limits.rideWrites);
    const occurrence = new Date(body.occurrenceAt);
    try {
      const state = await transaction(async (q) => {
        await respondRide(
          q,
          id,
          viewer.id,
          body.response,
          body.occurrenceAt,
          false,
          body.expectedAgreementRevision ?? null,
        );
        return rideParticipation(q, id, viewer.id, occurrence);
      });
      if (!state) throw missingRide();
      return ok(toRideParticipation(state, viewer.id));
    } catch (error) {
      if (!(error instanceof RideError)) throw error;
      if (error.status === 404) throw missingRide();
      if (error.status !== 409)
        throw new ApiError("invalid_request", error.message);
      // The answer was refused for the state: the state as it is now goes back,
      // read after the refused attempt rolled back.
      const current = await rideParticipation(db, id, viewer.id, occurrence);
      return ok(
        {
          error: { code: "conflict", message: error.message },
          current: current && toRideParticipation(current, viewer.id),
        },
        errorStatus.conflict,
      );
    }
  });
}
