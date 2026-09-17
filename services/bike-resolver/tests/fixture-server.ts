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
  getBytes: async () => ({
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFZkAAAAASUVORK5CYII=",
      "base64",
    ),
    contentType: "image/png",
  }),
  get: async (url: string) => {
    if (url === "https://www.velo-port.ru/test-bike")
      return {
        url,
        hash: "manual",
        fetchedAt: source.retrievedAt,
        body: `<h1>Giant Tourer GTS</h1><meta property="og:image" content="https://images.example.test/bike.png"><table><tr><td>Рама</td><td>Giant AluxX</td></tr><tr><td>Вилка</td><td>SR Suntour</td></tr><tr><td>Тормоза</td><td>Shimano BR-MT400</td></tr></table>`,
      };
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
  transport,
);
await app.listen({ host: "127.0.0.1", port: 8081 });
