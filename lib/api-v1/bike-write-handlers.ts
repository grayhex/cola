import path from "node:path";
import { ZodError } from "zod";
import {
  addComponentRow,
  bikeVersionOf,
  componentRowOf,
  deleteComponentRow,
  lockOwnBike,
  removeBike,
  setBikeSharing,
  setGroupOrder,
  updateBikeRow,
  updateComponentRow,
} from "../bike-service.ts";
import {
  classificationOf,
  compatibilityCategory,
} from "../bike-classification.ts";
import { CommunityError } from "../community-validation.ts";
import type { BikeRow, ComponentRow } from "../database-rows.ts";
import type { Queryable } from "../db.ts";
import { db, transaction } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { QuotaError, limits } from "../limits.ts";
import { insertBike, ownedBike, validatePurposes } from "../repository.ts";
import { visibleBikeById } from "../showcase.ts";
import { getSite } from "../site.ts";
import { bikeInput, componentInput } from "../validation.ts";
import type { BikeInput, ComponentInput } from "../validation.ts";
import { ApiError, detailsOf, notFound } from "./errors.ts";
import { idempotencyKey, idempotent } from "./idempotency.ts";
import { idOf } from "./journal-handlers.ts";
import { toBike, toBikeComponent } from "./mappers.ts";
import { checkIfMatch, etagOf, parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  bikeComponentPatchRequestSchema,
  bikeComponentRequestSchema,
  bikeGroupOrderRequestSchema,
  bikePatchRequestSchema,
  bikeRequestSchema,
  parseNoQuery,
} from "./schemas.ts";
import type {
  BikeComponentPatchRequest,
  BikeComponentRequest,
  BikePatchRequest,
  BikeRequest,
} from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";

// Writing bicycles through /api/v1 (#347, W2b): a person's own bicycle, the
// parts of the build and the order of their groups. The engines are the
// site's (`bike-service.ts`, `insertBike`, `bikeInput`, `componentInput`), so
// the limits, the privacy and the email policy are the same ones. What this
// layer adds are the conventions of #305: the credential's Origin rule, a body
// of its own in camelCase, shared budgets, versions (`ETag`/`If-Match`) and
// idempotent creation.

type BikeParams = { params: Promise<{ id: string }> };
type ComponentParams = { params: Promise<{ id: string; componentId: string }> };

const MAX_BODY = 16384;
const missingBike = () => notFound("Велосипед не найден.");
const missingComponent = () => notFound("Компонент не найден.");

const uploadsDirectory = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");

/** The engines' failures, in the API's envelope. */
async function throughBikes<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ZodError)
      throw new ApiError("invalid_request", "Проверьте поля запроса.", {
        details: detailsOf(error),
      });
    if (error instanceof QuotaError)
      throw new ApiError("conflict", error.message);
    if (error instanceof CommunityError) {
      if (error.status === 404) throw missingBike();
      throw new ApiError("invalid_request", error.message);
    }
    throw error;
  }
}

/** The version of a bicycle's own fields: the text of `updated_at`. */
export const etagOfBike = (id: string, version: string) =>
  etagOf("bike", id, version);

/**
 * The version of a part: its fields themselves. A part has no time of change,
 * and a digest of what it holds changes exactly when an edit does.
 */
export const etagOfComponent = (row: ComponentRow) =>
  etagOf(
    "bike-component",
    row.id,
    JSON.stringify([
      row.section,
      row.category,
      row.name,
      row.notes,
      row.price,
      row.url,
      row.group_id,
      row.sort_order,
    ]),
  );

/** The bicycle as its owner reads it, and its version, read in `q`. */
async function bikeResponse(q: Queryable, owner: string, id: string) {
  // The version first: a change in between makes the next edit 412, never a
  // silent overwrite of something the client did not see.
  const version = await bikeVersionOf(q, id);
  const bike = await visibleBikeById(q, id, owner, await getSite(q));
  if (!bike || version === undefined) throw missingBike();
  return { body: toBike(bike), etag: etagOfBike(id, version) };
}

/** What the request holds, as the site's `bikeInput` wants it. */
function bikeInputOf(request: BikeRequest): BikeInput {
  return bikeInput.parse({
    name: request.name,
    brand: request.brand,
    model: request.model,
    trim: request.trim ?? "",
    year: request.year,
    category: compatibilityCategory(request.classification),
    classification: request.classification,
    description: request.description ?? "",
    color: request.color ?? "",
    size: request.size ?? "",
    weight: request.weight ?? null,
    mileage: request.mileage ?? 0,
    purposes: request.purposes ?? [],
    manufacturer_url: request.manufacturerUrl ?? "",
    price: request.price ?? null,
    show_bike_price: request.priceVisibility?.bike ?? false,
    show_component_prices: request.priceVisibility?.components ?? false,
    show_accessory_prices: request.priceVisibility?.accessories ?? false,
    is_former: request.isFormer ?? false,
    is_public: request.isPublic,
  });
}

