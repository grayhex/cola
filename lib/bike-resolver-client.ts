import type { TraceEvent as TraceEventType } from "./resolver-stream.ts";
import type { BikeQuery as BikeQueryType } from "../services/bike-resolver/src/domain";
import type { ResolveResult as ResolveResultType } from "../services/bike-resolver/src/domain";
import { z } from "zod";
import { readResolverStream, safeTrace } from "./resolver-stream.ts";
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

const incomplete = (result: z.infer<typeof resultSchema>) => {
  const source =
    result.source !== null && typeof result.source === "object"
      ? (result.source as Record<string, unknown>)
      : {};
  const bike =
    result.bike !== null && typeof result.bike === "object"
      ? (result.bike as Record<string, unknown>)
      : {};
  return (
    result.status === "resolved" &&
    (!Array.isArray(result.components) || !source.url || !bike.canonicalName)
  );
};
/** Single transport boundary for the optional factory-spec enrichment service. */
export const bikeResolverClient = {
  async *stream(
    query: unknown,
    signal: AbortSignal,
  ): AsyncGenerator<
    | TraceEventType
    | { type: "result"; result: ResolveResult & { previewId?: string } }
  > {
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
        yield { type: "result", result: result as ResolveResult };
        return;
      }
      const event = safeTrace(value);
      if (event) yield event;
    }
    throw new Error("Incomplete resolver response");
  },
  async request(path: string, method = "GET", body: unknown = undefined) {
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

  async resolve(query: BikeQuery): Promise<ResolveResult> {
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
      return /** @type {ResolveResult} */ result as ResolveResult;
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

export type BikeQuery = BikeQueryType;
export type ResolveResult = ResolveResultType;
