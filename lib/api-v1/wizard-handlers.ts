import { randomUUID } from "node:crypto";
import { bikeResolverClient, resolverQuery } from "../bike-resolver-client.ts";
import { createWizardBike } from "../bike-wizard.ts";
import type { WizardInput } from "../bike-wizard.ts";
import { db, transaction } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { limits } from "../limits.ts";
import { getSite } from "../site.ts";
import { bicycleName } from "../wizard-options.ts";
import {
  bikeInputOf,
  bikeResponse,
  componentInputOf,
  throughBikes,
} from "./bike-write-handlers.ts";
import { ApiError } from "./errors.ts";
import { idempotent, requiredKey } from "./idempotency.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  bikeResolutionRequestSchema,
  bikeWizardRequestSchema,
} from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";
import { toBikeResolution } from "./wizard-mappers.ts";

// The wizard of a new bicycle for the native clients (#57 of the Android
// client): search of a build, then creation with the build the person checked.
// The engines are the site's (`bikeResolverClient`, `resolver_previews`,
// `createWizardBike`), so the rules, the stored source and the factory
// specification are the same as when the bicycle is made on the site. What this
// layer adds are the conventions of #305: a Bearer credential, a body in
// camelCase, shared budgets and an idempotent creation.

const MAX_RESOLVE_BODY = 4096;
/** A bicycle and up to 200 parts of its build. */
const MAX_WIZARD_BODY = 262144;
/** The budget of searches is the site's: `resolver:` + person, 30 per window. */
const RESOLVER_BUDGET = 30;

/** POST /api/v1/bike-resolutions */
export function handleResolveBike(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    const request = await parseJsonBody(
      req,
      bikeResolutionRequestSchema,
      MAX_RESOLVE_BODY,
    );
    await limited("resolver:" + viewer.id, RESOLVER_BUDGET);
    const query = resolverQuery.parse({
      brand: request.brand,
      model: request.model,
      trim: request.trim ?? null,
      year: request.year ?? null,
      ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
      ...(request.candidateId ? { candidateId: request.candidateId } : {}),
      ...(request.chooseCandidates ? { chooseCandidates: true } : {}),
    });
    // A failure of the service is an outcome (`upstream_unavailable`), not an error.
    const result = await bikeResolverClient.resolve(query);
    let preview: { id: string; expiresAt: string } | null = null;
    if (result.status === "resolved") {
      // The same preview the site keeps: creation checks the build against it.
      const id = randomUUID();
      await db.query("DELETE FROM resolver_previews WHERE expires_at<now()");
      const { rows } = await db.query<{ expires_at: Date }>(
        "INSERT INTO resolver_previews(id,owner_id,response) VALUES($1,$2,$3) RETURNING expires_at",
        [id, viewer.id, result],
      );
      preview = { id, expiresAt: new Date(rows[0].expires_at).toISOString() };
    }
    return ok(toBikeResolution(result, await getSite(db), preview));
  });
}

/** The engine's refusals of a wizard creation, as answers a client branches on. */
function wizardFailure(error: unknown): never {
  const reason = error instanceof Error ? error.message : "";
  if (reason === "PREVIEW_EXPIRED")
    throw new ApiError(
      "conflict",
      "Результат поиска устарел. Повторите поиск или сохраните велосипед без привязки к источнику.",
      {
        details: [
          { path: "previewId", message: "Предпросмотр устарел или не найден." },
        ],
      },
    );
  if (reason === "IDENTITY_CONFIRMATION_REQUIRED")
    throw new ApiError(
      "conflict",
      "Подтвердите отличие модели или года источника.",
      {
        details: [
          {
            path: "identityConfirmed",
            message:
              "Модель или год источника отличаются от велосипеда: нужно подтверждение.",
          },
        ],
      },
    );
  if (reason === "REQUEST_CONFLICT")
    throw new ApiError("conflict", "Этот запрос уже использован.");
  throw error;
}

/** POST /api/v1/bike-wizard/bikes */
export function handleCreateWizardBike(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    // The key before the body: a request that cannot be repeated is refused early.
    const key = requiredKey(req.headers);
    const request = await parseJsonBody(
      req,
      bikeWizardRequestSchema,
      MAX_WIZARD_BODY,
    );
    // Publishing needs a confirmed address, as on the site; a private bicycle
    // is a draft that anyone can keep.
    if (request.bike.isPublic) requireVerifiedEmail(viewer);
    const input: WizardInput = await throughBikes(async () => ({
      // One operation, one key: the site's own repeat check agrees with ours.
      requestId: key,
      previewId: request.previewId ?? null,
      identityConfirmed: request.identityConfirmed === true,
      bike: bikeInputOf({
        ...request.bike,
        name:
          request.bike.name?.trim() ||
          bicycleName({
            name: "",
            brand: request.bike.brand,
            model: request.bike.model,
            trim: request.bike.trim ?? "",
            year: request.bike.year,
          }),
      }),
      components: request.components.map(componentInputOf),
    }));
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key,
        body: request,
        required: true,
      },
      async (q) => {
        await limitedIn(q, "bike-create:" + viewer.id, limits.bikeCreates);
        const created = await throughBikes(() =>
          createWizardBike(q, viewer.id, input).catch(wizardFailure),
        );
        const { body, etag } = await bikeResponse(q, viewer.id, created.id);
        return { status: 201, body, headers: { ETag: etag } };
      },
    );
    return ok(response.body, response.status, {
      ...response.headers,
      ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
  });
}