/** The stored bicycle with what the request names changed, as `bikeInput`. */
function patchedBike(row: BikeRow, patch: BikePatchRequest): BikeInput {
  const classification = patch.classification ?? classificationOf(row);
  const visibility = patch.priceVisibility ?? {};
  return bikeInput.parse({
    name: patch.name ?? row.name,
    brand: patch.brand ?? row.brand,
    model: patch.model ?? row.model,
    trim: patch.trim ?? row.trim,
    year: patch.year ?? row.year,
    category: row.category,
    classification,
    description: patch.description ?? row.description,
    color: patch.color ?? row.color,
    size: patch.size ?? row.size,
    weight:
      patch.weight !== undefined
        ? patch.weight
        : row.weight === null
          ? null
          : Number(row.weight),
    mileage: patch.mileage ?? row.mileage,
    purposes: patch.purposes ?? row.purposes,
    manufacturer_url: patch.manufacturerUrl ?? row.manufacturer_url,
    price:
      patch.price !== undefined
        ? patch.price
        : row.price === null
          ? null
          : Number(row.price),
    show_bike_price: visibility.bike ?? row.show_bike_price,
    show_component_prices: visibility.components ?? row.show_component_prices,
    show_accessory_prices: visibility.accessories ?? row.show_accessory_prices,
    is_former: patch.isFormer ?? row.is_former === true,
    is_public: patch.isPublic ?? row.is_public,
  });
}

function componentInputOf(request: BikeComponentRequest): ComponentInput {
  return componentInput.parse({
    section: request.section,
    category: request.category,
    name: request.name,
    notes: request.notes ?? "",
    price: request.price ?? null,
    url: request.url ?? "",
    group_id: request.groupId ?? "",
  });
}

function patchedComponent(
  row: ComponentRow,
  patch: BikeComponentPatchRequest,
): ComponentInput {
  return componentInput.parse({
    section: patch.section ?? row.section,
    category: patch.category ?? row.category,
    name: patch.name ?? row.name,
    notes: patch.notes ?? row.notes,
    price:
      patch.price !== undefined
        ? patch.price
        : row.price === null
          ? null
          : Number(row.price),
    url: patch.url ?? row.url,
    group_id: patch.groupId ?? row.group_id,
  });
}

const componentResponse = (row: ComponentRow) => ({
  body: toBikeComponent(row),
  etag: etagOfComponent(row),
});

/** POST /api/v1/bikes */
export function handleCreateBike(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    const request = await parseJsonBody(req, bikeRequestSchema, MAX_BODY);
    // Publishing needs a confirmed address, as on the site; a private bicycle
    // is a draft that anyone can keep.
    if (request.isPublic) requireVerifiedEmail(viewer);
    const input = await throughBikes(async () => bikeInputOf(request));
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key: idempotencyKey(req.headers),
        body: request,
        // The key is what makes a lost answer safe to ask again.
        required: true,
      },
      async (q) => {
        await limitedIn(q, "bike-create:" + viewer.id, limits.bikeCreates);
        const id = await throughBikes(() => insertBike(q, viewer.id, input));
        const { body, etag } = await bikeResponse(q, viewer.id, id);
        return { status: 201, body, headers: { ETag: etag } };
      },
    );
    return ok(response.body, response.status, {
      ...response.headers,
      ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
  });
}

