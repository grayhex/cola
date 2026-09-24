import { z } from "zod";
import { readResolverStream, safeTrace } from "./resolver-stream.js";
export const resolverQuery = z
  .object({
    brand: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(100),
    trim: z.string().trim().max(100).nullable().default(null),
    year: z.number().int().min(1900).max(2100).nullable().default(null),
    sourceUrl: z.string().url().max(2048).optional(),
    chooseCandidates: z.boolean().optional(),
    candidateId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
/** @typedef {import('../services/bike-resolver/src/domain').BikeQuery} BikeQuery */
/** @typedef {import('../services/bike-resolver/src/domain').ResolveResult} ResolveResult */
const resultSchema = z
  .object({
    status: z.enum([
      "resolved",
      "ambiguous",
      "not_found",
      "unsupported_brand",
      "upstream_unavailable",
      "parse_error",
    ]),
    query: resolverQuery,
    cached: z.boolean(),
  })
  .passthrough();
// A resolved bike needs its components, source page and name; other fields pass through.
/** @param {Record<string, any>} result */
const incomplete = (result) =>
  result.status === "resolved" &&
  (!Array.isArray(result.components) ||
    !result.source?.url ||
    !result.bike?.canonicalName);
/** Single transport boundary for the optional factory-spec enrichment service. */
export const bikeResolverClient = {
  async *stream(query, signal) {
    const input = resolverQuery.parse(query);
    if (!process.env.BIKE_RESOLVER_URL) throw new Error("Сервис не настроен");
    const response = await fetch(
      new URL("/v1/resolve/stream", process.env.BIKE_RESOLVER_URL),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Сервис недоступен");
    for await (const value of readResolverStream(response.body)) {
      if (value.type === "result") {
        const result = resultSchema.parse(value.result);
        if (incomplete(result)) throw new Error("Invalid resolver result");
        yield { type: "result", result };
        return;
      }
      const event = safeTrace(value);
      if (event) yield event;
    }
    throw new Error("Incomplete resolver response");
  },
  async request(path, method = "GET", body) {
    if (!process.env.BIKE_RESOLVER_URL) throw new Error("Сервис не настроен");
    const response = await fetch(new URL(path, process.env.BIKE_RESOLVER_URL), {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(path.startsWith("/internal/") && process.env.BIKE_RESOLVER_TOKEN
          ? { Authorization: "Bearer " + process.env.BIKE_RESOLVER_TOKEN }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path.startsWith("/v1/") ? 90000 : 8000),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(data.error || "Сервис недоступен"), {
        status: response.status,
      });
    }
    return data;
  },
  /** @param {BikeQuery} query @returns {Promise<ResolveResult>} */
  async resolve(query) {
    const input = resolverQuery.parse(query);
    try {
      const result = resultSchema.parse(
        await this.request(
          input.sourceUrl ? "/v1/resolve-url" : "/v1/resolve",
          "POST",
          input,
        ),
      );
      if (incomplete(result)) throw new Error("Invalid resolver result");
      return /** @type {ResolveResult} */ (result);
    } catch {
      return {
        status: "upstream_unavailable",
        query: input,
        brand: input.brand,
        retryable: true,
        cached: false,
      };
    }
  },
};
