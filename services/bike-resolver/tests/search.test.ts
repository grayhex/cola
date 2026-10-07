import { it, expect, vi, describe } from "vitest";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { SettingsStore } from "../src/settings.js";
import { CandidateRegistry, candidateIdOf } from "../src/candidate-registry.js";
import { SourceSearch } from "../src/search.js";
import { ManualSources } from "../src/manual.js";
import { parseDocument } from "../src/extract.js";
import { ResolverError, type BikeManufacturerAdapter } from "../src/domain.js";
import {
  abortable,
  resolutionContext,
  withResolution,
} from "../src/context.js";
import type { ManufacturerHttpClient } from "../src/http.js";
import type { RetailStore } from "../src/stores/types.js";

const logger = pino({ level: "silent" });
const table = (drive = "Shimano 105") =>
  `<table><tr><td>Frame</td><td>Alloy</td></tr><tr><td>Fork</td><td>Carbon</td></tr><tr><td>Rear Derailleur</td><td>${drive}</td></tr><tr><td>Saddle</td><td>Fizik</td></tr></table>`;
const page = (name: string, drive?: string) =>
  `<h1>${name}</h1><meta property="og:image" content="https://img.example.test/b.png">${table(drive)}`;
function fakeStore(
  id: string,
  options: {
    discover?: RetailStore["discover"];
    search?: boolean;
  } = {},
): RetailStore {
  const host = `www.${id}.test`;
  return {
    id,
    name: id.toUpperCase(),
    allowedDomains: [host],
    storeVersion: 1,
    search: options.search ?? true,
    owns: (u) => u.hostname === host,
    productKey: (u) => /^\/p\/(\d+)/.exec(u.pathname)?.[1] ?? null,
    fetchUrl: (u) => u,
    discover: options.discover,
    parse: (doc) => parseDocument(doc),
  };
}
const hang = () =>
  abortable(
    new Promise<string[]>(() => {}),
    resolutionContext.getStore()?.signal,
  );
const refuse = (reason: "http_403" | "access_challenge") => async () => {
  throw new ResolverError("upstream_unavailable", "Refused", false, reason);
};
// A recorded page the site refused to serve.
const REFUSED = "\u0000refused";
function fakeHttp(pages: Record<string, string>) {
  const calls: string[] = [];
  const http = {
    get: vi.fn(async (url: string) => {
      calls.push(url);
      if (pages[url] === REFUSED)
        throw new ResolverError(
          "upstream_unavailable",
          "Refused",
          false,
          "http_403",
        );
      // A search engine that answers with no results: web discovery is not under test.
      if (url.includes("bing.com/search") && !(url in pages))
        return {
          url,
          body: "<rss><channel></channel></rss>",
          hash: "h",
          fetchedAt: "t",
        };
      if (!(url in pages))
        throw new ResolverError(
          "upstream_unavailable",
          "Not recorded",
          false,
          "http_404",
        );
      return {
        url,
        body: pages[url],
        hash: "h",
        fetchedAt: "2026-10-07T00:00:00Z",
      };
    }),
  } as unknown as ManufacturerHttpClient;
  return { http, calls };
}
function setup(
  stores: RetailStore[],
  pages: Record<string, string>,
  mutate: (s: SettingsStore) => void = () => {},
  limits = {},
) {
  const { http, calls } = fakeHttp(pages);
  const settings = new SettingsStore();
  // Web discovery would reach for a search engine; these tests are about stores.
  settings.value.stores = {
    ...settings.value.stores,
    ...Object.fromEntries(stores.map((s) => [s.id, true])),
  } as typeof settings.value.stores;
  mutate(settings);
  const registry = new CandidateRegistry();
  const search = new SourceSearch({
    adapters: [],
    http,
    manual: new ManualSources(http, [], settings, stores),
    settings,
    stores,
    registry,
    limits: { storeMs: 400, webMs: 400, pageMs: 400, ...limits },
  });
  return { search, registry, http, calls, settings };
}
const query = { brand: "Zed", model: "Gravel", trim: null, year: 2024 };
const run = <T>(
  work: () => Promise<T>,
  signal = new AbortController().signal,
) => withResolution(signal, undefined, work);