/** PATCH /api/v1/bikes/{id} */
export function handlePatchBike(req: Request, { params }: BikeParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Велосипед не найден.");
    parseNoQuery(new URL(req.url));
    const patch = await parseJsonBody(req, bikePatchRequestSchema, MAX_BODY);
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    const { body, etag } = await transaction((q) =>
      throughBikes(async () => {
        const bike = await lockOwnBike(q, id, viewer.id);
        if (!bike) throw missingBike();
        // The version this edit applies to, under the bicycle's lock: a second
        // device that edited first makes this one 412, not a silent overwrite.
        checkIfMatch(req.headers, etagOfBike(id, bike.version));
        if (Object.keys(patch).length > 0) {
          const merged = patchedBike(bike, patch);
          if (merged.is_public) requireVerifiedEmail(viewer);
          await validatePurposes(q, merged.purposes, bike.purposes);
          // Updating this row serializes with the FOR UPDATE guard in ride writes.
          await updateBikeRow(q, id, viewer.id, merged);
          // Withdrawing rotates the public link, so an old one stays dead.
          if (merged.is_public !== bike.is_public)
            await setBikeSharing(q, id, merged.is_public);
        }
        return bikeResponse(q, viewer.id, id);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** DELETE /api/v1/bikes/{id} */
export function handleDeleteBike(req: Request, { params }: BikeParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Велосипед не найден.");
    parseNoQuery(new URL(req.url));
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    if (!(await ownedBike(db, id, viewer.id))) throw missingBike();
    if (!(await removeBike(db, id, viewer.id, uploadsDirectory())))
      throw new ApiError(
        "conflict",
        "У велосипеда есть покатушки. Сначала удалите их или перенесите на другой велосипед.",
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

/** POST /api/v1/bikes/{id}/components */
export function handleCreateBikeComponent(
  req: Request,
  { params }: BikeParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Велосипед не найден.");
    parseNoQuery(new URL(req.url));
    const request = await parseJsonBody(req, bikeComponentRequestSchema, 4096);
    const input = await throughBikes(async () => componentInputOf(request));
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key: idempotencyKey(req.headers),
        body: request,
        required: true,
      },
      async (q) => {
        await limitedIn(q, "bike-write:" + viewer.id, limits.bikeWrites);
        const bike = await lockOwnBike(q, id, viewer.id);
        if (!bike) throw missingBike();
        // New data on a bicycle that is public is a public write, as on the site.
        if (bike.is_public) requireVerifiedEmail(viewer);
        const componentId = await addComponentRow(q, id, input);
        const row = await componentRowOf(q, id, componentId);
        if (!row) throw missingComponent();
        const { body, etag } = componentResponse(row);
        return { status: 201, body, headers: { ETag: etag } };
      },
    );
    return ok(response.body, response.status, {
      ...response.headers,
      ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
  });
}

/** PATCH /api/v1/bikes/{id}/components/{componentId} */
export function handlePatchBikeComponent(
  req: Request,
  { params }: ComponentParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const { id: rawId, componentId: rawComponent } = await params;
    const id = idOf(rawId, "Велосипед не найден.");
    const componentId = idOf(rawComponent, "Компонент не найден.");
    parseNoQuery(new URL(req.url));
    const patch = await parseJsonBody(
      req,
      bikeComponentPatchRequestSchema,
      4096,
    );
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    const { body, etag } = await transaction((q) =>
      throughBikes(async () => {
        const bike = await lockOwnBike(q, id, viewer.id);
        if (!bike) throw missingBike();
        const row = await componentRowOf(q, id, componentId);
        if (!row) throw missingComponent();
        // A part's version comes with the answer that created or changed it; a
        // client that has none yet may edit without it.
        checkIfMatch(req.headers, etagOfComponent(row), { required: false });
        if (bike.is_public) requireVerifiedEmail(viewer);
        if (Object.keys(patch).length === 0) return componentResponse(row);
        await updateComponentRow(
          q,
          id,
          componentId,
          patchedComponent(row, patch),
        );
        const saved = await componentRowOf(q, id, componentId);
        if (!saved) throw missingComponent();
        return componentResponse(saved);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** DELETE /api/v1/bikes/{id}/components/{componentId} */
export function handleDeleteBikeComponent(
  req: Request,
  { params }: ComponentParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const { id: rawId, componentId: rawComponent } = await params;
    const id = idOf(rawId, "Велосипед не найден.");
    const componentId = idOf(rawComponent, "Компонент не найден.");
    parseNoQuery(new URL(req.url));
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    await transaction(async (q) => {
      if (!(await lockOwnBike(q, id, viewer.id))) throw missingBike();
      // Gone already is as good as removed now: a repeat is 204 too.
      await deleteComponentRow(q, id, componentId);
    });
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** PUT /api/v1/bikes/{id}/group-order */
export function handleBikeGroupOrder(req: Request, { params }: BikeParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Велосипед не найден.");
    parseNoQuery(new URL(req.url));
    const { groups } = await parseJsonBody(
      req,
      bikeGroupOrderRequestSchema,
      4096,
    );
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    const { body, etag } = await transaction((q) =>
      throughBikes(async () => {
        const bike = await lockOwnBike(q, id, viewer.id);
        if (!bike) throw missingBike();
        if (bike.is_public) requireVerifiedEmail(viewer);
        await setGroupOrder(q, id, groups);
        return bikeResponse(q, viewer.id, id);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}
