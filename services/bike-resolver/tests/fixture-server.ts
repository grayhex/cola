// Disposable HTTP test server. Real resolver/parser, captured Giant document, no internet.
import { readFileSync } from "node:fs";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { Resolver } from "../src/resolver.js";
import { MemoryCache } from "../src/cache.js";
import { SettingsStore } from "../src/settings.js";
import { createAdapters } from "../src/adapters/index.js";
import { ResolverError } from "../src/domain.js";
import { abortable, resolutionContext, trace } from "../src/context.js";
import type { ManufacturerHttpClient } from "../src/http.js";
import { commonsFixture } from "./fixtures/component-photos.js";
// Recorded store pages and sitemaps (see fixtures/stores/manifest.json).
const storeDir = new URL("./fixtures/stores/", import.meta.url);
const storeManifest: {
  id: string;
  store: string;
  kind: string;
  url: string;
  requestedUrl: string;
  rawSha256: string;
  retrievedAt: string;
}[] = JSON.parse(readFileSync(new URL("manifest.json", storeDir), "utf8"));
const productId = (u: string) => u.match(/\/(\d{5,12})\/p$/)?.[1];
// Recorded pages of the Reddit 10 benchmark (fixtures/reddit10/pages.json): the
// official sites of Canyon and Giant answer from them, so the app can be tested
// on the real pages of those flows. Stores refusing and the search engine being
// down stay as they are below.
const redditDir = new URL("./fixtures/reddit10/", import.meta.url);
const redditPages: {
  id: string;
  adapter: string;
  requestedUrl: string;
  url: string;
  rawSha256: string;
  retrievedAt: string;
}[] = JSON.parse(readFileSync(new URL("pages.json", redditDir), "utf8"));
const sameUrl = (a: string, b: string) => {
  const [x, y] = [new URL(a), new URL(b)];
  x.searchParams.sort();
  y.searchParams.sort();
  return x.href === y.href;
};
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
      "iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAIAAAD9V4nPAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAF9klEQVR4nO3VMQEAAAiAMPuX1hgebAn4mAWAsPkOAIBPRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECkGaEAKQZIQBpRghAmhECsGUHVjInr8qb2A0AAAAASUVORK5CYII=",
      "base64",
    ),
    contentType: "image/png",
  }),
  get: async (url: string) => {
    if (new URL(url).hostname === "commons.wikimedia.org") {
      const query = new URL(url).searchParams.get("gsrsearch") || "";
      if (query.includes("UpstreamError"))
        throw new Error("Fixture upstream failure");
      const data = query.includes("NoPhotos") ? {} : commonsFixture();
      return {
        url,
        hash: "commons-fixture",
        fetchedAt: source.retrievedAt,
        body: JSON.stringify(data),
      };
    }
    const host = new URL(url).hostname;
    if (host === "www.tradeinn.com") {
      const recorded = storeManifest.find((e) =>
        e.kind === "sitemap"
          ? e.requestedUrl === url
          : e.store === "bikeinn" &&
            !!productId(url) &&
            productId(e.url) === productId(url),
      );
      if (!recorded)
        throw new ResolverError(
          "upstream_unavailable",
          "Unrecorded store page",
          false,
          "http_404",
        );
      return {
        url: recorded.url,
        hash: recorded.rawSha256,
        fetchedAt: recorded.retrievedAt,
        body: readFileSync(
          new URL(
            recorded.id + (recorded.kind === "sitemap" ? ".xml" : ".html"),
            storeDir,
          ),
          "utf8",
        ),
      };
    }
    // One store refuses automated requests and the search engine is down: the
    // integration tests check that the recorded store still answers.
    if (host === "www.velosklad.ru")
      throw new ResolverError(
        "upstream_unavailable",
        "Fixture store refuses automated requests",
        false,
        "http_403",
      );
    if (host === "www.bing.com")
      throw new ResolverError(
        "upstream_unavailable",
        "Fixture search outage",
        true,
        "timeout",
      );
    if (url === "https://www.velo-port.ru/slow-bike") {
      trace("document_fetch_started", { host: "www.velo-port.ru" });
      await abortable(
        new Promise((r) => setTimeout(r, 5000)),
        resolutionContext.getStore()?.signal,
      );
      throw new ResolverError(
        "upstream_unavailable",
        "Fixture timeout",
        true,
        "timeout",
      );
    }
    if (url === "https://www.velo-port.ru/test-bike")
      return {
        url,
        hash: "manual",
        fetchedAt: source.retrievedAt,
        body: `<h1>Giant Tourer GTS</h1><meta property="og:image" content="https://images.example.test/bike.png"><table><tr><td>Рама</td><td>Giant AluxX</td></tr><tr><td>Вилка</td><td>SR Suntour</td></tr><tr><td>Тормоза</td><td>Shimano BR-MT400</td></tr></table>`,
      };
    const redditPage = ["canyon", "giant"].includes(
      redditPages.find((p) => sameUrl(p.requestedUrl, url))?.adapter ?? "",
    )
      ? redditPages.find((p) => sameUrl(p.requestedUrl, url))
      : undefined;
    if (redditPage)
      return {
        url: redditPage.url,
        hash: redditPage.rawSha256,
        fetchedAt: redditPage.retrievedAt,
        body: readFileSync(
          new URL(
            redditPage.id + (/sitemap/.test(redditPage.id) ? ".xml" : ".html"),
            redditDir,
          ),
          "utf8",
        ),
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