describe("independent sources", () => {
  it("shows variants from several stores at once; a slow or refusing store hides nothing", async () => {
    const a = "https://www.alpha.test/p/1",
      a2 = "https://www.alpha.test/p/2";
    const stores = [
      fakeStore("alpha", { discover: async () => [a, a2] }),
      fakeStore("beta", { discover: hang }),
      fakeStore("gamma", { discover: refuse("http_403") }),
      fakeStore("delta", { discover: refuse("access_challenge") }),
    ];
    const { search } = setup(
      stores,
      {
        [a]: page("Zed Gravel 2024", "Shimano GRX"),
        [a2]: page("Zed Gravel 2024 Di2", "Shimano GRX Di2"),
      },
      (s) => {
        s.value.retailerSearch = true;
      },
      { storeMs: 80 },
    );
    const started = Date.now();
    const result = await run(() => search.stores(query));
    // The hanging store is cut at its own budget; the others are not waiting for it.
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates.map((c) => c.canonicalName)).toEqual(
      expect.arrayContaining(["Zed Gravel 2024", "Zed Gravel 2024 Di2"]),
    );
    expect(
      result.candidates.every(
        (c) => c.kind === "store" && c.storeId === "alpha",
      ),
    ).toBe(true);
    expect(result.candidates.map((c) => c.drivetrain)).toEqual(
      expect.arrayContaining(["Shimano GRX", "Shimano GRX Di2"]),
    );
    const sources = Object.fromEntries(
      result.search!.sources.map((s) => [s.id, s]),
    );
    expect(sources.alpha).toMatchObject({
      status: "ok",
      candidates: 2,
      pages: 2,
    });
    expect(sources.beta).toMatchObject({ status: "timeout" });
    expect(sources.gamma).toMatchObject({
      status: "blocked",
      reason: "http_403",
    });
    expect(sources.delta).toMatchObject({
      status: "blocked",
      reason: "access_challenge",
    });
    // Four registered stores and the search engine were all accounted for.
    expect(result.search!.sources.map((s) => s.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "web",
    ]);
    // A limited search is never called complete.
    expect(result.search!.complete).toBe(false);
  });

  it("reports blocked sources instead of an empty answer when nothing was found", async () => {
    const { search } = setup(
      [fakeStore("gamma", { discover: refuse("http_403") })],
      {},
    );
    const result = await run(() => search.stores(query));
    expect(result.status).toBe("upstream_unavailable");
    if (result.status === "ambiguous" || result.status === "resolved") return;
    expect(result.retryable).toBe(true);
    expect(result.reason).toBe("http_403");
    expect(result.search?.sources.find((s) => s.id === "gamma")?.status).toBe(
      "blocked",
    );
  });

  it("says «not found» only when every source answered", async () => {
    const { search } = setup(
      [fakeStore("alpha", { discover: async () => [] })],
      {},
    );
    const result = await run(() => search.stores(query));
    expect(result.status).toBe("not_found");
  });

  it("never calls a source empty when one of its pages did not answer", async () => {
    const refused = "https://www.alpha.test/p/50",
      foreign = "https://www.alpha.test/p/51";
    const { search } = setup(
      [fakeStore("alpha", { discover: async () => [refused, foreign] })],
      {
        [refused]: REFUSED,
        [foreign]: "<h1>Zed Gravel 2024</h1><p>No specification published</p>",
      },
    );
    const result = await run(() => search.stores(query));
    // The other page was merely unreadable; the refused one might have been it.
    expect(result.status).toBe("upstream_unavailable");
    if (result.status === "ambiguous" || result.status === "resolved") return;
    expect(result.retryable).toBe(true);
    expect(result.search?.sources.find((s) => s.id === "alpha")).toMatchObject({
      status: "blocked",
      reason: "http_403",
    });
  });

  it("lists a store without search or with its flag off, and never asks it for anything", async () => {
    const discover = vi.fn(async () => ["https://www.off.test/p/9"]);
    const { search } = setup(
      [fakeStore("off", { discover }), fakeStore("passive", { search: false })],
      {},
      (s) => {
        s.value.stores = {
          ...s.value.stores,
          off: false,
        } as typeof s.value.stores;
      },
    );
    const result = await run(() => search.stores(query));
    expect(discover).not.toHaveBeenCalled();
    const sources = Object.fromEntries(
      result.search!.sources.map((s) => [s.id, s.status]),
    );
    expect(sources).toMatchObject({ off: "disabled", passive: "skipped" });
  });

  it("keeps different years, drivetrains and generations as different choices, ranked by the requested year", async () => {
    const urls = [
      "https://www.alpha.test/p/10",
      "https://www.alpha.test/p/11",
      "https://www.alpha.test/p/12",
    ];
    const { search } = setup(
      [fakeStore("alpha", { discover: async () => urls })],
      {
        [urls[0]]: page("Zed Gravel 2025", "Shimano GRX 820"),
        [urls[1]]: page("Zed Gravel 2024", "SRAM Rival AXS"),
        [urls[2]]: page("Zed Gravel 2024", "Shimano GRX 610"),
      },
    );
    const result = await run(() => search.stores(query));
    if (result.status !== "ambiguous") throw Error("expected choices");
    expect(result.candidates.map((c) => [c.year, c.drivetrain])).toEqual([
      [2024, "SRAM Rival AXS"],
      [2024, "Shimano GRX 610"],
      [2025, "Shimano GRX 820"],
    ]);
    const other = result.candidates[2];
    // The mismatch is shown, not hidden or "cured" with confidence.
    expect(other.warnings).toContain("identity_mismatch");
    expect(other.year).toBe(2025);
  });

  it("judges a chosen page against the query it is chosen for", async () => {
    const url = "https://www.alpha.test/p/20";
    const { search } = setup(
      [fakeStore("alpha", { discover: async () => [url] })],
      { [url]: page("Zed Gravel 2025") },
    );
    // Found for any year: no conflict is known yet.
    const offered = await run(() => search.stores({ ...query, year: null }));
    if (offered.status !== "ambiguous") throw Error("expected choices");
    expect(offered.candidates[0].warnings).toBeUndefined();
    // Chosen for a bike of 2024: the page says 2025, and that is said.
    const chosen = await run(() =>
      search.select(query, offered.candidates[0].candidateId!),
    );
    if (chosen?.status !== "resolved") throw Error("expected a specification");
    expect(chosen.warnings).toContain("identity_mismatch");
    expect(chosen.sourceYear).toBe(2025);
    expect(chosen.query.year).toBe(2024);
    // And for a bike of 2025 it is not.
    const same = await run(() =>
      search.select(
        { ...query, year: 2025 },
        offered.candidates[0].candidateId!,
      ),
    );
    if (same?.status !== "resolved") throw Error("expected a specification");
    expect(same.warnings).not.toContain("identity_mismatch");
  });

  it("merges localized pages of one product and keeps the other link", async () => {
    const en = "https://www.alpha.test/p/77/en",
      fr = "https://www.alpha.test/p/77/fr";
    const { search } = setup(
      [fakeStore("alpha", { discover: async () => [en, fr] })],
      {
        [en]: page("Zed Gravel 2024"),
        [fr]: page("Zed Gravel 2024"),
      },
    );
    const result = await run(() => search.stores(query));
    if (result.status !== "ambiguous") throw Error("expected choices");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].url).toBe(en);
    expect(result.candidates[0].alternatives).toEqual([
      { url: fr, sourceHost: "www.alpha.test" },
    ]);
  });

  it("bounds the pages it opens per store", async () => {
    const urls = Array.from(
      { length: 9 },
      (_, i) => `https://www.alpha.test/p/${100 + i}`,
    );
    const { search, calls } = setup(
      [fakeStore("alpha", { discover: async () => urls })],
      Object.fromEntries(urls.map((u, i) => [u, page("Zed Gravel 2024 " + i)])),
    );
    const result = await run(() => search.stores(query));
    // 12 pages are shared by the searchable stores, at most 4 each.
    expect(calls.filter((u) => u.includes("alpha.test"))).toHaveLength(4);
    expect(result.search!.sources.find((s) => s.id === "alpha")!.pages).toBe(4);
    expect(result.search!.complete).toBe(false);
  });

  it("stops opening pages as soon as the request is cancelled", async () => {
    const controller = new AbortController();
    const urls = Array.from(
      { length: 4 },
      (_, i) => `https://www.alpha.test/p/${200 + i}`,
    );
    const { search, http } = setup(
      [fakeStore("alpha", { discover: async () => urls })],
      Object.fromEntries(urls.map((u) => [u, page("Zed Gravel 2024")])),
    );
    (http.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        controller.abort();
        return {
          url,
          body: page("Zed Gravel 2024"),
          hash: "h",
          fetchedAt: "t",
        };
      },
    );
    await expect(
      run(() => search.stores(query), controller.signal),
    ).rejects.toBeDefined();
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});

