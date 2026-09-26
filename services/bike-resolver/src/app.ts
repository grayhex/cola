import { findCandidates } from "./candidates.js";
import { PassThrough } from "node:stream";
import { SourcePlanner, Diagnostics, type SourceProvider } from "./planner.js";
import { withResolution, trace, EXTRACTOR_VERSION } from "./context.js";
import type { ResolveResult } from "./domain.js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import pino from "pino";
import { ManualSources } from "./manual.js";
import { RetailerSearch } from "./retailer-search.js";
import { ManufacturerHttpClient } from "./http.js";
import { querySchema } from "./domain.js";
import { buildVersion } from "./version.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { requestSchema } from "./domain.js";
import type { Resolver } from "./resolver.js";
import type { Cache } from "./cache.js";
import { SettingsStore, adapterSupport, settingsSchema } from "./settings.js";
import { normalize } from "./normalize.js";
export function buildApp(
  resolver: Resolver,
  cache: Cache,
  settings?: SettingsStore,
  sourceClient?: ManufacturerHttpClient,
) {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization"] },
    bodyLimit: 8192,
    requestTimeout: 120000,
  });
  app.addHook("onRequest", async (req, reply) => {
    const secret = process.env.BIKE_RESOLVER_TOKEN;
    if (!secret || !req.routeOptions.url?.startsWith("/internal/")) return;
    const supplied = req.headers.authorization || "",
      expected = "Bearer " + secret;
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return reply.code(401).send({ error: "unauthorized" });
  });
  const store = settings ?? new SettingsStore();
  const http =
    sourceClient ??
    new ManufacturerHttpClient(pino(), 700, 10000, () => store.value);
  const manual = new ManualSources(http, resolver.adapters, store);
  const retailers = new RetailerSearch(http, manual, store);
  const planner = new SourcePlanner(),
    diagnostics = new Diagnostics();
  const combined = requestSchema.extend({
    chooseCandidates: z.boolean().optional(),
    sourceUrl: z.string().url().max(2048).optional(),
  });
  async function execute(
    input: z.infer<typeof combined>,
    id: string,
    manualOnly = false,
  ): Promise<ResolveResult> {
    trace("resolve_started");
    const { sourceUrl, chooseCandidates, ...request } = input;
    const { candidateId, ...identity } = request;
    const query = querySchema.parse(identity);
    if (chooseCandidates && !sourceUrl && !candidateId && store.value.enabled) {
      const result = await findCandidates(
        query,
        resolver.adapters,
        http,
        manual,
        store,
      );
      trace("completed");
      return result;
    }
    const adapter = resolver.adapters.find((a) =>
      [a.brand, ...a.aliases].some(
        (b) => normalize(b) === normalize(query.brand),
      ),
    );
    const providers: SourceProvider[] = [];
    if (store.value.enabled) {
      if (
        !(manualOnly && sourceUrl) &&
        (!adapter || store.value.adapters[adapter.id])
      )
        providers.push({
          id: adapter?.id || "generic",
          kind: "manufacturer",
          resolve: () => resolver.resolve(request, id),
        });
      // A supplied fallback is tried after official discovery; explicit URL actions skip discovery.
      if (sourceUrl)
        providers.push({
          id: "manual-url",
          kind: "manual",
          resolve: () =>
            manual.resolve(query, sourceUrl) as Promise<ResolveResult>,
        });
      if (!sourceUrl && !candidateId && store.value.retailerSearch)
        providers.push({
          id: "retailer-search",
          kind: "retailer",
          resolve: () => retailers.resolve(query),
        });
    }
    const result = await planner.resolve(
      query,
      providers.map((provider) => ({
        ...provider,
        resolve: async () => {
          const start = Date.now();
          const value = await provider.resolve();
          diagnostics.record(provider.id, value, Date.now() - start);
          return value;
        },
      })),
    );
    trace(
      result.status === "resolved"
        ? result.quality?.level === "partial"
          ? "partial"
          : "resolved"
        : "failed",
    );
    trace("completed");
    return result;
  }
  app.get("/internal/diagnostics", async () => ({
    extractorVersion: EXTRACTOR_VERSION,
    since: "process-start",
    sources: diagnostics.snapshot(),
  }));
  app.post("/v1/resolve/stream", async (req, reply) => {
    const input = combined.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: "invalid_input" });
    const controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    const output = new PassThrough({ highWaterMark: 65536 });
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    req.raw.on("aborted", () => controller.abort());
    reply
      .header("Content-Type", "application/x-ndjson; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Accel-Buffering", "no");
    void withResolution(
      signal,
      (event) => {
        if (!output.destroyed) output.write(JSON.stringify(event) + "\n");
      },
      () => execute(input.data, req.id, true),
    )
      .then((result) => {
        if (!signal.aborted && !output.destroyed)
          output.end(JSON.stringify({ type: "result", result }) + "\n");
        else output.destroy();
      })
      .catch(() => {
        if (!output.destroyed && !controller.signal.aborted)
          output.end(
            JSON.stringify({
              type: "result",
              result: {
                status: "upstream_unavailable",
                query: {
                  brand: input.data.brand,
                  model: input.data.model,
                  trim: input.data.trim,
                  year: input.data.year,
                },
                brand: input.data.brand,
                cached: false,
                retryable: true,
                reason: signal.aborted ? "timeout" : "connection_failed",
              },
            }) + "\n",
          );
        else output.destroy();
      });
    return reply.send(output);
  });
  app.get("/version", async () => buildVersion);
  app.post("/v1/resolve-url", async (req, reply) => {
    const data = querySchema
      .extend({ sourceUrl: z.string().url().max(2048) })
      .safeParse(req.body);
    if (!data.success) return reply.code(400).send({ error: "invalid_input" });
    const { sourceUrl, ...query } = data.data;
    return withResolution(AbortSignal.timeout(90000), undefined, () =>
      execute({ ...query, sourceUrl }, req.id, true),
    );
  });
  app.post("/v1/photos/search", async (req, reply) => {
    const data = querySchema
      .extend({ sourceUrl: z.string().url().max(2048).optional() })
      .safeParse(req.body);
    if (!data.success) return reply.code(400).send({ error: "invalid_input" });
    const { sourceUrl, ...query } = data.data;
    try {
      return await manual.search(query, sourceUrl);
    } catch {
      return reply.code(503).send({ error: "Источник фотографий недоступен" });
    }
  });
  app.get("/v1/photos/:id", async (req, reply) => {
    const id = z
      .string()
      .uuid()
      .safeParse((req.params as any).id);
    if (!id.success) return reply.code(400).send({ error: "invalid_input" });
    try {
      return await manual.photo(id.data);
    } catch {
      return reply
        .code(503)
        .send({ error: "Изображение недоступно. Повторите поиск." });
    }
  });
  const brands = () =>
    resolver.adapters.map((a) => ({
      id: a.id,
      name: a.brand,
      enabled: store.value.enabled && !!store.value.adapters[a.id],
      adapterVersion: a.adapterVersion,
      limitation: adapterSupport[a.id as keyof typeof adapterSupport] || null,
    }));
  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_req, reply) => {
    try {
      await cache.ready();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  app.get("/v1/brands", async () => ({
    brands: brands(),
    autoResolve: store.value.enabled && store.value.autoResolve,
  }));
  // Internal management API: never publish this container's port; app gateway authenticates administrators.
  app.register(rateLimit, { global: false });
  // Register after the plugin so its onRoute hook protects database reads.
  // One process-wide budget for this endpoint, independent of proxy headers/IPs.
  app.after((err) => {
    if (err) throw err;
    app.get(
      "/internal/settings",
      {
        // This JSON API supports GET only; an automatic HEAD would get a
        // separate rate-limit bucket while still executing the DB read.
        exposeHeadRoute: false,
        config: {
          rateLimit: {
            max: 60,
            timeWindow: "1 minute",
            keyGenerator: () => "internal-settings",
          },
        },
      },
      async () => {
        await store.load();
        return { value: store.value, version: store.version, brands: brands() };
      },
    );
  });
  app.put("/internal/settings", async (req, reply) => {
    const input = req.body as { value?: unknown; version?: number };
    const parsed = settingsSchema.safeParse(input?.value);
    if (!parsed.success || !Number.isInteger(input?.version))
      return reply.code(400).send({ error: "Invalid settings" });
    if (!(await store.save(parsed.data, input.version!)))
      return reply
        .code(409)
        .send({ error: "Settings changed; reload before saving" });
    return { value: store.value, version: store.version, brands: brands() };
  });
  app.delete("/internal/cache", async (req, reply) => {
    const { adapter } = req.query as { adapter?: string };
    if (adapter && !resolver.adapters.some((a) => a.id === adapter))
      return reply.code(400).send({ error: "Unknown adapter" });
    await cache.clear?.(adapter);
    return { ok: true };
  });
  app.post("/v1/resolve", async (req, reply) => {
    const input = combined.safeParse(req.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: input.error.issues });
    const a = resolver.adapters.find((a) =>
      [a.brand, ...a.aliases].some(
        (b) => normalize(b) === normalize(input.data.brand),
      ),
    );
    if (
      !store.value.enabled ||
      (a && !store.value.adapters[a.id] && !input.data.sourceUrl)
    )
      return {
        status: "unsupported_brand",
        query: input.data,
        brand: input.data.brand,
        cached: false,
        retryable: false,
      };
    return withResolution(AbortSignal.timeout(90000), undefined, () =>
      execute(input.data, req.id),
    );
  });
  return app;
}
