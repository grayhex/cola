// Disposable HTTP test server. Real resolver/parser, captured Giant document, no internet.
import { readFileSync } from "node:fs";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { Resolver } from "../src/resolver.js";
import { MemoryCache } from "../src/cache.js";
import { SettingsStore } from "../src/settings.js";
import { createAdapters } from "../src/adapters/index.js";
import { ResolverError } from "../src/domain.js";
import type { ManufacturerHttpClient } from "../src/http.js";
const source = JSON.parse(
  readFileSync(
    new URL("./fixtures/giant/source.json", import.meta.url),
    "utf8",
  ),
);
const body = readFileSync(
  new URL("./fixtures/giant/product.html", import.meta.url),
  "utf8",
);
const transport = {
  get: async (url: string) => {
    if (url !== source.url)
      throw new ResolverError("upstream_unavailable", "Fixture only");
    await new Promise((r) => setTimeout(r, 1200));
    return { body, url, hash: "fixture", fetchedAt: source.retrievedAt };
  },
} as ManufacturerHttpClient;
const cache = new MemoryCache();
const app = buildApp(
  new Resolver(createAdapters(transport), cache, pino({ level: "silent" })),
  cache,
  new SettingsStore(),
);
await app.listen({ host: "127.0.0.1", port: 8081 });
