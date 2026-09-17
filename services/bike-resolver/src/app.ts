import { z } from "zod";
import pino from "pino";
import { ManualSources } from "./manual.js";
import { ManufacturerHttpClient } from "./http.js";
import { querySchema } from "./domain.js";
import { buildVersion } from "./version.js";
import Fastify from "fastify";
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
    logger: true,
    bodyLimit: 8192,
    requestTimeout: 120000,
  });
  const store = settings ?? new SettingsStore();
  const manual = new ManualSources(
    sourceClient ??
      new ManufacturerHttpClient(pino(), 700, 10000, () => store.value),
    resolver.adapters,
    store,
  );
  app.get("/version", async () => buildVersion);
  app.post("/v1/resolve-url", async (req, reply) => {
    const data = querySchema
      .extend({ sourceUrl: z.string().url().max(2048) })
      .safeParse(req.body);
    if (!data.success) return reply.code(400).send({ error: "invalid_input" });
    const { sourceUrl, ...query } = data.data;
    return manual.resolve(query, sourceUrl);
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
  app.get("/internal/settings", async () => {
    await store.load();
    return { value: store.value, version: store.version, brands: brands() };
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
    const input = requestSchema.safeParse(req.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: input.error.issues });
    const a = resolver.adapters.find((a) =>
      [a.brand, ...a.aliases].some(
        (b) => normalize(b) === normalize(input.data.brand),
      ),
    );
    if (!store.value.enabled || (a && !store.value.adapters[a.id]))
      return {
        status: "unsupported_brand",
        query: input.data,
        brand: input.data.brand,
        cached: false,
        retryable: false,
      };
    return resolver.resolve(input.data, req.id);
  });
  return app;
}