describe("a chosen candidate is exactly what was offered", () => {
  it("resolves the verified page without a second request, with store provenance", async () => {
    const url = "https://www.alpha.test/p/5";
    const { search, calls } = setup(
      [fakeStore("alpha", { discover: async () => [url] })],
      {
        [url]: page("Zed Gravel 2024", "Shimano GRX"),
      },
    );
    const offered = await run(() => search.stores(query));
    if (offered.status !== "ambiguous") throw Error("expected choices");
    const [candidate] = offered.candidates;
    expect(candidate.candidateId).toBe(candidateIdOf(url));
    const chosen = await run(() =>
      search.select(query, candidate.candidateId!),
    );
    if (chosen?.status !== "resolved") throw Error("expected a specification");
    expect(chosen.manualSelection).toBe(true);
    expect(chosen.source).toMatchObject({
      kind: "store",
      storeId: "alpha",
      adapter: "store:alpha",
      manufacturer: "ALPHA",
      url,
    });
    expect(
      chosen.components.every((c) => c.provenance?.sourceUrl === url),
    ).toBe(true);
    expect(calls.filter((u) => u === url)).toHaveLength(1);
  });

  it("re-reads the same page once the parsed copy is gone, never searches again", async () => {
    const url = "https://www.alpha.test/p/6";
    const discover = vi.fn(async () => [url]);
    const stores = [fakeStore("alpha", { discover })];
    const { http, calls, settings } = setup(stores, {
      [url]: page("Zed Gravel 2024"),
    });
    const registry = new CandidateRegistry(60000, 0);
    const search = new SourceSearch({
      adapters: [],
      http,
      settings,
      stores,
      registry,
      manual: new ManualSources(http, [], settings, stores),
      limits: { storeMs: 400, webMs: 400, pageMs: 400 },
    });
    const offered = await run(() => search.stores(query));
    if (offered.status !== "ambiguous") throw Error("expected choices");
    const chosen = await run(() =>
      search.select(query, offered.candidates[0].candidateId!),
    );
    expect(chosen?.status).toBe("resolved");
    expect(calls.filter((u) => u === url)).toHaveLength(2);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("does not know an id it never offered", async () => {
    const { search } = setup([], {});
    expect(
      await run(() => search.select(query, "a".repeat(64))),
    ).toBeUndefined();
  });
});

describe("candidate registry", () => {
  const candidate = (n: number) => ({
    candidateId: String(n).padStart(64, "0"),
    kind: "store" as const,
    brand: "Zed",
    canonicalName: "Zed " + n,
    url: "https://www.alpha.test/p/" + n,
    year: 2024,
  });
  it("forgets after its lifetime and is bounded", () => {
    vi.useFakeTimers();
    try {
      const registry = new CandidateRegistry(1000, 500, 3, 2);
      for (let n = 1; n <= 5; n++) registry.remember(candidate(n));
      expect(registry.get(candidate(1).candidateId)).toBeUndefined();
      expect(registry.get(candidate(5).candidateId)?.url).toContain("/p/5");
      vi.advanceTimersByTime(1001);
      expect(registry.get(candidate(5).candidateId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it("never hands out an address that was not offered", () => {
    const registry = new CandidateRegistry();
    expect(registry.get(candidateIdOf("https://evil.test/x"))).toBeUndefined();
  });
});

describe("through the HTTP API", () => {
  const adapterStub = (over: Partial<BikeManufacturerAdapter> = {}) =>
    ({
      id: "giant",
      brand: "Giant",
      aliases: [],
      allowedDomains: ["www.giant-bicycles.com"],
      adapterVersion: 1,
      discover: vi.fn(async () => []),
      fetch: vi.fn(),
      parse: vi.fn(),
      ...over,
    }) as unknown as BikeManufacturerAdapter;
  function api(
    stores: RetailStore[],
    pages: Record<string, string>,
    adapters: BikeManufacturerAdapter[] = [],
    mutate: (s: SettingsStore) => void = () => {},
  ) {
    const { http, calls } = fakeHttp(pages);
    const settings = new SettingsStore();
    settings.value.stores = {
      ...settings.value.stores,
      ...Object.fromEntries(stores.map((s) => [s.id, true])),
    } as typeof settings.value.stores;
    mutate(settings);
    const cache = new MemoryCache();
    const app = buildApp(
      new Resolver(adapters, cache, logger),
      cache,
      settings,
      http,
      stores,
    );
    return { app, calls, settings };
  }
  const post = (
    app: ReturnType<typeof api>["app"],
    payload: object,
    url = "/v1/resolve",
  ) => app.inject({ method: "POST", url, payload });

  it("unknown brand: stores offer variants, the choice resolves, no adapter is consulted", async () => {
    const url = "https://www.alpha.test/p/31";
    const adapter = adapterStub();
    const { app } = api(
      [fakeStore("alpha", { discover: async () => [url] })],
      { [url]: page("Zed Gravel 2024") },
      [adapter],
      (s) => {
        s.value.retailerSearch = true;
      },
    );
    try {
      const offered = (
        await post(app, { ...query, chooseCandidates: true })
      ).json();
      expect(offered.status).toBe("ambiguous");
      expect(offered.candidates[0]).toMatchObject({
        kind: "store",
        storeId: "alpha",
        selectable: true,
      });
      expect(
        offered.search.sources.some((s: { id: string }) => s.id === "alpha"),
      ).toBe(true);
      const chosen = (
        await post(app, {
          ...query,
          candidateId: offered.candidates[0].candidateId,
        })
      ).json();
      expect(chosen.status).toBe("resolved");
      expect(chosen.source.kind).toBe("store");
      expect(chosen.sourceYear).toBe(2024);
      expect(adapter.discover).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("a query without choice mode never turns a store page into a specification by itself", async () => {
    const url = "https://www.alpha.test/p/32";
    const { app } = api([fakeStore("alpha", { discover: async () => [url] })], {
      [url]: page("Zed Gravel 2024"),
    });
    try {
      const result = (await post(app, query)).json();
      expect(result.status).toBe("ambiguous");
      expect(result.candidates).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("an official ambiguity is not settled by a store", async () => {
    const discover = vi.fn(async () => ["https://www.alpha.test/p/33"]);
    const official = adapterStub({
      discover: async () => [
        {
          brand: "Giant",
          canonicalName: "Revolt A",
          url: "https://www.giant-bicycles.com/a",
          year: 2024,
        },
        {
          brand: "Giant",
          canonicalName: "Revolt B",
          url: "https://www.giant-bicycles.com/b",
          year: 2024,
        },
      ],
    });
    const { app } = api([fakeStore("alpha", { discover })], {}, [official]);
    try {
      const result = (
        await post(app, {
          brand: "Giant",
          model: "Revolt",
          trim: null,
          year: 2024,
        })
      ).json();
      expect(result.status).toBe("ambiguous");
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("an adapter switched off falls through to the stores instead of ending the request", async () => {
    const url = "https://www.alpha.test/p/34";
    const { app } = api(
      [fakeStore("alpha", { discover: async () => [url] })],
      { [url]: page("Giant Revolt 2024") },
      [adapterStub()],
      (s) => {
        s.value.adapters.giant = false;
      },
    );
    try {
      const result = (
        await post(app, {
          brand: "Giant",
          model: "Revolt",
          trim: null,
          year: 2024,
        })
      ).json();
      expect(result.status).toBe("ambiguous");
    } finally {
      await app.close();
    }
  });

  it("with no store search and no adapter the answer is still «unsupported»", async () => {
    const discover = vi.fn(async () => []);
    const { app } = api([fakeStore("alpha", { discover })], {}, [], (s) => {
      s.value.retailerSearch = false;
    });
    try {
      expect((await post(app, query)).json().status).toBe("unsupported_brand");
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("an id nobody offered is expired, not a new automatic pick", async () => {
    const discover = vi.fn(async () => ["https://www.alpha.test/p/35"]);
    const { app } = api([fakeStore("alpha", { discover })], {});
    try {
      const result = (
        await post(app, { ...query, candidateId: "b".repeat(64) })
      ).json();
      expect(result).toMatchObject({
        status: "not_found",
        reason: "candidate_expired",
        retryable: true,
      });
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("an id the registry forgot never turns into the adapter's fresh list", async () => {
    const official = adapterStub({
      discover: async () => [
        {
          brand: "Giant",
          canonicalName: "Revolt A",
          url: "https://www.giant-bicycles.com/a",
          year: 2024,
        },
        {
          brand: "Giant",
          canonicalName: "Revolt B",
          url: "https://www.giant-bicycles.com/b",
          year: 2024,
        },
      ],
    });
    const { app } = api([fakeStore("alpha")], {}, [official]);
    try {
      // After a restart a store candidate's id is nobody's; the manufacturer
      // adapter does not know it and must not answer with another list.
      const result = (
        await post(app, {
          brand: "Giant",
          model: "Revolt",
          trim: null,
          year: 2024,
          candidateId: candidateIdOf("https://www.alpha.test/p/gone"),
        })
      ).json();
      expect(result).toMatchObject({
        status: "not_found",
        reason: "candidate_expired",
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });

  it("an official page the adapter still offers is found again by its id", async () => {
    const url = "https://www.giant-bicycles.com/revolt-2024";
    const official = adapterStub({
      discover: async () => [
        {
          brand: "Giant",
          canonicalName: "Revolt 2024",
          url,
          year: 2024,
        },
      ],
      fetch: async (c) => ({
        url: c.url,
        body: page("Giant Revolt 2024"),
        hash: "h",
        fetchedAt: "2026-10-07T00:00:00Z",
      }),
      parse: async (doc) => parseDocument(doc),
    });
    const { app } = api([fakeStore("alpha")], {}, [official]);
    try {
      const result = (
        await post(app, {
          brand: "Giant",
          model: "Revolt",
          trim: null,
          year: 2024,
          candidateId: candidateIdOf(url),
        })
      ).json();
      expect(result.status).toBe("resolved");
      expect(result.source).toMatchObject({ adapter: "giant" });
    } finally {
      await app.close();
    }
  });

  it("a chosen official page keeps the adapter that found it; a pasted one stays pasted", async () => {
    const url = "https://www.giant-bicycles.com/revolt-2024";
    const official = adapterStub({
      adapterVersion: 7,
      discover: async () => [
        { brand: "Giant", canonicalName: "Revolt", url, year: 2024 },
      ],
      parse: async (doc) => parseDocument(doc),
    });
    const { app } = api([fakeStore("alpha")], { [url]: page("Revolt 2024") }, [
      official,
    ]);
    const request = { brand: "Giant", model: "Revolt", trim: null, year: 2024 };
    try {
      const offered = (
        await post(app, { ...request, chooseCandidates: true })
      ).json();
      expect(offered.status).toBe("ambiguous");
      expect(offered.candidates[0]).toMatchObject({ kind: "manufacturer" });
      const chosen = (
        await post(app, {
          ...request,
          candidateId: offered.candidates[0].candidateId,
        })
      ).json();
      expect(chosen.status).toBe("resolved");
      // The label and the stored provenance say "official", not "pasted page".
      expect(chosen.source).toMatchObject({
        kind: "manufacturer",
        adapter: "giant",
        adapterVersion: 7,
        manufacturer: "Giant",
      });
      const pasted = (
        await post(app, { ...request, sourceUrl: url }, "/v1/resolve-url")
      ).json();
      expect(pasted.source).toMatchObject({
        kind: "manual",
        adapter: "manual-url",
      });
    } finally {
      await app.close();
    }
  });

  it("a pasted URL beats both the candidate and the search", async () => {
    const pasted = "https://www.alpha.test/p/36";
    const discover = vi.fn(async () => []);
    const { app } = api([fakeStore("alpha", { discover })], {
      [pasted]: page("Zed Gravel 2024"),
    });
    try {
      for (const route of ["/v1/resolve", "/v1/resolve-url"]) {
        const result = (
          await post(
            app,
            {
              ...query,
              sourceUrl: pasted,
              ...(route === "/v1/resolve"
                ? { candidateId: "c".repeat(64) }
                : {}),
            },
            route,
          )
        ).json();
        expect(result.status).toBe("resolved");
        expect(result.source).toMatchObject({
          kind: "store",
          storeId: "alpha",
        });
      }
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("brands and stores are listed honestly, diagnostics keep each source", async () => {
    const stores = [
      fakeStore("alpha", { discover: async () => [] }),
      fakeStore("gamma", { discover: refuse("http_403") }),
    ];
    const { app } = api(stores, {}, [adapterStub()]);
    try {
      await post(app, { ...query, chooseCandidates: true });
      const brands = (await app.inject("/v1/brands")).json();
      expect(brands.brands[0]).toMatchObject({ id: "giant", kind: "direct" });
      expect(
        brands.stores.map((s: { id: string; search: boolean }) => [
          s.id,
          s.search,
        ]),
      ).toEqual([
        ["alpha", true],
        ["gamma", true],
      ]);
      expect(brands.storeSearch).toBe(true);
      const diagnostics = (await app.inject("/internal/diagnostics")).json();
      expect(diagnostics.sources.gamma).toMatchObject({ reason: "http_403" });
      expect(diagnostics.sources.gamma.lastFailure).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("streams a bounded trace with per-store progress, then the choices", async () => {
    const urls = Array.from(
      { length: 4 },
      (_, i) => `https://www.alpha.test/p/${40 + i}`,
    );
    const stores = [
      fakeStore("alpha", { discover: async () => urls }),
      fakeStore("beta", {
        discover: async () => urls.map((u) => u.replace("alpha", "beta")),
      }),
    ];
    const pages = Object.fromEntries(
      urls.flatMap((u, i) => [
        [u, page("Zed Gravel 2024 " + i)],
        [u.replace("alpha", "beta"), page("Zed Gravel 2024 " + i)],
      ]),
    );
    const { app } = api(stores, pages);
    try {
      const response = await post(
        app,
        { ...query, chooseCandidates: true },
        "/v1/resolve/stream",
      );
      const lines = response.body
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      // The browser proxy refuses streams beyond 242 lines.
      expect(lines.length).toBeLessThan(60);
      const events = lines.filter((l) => l.type === "event");
      expect(
        events
          .filter((e) => e.event === "store_checked")
          .map((e) => e.host)
          .sort(),
      ).toEqual(["www.alpha.test", "www.beta.test"]);
      expect(events.map((e) => e.event)).toContain("retailer_search_started");
      expect(lines.at(-1).result.status).toBe("ambiguous");
      expect(lines.at(-1).result.candidates.length).toBeGreaterThan(1);
    } finally {
      await app.close();
    }
  });

  it("a client that disconnects stops the search server-side", async () => {
    let cancelled = false;
    const discover: RetailStore["discover"] = async () => {
      const signal = resolutionContext.getStore()!.signal;
      signal.addEventListener(
        "abort",
        () => {
          cancelled = true;
        },
        { once: true },
      );
      return abortable(new Promise<string[]>(() => {}), signal);
    };
    const { app } = api([fakeStore("alpha", { discover })], {});
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(address + "/v1/resolve/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...query, chooseCandidates: true }),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => {});
      await vi.waitFor(() => expect(cancelled).toBe(true));
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });
});
