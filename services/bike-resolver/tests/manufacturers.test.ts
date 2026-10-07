import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { SettingsStore, settingsSchema } from "../src/settings.js";
import { CandidateRegistry } from "../src/candidate-registry.js";
import { SourceSearch } from "../src/search.js";
import { ManualSources } from "../src/manual.js";
import { createAdapters } from "../src/adapters/index.js";
import { RoseAdapter } from "../src/adapters/rose.js";
import { SavaAdapter, savaName } from "../src/adapters/sava.js";
import { ShulzAdapter } from "../src/adapters/shulz.js";
import { TwitterAdapter, twitterName } from "../src/adapters/twitter.js";
import { partialScore, scoreCandidate } from "../src/matcher.js";
import { identityConflict } from "../src/identity.js";
import { createStores } from "../src/stores/index.js";
import { absentComponent } from "../src/component-identity.js";
import { parseDocument } from "../src/extract.js";
import {
  ResolverError,
  type BikeCandidate,
  type BikeManufacturerAdapter,
  type BikeQuery,
} from "../src/domain.js";
import { withResolution } from "../src/context.js";
import type { ManufacturerHttpClient } from "../src/http.js";

// Real pages of the four brands, reduced to the nodes extraction reads.
// tests/fixtures/manufacturers/manifest.json records where each came from: a
// live request through the resolver's own client (2026-10-07) or, for the page
// of the earlier ROSE shop that no longer exists, a Common Crawl record.
const root = new URL("./fixtures/manufacturers/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
interface Entry {
  id: string;
  adapter: "rose" | "sava" | "shulz" | "twitter";
  kind:
    | "bike"
    | "bike-archived"
    | "frameset"
    | "accessory"
    | "family"
    | "listing"
    | "search"
    | "sitemap";
  requestedUrl: string;
  url: string;
  retrievedAt: string;
  rawSha256: string;
  reducedSha256: string;
  origin: { source: string; crawl?: string; warcFile?: string };
  expected?: {
    name?: string;
    year?: number | null;
    minComponents?: number;
    types?: string[];
    absentTypes?: string[];
    reason?: string;
    weight?: number;
    conflicts?: boolean;
    crankMentions?: string;
    build?: string;
    parseUrl?: string;
  };
}
const manifest: Entry[] = JSON.parse(read("manifest.json"));
const extension: Record<Entry["kind"], string> = {
  bike: ".html",
  "bike-archived": ".html",
  frameset: ".html",
  accessory: ".html",
  family: ".html",
  listing: ".html",
  search: ".json",
  sitemap: ".xml",
};
const fixture = (e: Entry) => read(e.id + extension[e.kind]);
const entry = (id: string) => manifest.find((e) => e.id === id)!;
const doc = (e: Entry, url = e.url) => ({
  url,
  body: fixture(e),
  hash: e.rawSha256,
  fetchedAt: e.retrievedAt,
});
const blank: BikeQuery = { brand: "x", model: "y", trim: null, year: null };
// "Gelaro S6 GRX610" -> "gelaro-s6-grx610": the name of its recorded search.
const slugOf = (query: string | null) =>
  (query ?? "").toLowerCase().trim().replace(/\s+/g, "-");

describe("fixtures keep their provenance", () => {
  for (const e of manifest)
    it(e.id, () => {
      expect(createHash("sha256").update(fixture(e)).digest("hex")).toBe(
        e.reducedSha256,
      );
      expect(e.rawSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(new Date(e.retrievedAt).toISOString().slice(0, 4)).toMatch(/^20/);
      expect(["live", "Common Crawl"]).toContain(e.origin.source);
      if (e.origin.source === "Common Crawl")
        expect(e.origin.warcFile).toMatch(/^crawl-data\/CC-MAIN-/);
    });
  it("covers every brand with ready bikes, and ROSE and SHULZ with a part and a frameset", () => {
    for (const [adapter, bikes] of [
      ["rose", 3],
      ["sava", 4],
      ["shulz", 2],
      ["twitter", 4],
    ] as const)
      expect(
        manifest.filter((e) => e.adapter === adapter && e.kind === "bike")
          .length,
      ).toBeGreaterThanOrEqual(bikes);
    expect(
      manifest.some((e) => e.adapter === "rose" && e.kind === "accessory"),
    ).toBe(true);
    expect(
      manifest.some((e) => e.adapter === "shulz" && e.kind === "frameset"),
    ).toBe(true);
  });
});

const adapters = {
  rose: new RoseAdapter({} as ManufacturerHttpClient),
  sava: new SavaAdapter({} as ManufacturerHttpClient),
  shulz: new ShulzAdapter({} as ManufacturerHttpClient),
  twitter: new TwitterAdapter({} as ManufacturerHttpClient),
};
describe("parsers on recorded pages", () => {
  for (const e of manifest.filter((m) => m.expected))
    it(e.id, async () => {
      const want = e.expected!,
        url = e.url + (want.parseUrl ?? "");
      const parse = () => adapters[e.adapter].parse(doc(e, url), blank);
      if (want.reason) {
        await expect(parse()).rejects.toMatchObject({ reason: want.reason });
        return;
      }
      const parsed = await parse();
      expect(parsed.canonicalName.replace(/ [-—] .*$/, "")).toBe(
        want.name!.replace(/ [-—] .*$/, ""),
      );
      expect(parsed.year).toBe(want.year);
      expect(parsed.components.length).toBeGreaterThanOrEqual(
        want.minComponents!,
      );
      expect(parsed.quality?.level).toBe("complete");
      const types = new Set(parsed.components.map((c) => c.type));
      for (const type of want.types ?? []) expect(types).toContain(type);
      for (const type of want.absentTypes ?? [])
        expect(types).not.toContain(type);
      if (want.weight !== undefined)
        expect(parsed.suggestedMetadata?.weight).toBe(want.weight);
      if (want.conflicts)
        expect(parsed.warnings).toContain("conflicting_sources");
      if (want.crankMentions) {
        const crank = parsed.components.find((c) => c.type === "crankset");
        expect(crank?.raw.value).toContain(want.crankMentions);
        // The page's parts decide, not the address that says grx600.
        expect(e.url).toContain("grx600");
        expect(crank?.raw.value).not.toMatch(/RX600/);
      }
      // Every component remembers the page and the label it was read from.
      for (const c of parsed.components) {
        expect(c.provenance?.sourceUrl).toBe(url);
        expect(c.provenance?.rawLabel).toBeTruthy();
      }
    });
});

// A bike request as the wizard sends it; the year is the person's, not a fact.
const ask = (brand: string, model: string, year: number | null) => ({
  brand,
  model,
  trim: null,
  year,
});
const fixtureRoutes = (
  pick: (url: URL) => { entry: Entry; body?: string } | undefined,
) => {
  const requested: string[] = [];
  const http = {
    get: vi.fn(async (input: string) => {
      requested.push(input);
      const hit = pick(new URL(input));
      if (!hit)
        throw new ResolverError(
          "upstream_unavailable",
          "Not recorded",
          false,
          "http_404",
        );
      return {
        url: input,
        body: hit.body ?? fixture(hit.entry),
        hash: hit.entry.rawSha256,
        fetchedAt: hit.entry.retrievedAt,
      };
    }),
  } as unknown as ManufacturerHttpClient;
  return { http, requested };
};

describe("ROSE: current and older pages are choices, the year is never inferred", () => {
  const roseHttp = () =>
    fixtureRoutes((u) => {
      const id = ((p) =>
        p === "/sitemap.xml"
          ? "rose-sitemap"
          : p === "/bikes/gravel/adventure/backroad"
            ? "rose-family-backroad"
            : p === "/bikes/urban-&-hybrid/hybrid/black-lava"
              ? "rose-family-black-lava"
              : p.startsWith("/p/")
                ? manifest.find((e) => e.url.endsWith(p))?.id
                : undefined)(decodeURI(u.pathname));
      return id ? { entry: entry(id) } : undefined;
    });
  const rose = (http: ManufacturerHttpClient) =>
    new RoseAdapter(http as ManufacturerHttpClient);

  it("offers the bike of the current range first and leaves out parts", async () => {
    const { http } = roseHttp();
    const found = await rose(http).discover(
      ask("ROSE", "Backroad Unsupported", 2025),
    );
    expect(found.map((c) => c.url)).toEqual([
      "https://www.rosebikes.com/p/rose-backroad-unsupported-2725748",
      "https://www.rosebikes.com/p/rose-backroad-unsupported-165481",
    ]);
    expect(found.every((c) => c.year === null)).toBe(true);
  });

  it("rose black lava 2 2023: the current page and the older pages, none called 2023", async () => {
    const { http } = roseHttp();
    for (const model of ["Black Lava 2", "BlackLava 2", "BLACK LAVA 2"]) {
      const found = await rose(http).discover(ask("ROSE", model, 2023));
      expect(found.map((c) => c.manufacturerProductId)).toEqual(
        expect.arrayContaining(["160438", "2706827", "2723490"]),
      );
      // Black Lava 3 and the 2020 seat post clamp are other things.
      expect(found.some((c) => /lava-3-|clamp/.test(c.url))).toBe(false);
      expect(found.every((c) => c.year === null)).toBe(true);
      // The frame variants (MidStep) stay apart from the plain bike.
      expect(found.some((c) => c.url.includes("midstep"))).toBe(true);
    }
  });

  it("a request through the search offers variants and never settles on one by itself", async () => {
    const { http } = roseHttp();
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const a = rose(http);
    const search = new SourceSearch({
      adapters: [a],
      http,
      manual: new ManualSources(http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const result = await withResolution(
      new AbortController().signal,
      undefined,
      () => search.all(ask("ROSE", "Black Lava 2", 2023)),
    );
    if (result.status !== "ambiguous") throw Error("expected choices");
    const pages = result.candidates.filter((c) => c.kind === "manufacturer");
    expect(pages.map((c) => c.manufacturerProductId).sort()).toEqual([
      "1604380101",
      "232464201",
      "234686801",
    ]);
    // The pages state no year; none is borrowed from the request.
    expect(pages.every((c) => c.year === null)).toBe(true);
    expect(pages.every((c) => c.selectable)).toBe(true);
    // They differ in what they are built from, which is what the person weighs.
    expect(new Set(pages.map((c) => c.canonicalName)).size).toBe(1);
    expect(result.search?.complete).toBe(false);
    // Unreadable (404) midstep pages are reported as a failure, not as «empty».
    const source = result.search?.sources.find((s) => s.id === "rose");
    expect(source?.status).toBe("ok");
  });

  it("choosing one of them resolves exactly that page, with no year", async () => {
    const { http } = roseHttp();
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const a = rose(http);
    const search = new SourceSearch({
      adapters: [a],
      http,
      manual: new ManualSources(http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const query = ask("ROSE", "Backroad Unsupported", 2025);
    const chosen = await withResolution(
      new AbortController().signal,
      undefined,
      async () => {
        const offered = await search.all(query);
        if (offered.status !== "ambiguous") throw Error("expected choices");
        expect(offered.candidates).toHaveLength(1);
        expect(offered.candidates[0].year).toBeNull();
        return search.select(query, offered.candidates[0].candidateId!);
      },
    );
    if (chosen?.status !== "resolved") throw Error("expected a result");
    expect(chosen.sourceYear).toBeNull();
    expect(chosen.manualSelection).toBe(true);
    expect(chosen.source).toMatchObject({
      adapter: "rose",
      kind: "manufacturer",
      manufacturer: "ROSE",
    });
    expect(chosen.components.map((c) => c.type)).not.toContain("pedals");
  });

  it("a part page with a bike's name is refused, a recorded older page is read", async () => {
    await expect(
      adapters.rose.parse(
        doc(entry("rose-belt-drive-insert-black-lava-2694308")),
        blank,
      ),
    ).rejects.toMatchObject({ reason: "not_complete_bike" });
    const old = await adapters.rose.parse(
      doc(entry("rose-black-lava-2-2702485-capture-2023-10")),
      blank,
    );
    // Captured in October 2023, stating no model year: the capture date is
    // evidence of the offer at that time, not a year.
    expect(old.year).toBeNull();
    expect(old.components.length).toBeGreaterThanOrEqual(19);
  });
});

describe("SAVA", () => {
  const savaHttp = () =>
    fixtureRoutes((u) => {
      if (u.pathname === "/search/suggest.json") {
        const id = "sava-suggest-" + slugOf(u.searchParams.get("q"));
        return manifest.some((e) => e.id === id)
          ? { entry: entry(id) }
          : undefined;
      }
      return undefined;
    });
  it("names a bike as a rider does and tells the address from the data", () => {
    expect(
      savaName("2026 SAVA Blade R7-105 Di2 Full Carbon Road Bike 24S"),
    ).toBe("Blade R7-105 Di2");
    expect(savaName("SAVA Gelaro S6-GRX610 Carbon Gravel Bike 12SP")).toBe(
      "Gelaro S6-GRX610",
    );
    expect(savaName("2026 A7L PRO-105 Carbon Fiber Road Bike 24SP US")).toBe(
      "A7L PRO-105 US",
    );
    expect(savaName("SAVA A7L 2026 Full Carbon Road Bike 24 Speed")).toBe(
      "A7L",
    );
    expect(savaName("SAVA EX7-S-105 R7100 Disc Brake Road Bike 24SP")).toBe(
      "EX7-S-105 R7100",
    );
  });
  it("offers the bikes of the model and none of the other models, used or kids' bikes", async () => {
    const a = new SavaAdapter(savaHttp().http);
    const blade = await a.discover(ask("SAVA", "Blade R7", null));
    expect(blade.map((c) => c.canonicalName)).toEqual(["Blade R7-105 Di2"]);
    expect(blade[0]).toMatchObject({
      url: "https://savadeck-bike.com/products/sava-blade-r7-105-di2-full-carbon-road-bike-24s",
      year: 2026,
    });
    const gelaro = await a.discover(ask("SAVA", "Gelaro S6 GRX610", null));
    expect(gelaro.map((c) => c.canonicalName)).toEqual(["Gelaro S6-GRX610"]);
    expect(gelaro[0].year).toBeNull();
    // Used bikes and kids' bikes are not ready bikes of the range.
    expect(await a.discover(ask("SAVA", "Frameset", null))).toEqual([]);
  });
  it("reads a storefront that answers in another format as a failure, not as «no bike»", async () => {
    const http = {
      get: async (url: string) => ({
        url,
        body: "<html>maintenance</html>",
        hash: "h",
        fetchedAt: "t",
      }),
    } as unknown as ManufacturerHttpClient;
    await expect(
      new SavaAdapter(http).discover(ask("SAVA", "Blade R7", null)),
    ).rejects.toMatchObject({ status: "parse_error" });
  });
});

describe("SHULZ", () => {
  const shulzHttp = () =>
    fixtureRoutes((u) =>
      u.pathname === "/catalog/all/bikes"
        ? { entry: entry("shulz-catalog-all-bikes") }
        : undefined,
    );
  it("offers a model once, whatever its colours, and only the brand's own bikes", async () => {
    const a = new ShulzAdapter(shulzHttp().http);
    for (const model of ["Wanderer", "wanderer"]) {
      const found = await a.discover(ask("SHULZ", model, null));
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        canonicalName: "Wanderer",
        year: null,
      });
      expect(found[0].url).toMatch(
        /^https:\/\/shulz\.ru\/catalog\/bikes\/gravel-touring\/shulz-wanderer\/\d+$/,
      );
    }
    // Both spellings of the apostrophe and the run-together form are one model.
    for (const model of ["Boys Don't Cry", "Boys Don’t Cry", "BoysDontCry"]) {
      const found = await a.discover(ask("SHULZ", model, null));
      expect(found.map((c) => c.canonicalName)).toEqual(["Boys Don’t Cry"]);
    }
    // The importer's Strida folding bikes are another brand.
    expect(await a.discover(ask("SHULZ", "52", null))).toEqual([]);
  });
  it("matches the model against the page's own name, whichever way it is spelt", () => {
    const candidate = (name: string): BikeCandidate => ({
      brand: "SHULZ",
      canonicalName: name,
      url: "https://shulz.ru/x/1",
      year: null,
    });
    for (const model of ["Boys Don't Cry", "BoysDontCry", "boys dont cry"]) {
      expect(
        scoreCandidate(ask("SHULZ", model, null), candidate("Boys Don’t Cry")),
      ).toBeGreaterThan(0);
    }
    expect(
      scoreCandidate(ask("SHULZ", "Lone Ranger", null), candidate("Wanderer")),
    ).toBe(0);
  });
  it("brand aliases cover Russian and Latin spelling", () => {
    expect(adapters.shulz.aliases).toEqual(
      expect.arrayContaining(["Шульц", "Shulz"]),
    );
  });
});

describe("TWITTER: the official US shop, one choice per build", () => {
  const twitterHttp = () =>
    fixtureRoutes((u) => {
      if (u.pathname === "/search/suggest.json") {
        const id = "twitter-suggest-" + slugOf(u.searchParams.get("q"));
        return manifest.some((e) => e.id === id)
          ? { entry: entry(id) }
          : undefined;
      }
      const page = manifest.find(
        (e) =>
          e.adapter === "twitter" &&
          e.kind === "bike" &&
          new URL(e.url).pathname === u.pathname,
      );
      return page ? { entry: page } : undefined;
    });
  it("names a model without the shop's words", () => {
    expect(twitterName("Cyclone Pro - 3rd Twitter Carbon Road Bike")).toBe(
      "Cyclone Pro 3rd",
    );
    expect(
      twitterName("Cyclone 3rd Advanced (UCI) - Twitter Carbon Road Bike"),
    ).toBe("Cyclone 3rd Advanced (UCI)");
    expect(twitterName("Gravel V3 - Wireless - Twitter Gravel Road Bike")).toBe(
      "Gravel V3 Wireless",
    );
    expect(twitterName("R5 Pro - Term - Carbon Road Bike")).toBe("R5 Pro Term");
  });
  it("offers each build of a product separately and never a frameset", async () => {
    const a = new TwitterAdapter(twitterHttp().http);
    const found = await a.discover(ask("TWITTER", "Cyclone 3rd", null));
    const names = found.map((c) => c.canonicalName);
    expect(names).toEqual(
      expect.arrayContaining([
        "Cyclone Pro 3rd - 105 2x12",
        "Cyclone Pro 3rd - 105 Di2 2x12",
        "Cyclone Pro 3rd - EDS TX 2x12",
        "Cyclone 3rd Advanced (UCI) - RS+105 2x12",
        "Cyclone 3rd Advanced (UCI) - ES7000 1x13",
        "Cyclone 3rd (ET)",
      ]),
    );
    expect(names.some((n) => /frame set/i.test(n))).toBe(false);
    // A build is addressed by the page and its name; the pages differ by that.
    const urls = found.map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(
      "https://twitterbikeusa.com/products/cyclone-pro-3rd?build=105-di2-2-12",
    );
    expect(found.every((c) => c.year === null || c.year === 2025)).toBe(true);
  });
  it("«Cyclone 3rd EVO» is not a name of the shop: the nearest builds are offered, nothing is invented", async () => {
    const http = twitterHttp();
    const a = new TwitterAdapter(http.http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [a],
      http: http.http,
      manual: new ManualSources(http.http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const result = await withResolution(
      new AbortController().signal,
      undefined,
      () => search.all(ask("TWITTER", "Cyclone 3rd EVO", null)),
    );
    // No page is called EVO, so the exact model is absent. The Cyclone 3rd
    // builds are offered as a list to choose from, and nothing settles it.
    if (result.status !== "ambiguous") throw Error("expected choices");
    const names = result.candidates.map((c) => c.canonicalName);
    expect(names.length).toBeGreaterThan(3);
    expect(names.every((n) => /cyclone/i.test(n) && !/evo/i.test(n))).toBe(
      true,
    );
    expect(
      result.candidates.every((c) => c.selectable && c.year === null),
    ).toBe(true);
    expect(result.search?.complete).toBe(false);
  });
  it("a build keeps only its own parts: the wireless build has no front derailleur", async () => {
    const e = entry(
      "twitter-cyclone-3rd-advanced-uci-twitter-carbon-road-bike",
    );
    const read = async (query: string) =>
      adapters.twitter.parse(doc(e, e.url + query), blank);
    const mechanical = await read("?build=rs-105-2-12"),
      wireless = await read("?build=es7000-1-13");
    const type = (p: typeof mechanical, t: string) =>
      p.components.find((c) => c.type === t)?.raw.value;
    expect(type(mechanical, "front_derailleur")).toMatch(/105/);
    expect(type(mechanical, "rear_derailleur")).toMatch(/12S/);
    expect(type(wireless, "front_derailleur")).toBeUndefined();
    expect(type(wireless, "rear_derailleur")).toMatch(/13S|ES800/);
    // Nothing of the other build leaks into a value.
    for (const p of [mechanical, wireless])
      for (const c of p.components)
        expect(c.raw.value).not.toMatch(/ES7000 1×13:|RS\+105 2×12:/);
    expect(mechanical.warnings).not.toContain("multiple_builds");
    // The numbers of the build, not of the other one.
    expect(mechanical.suggestedMetadata?.weight).toBe(8.5);
    expect(wireless.suggestedMetadata?.weight).toBe(8.6);
  });
  it("a pasted ?variant= link names its build, a bare address is told apart", async () => {
    const e = entry(
      "twitter-cyclone-3rd-advanced-uci-twitter-carbon-road-bike",
    );
    const pasted = await adapters.twitter.parse(
      doc(e, e.url + "?variant=46970781860001"),
      blank,
    );
    expect(pasted.canonicalName).toMatch(/RS\+105/);
    expect(pasted.warnings).not.toContain("multiple_builds");
    const bare = await adapters.twitter.parse(doc(e), blank);
    // Which of two builds was meant is not known: the first is taken and said so.
    expect(bare.warnings).toContain("multiple_builds");
    // A product with one build has nothing to choose.
    const single = entry("twitter-cyclone-3rd-et");
    expect(
      (await adapters.twitter.parse(doc(single), blank)).warnings,
    ).not.toContain("multiple_builds");
  });
  it("through the search a chosen build resolves with its own parts and an honest source", async () => {
    const http = twitterHttp();
    const a = new TwitterAdapter(http.http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [a],
      http: http.http,
      manual: new ManualSources(http.http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const query = ask("TWITTER", "Gravel V3", null);
    const chosen = await withResolution(
      new AbortController().signal,
      undefined,
      async () => {
        const offered = await search.all(query);
        if (offered.status !== "ambiguous") throw Error("expected choices");
        const builds = offered.candidates.filter(
          (c) => c.kind === "distributor",
        );
        expect(builds.map((c) => c.canonicalName)).toEqual(
          expect.arrayContaining([
            "Gravel V3 - SENSAH 2x12",
            "Gravel V3 - SENSAH 1x13",
            "Gravel V3 - SHIMANO 105",
          ]),
        );
        const wanted = builds.find((c) => /1×13|1x13/.test(c.canonicalName));
        return search.select(query, wanted!.candidateId!);
      },
    );
    if (chosen?.status !== "resolved") throw Error("expected a result");
    expect(chosen.source).toMatchObject({
      adapter: "twitter",
      kind: "distributor",
      manufacturer: "TWITTER",
    });
    expect(chosen.sourceYear).toBeNull();
  });
});

describe("builds of one product are one download", () => {
  const twitterHttp = () =>
    fixtureRoutes((u) => {
      if (u.pathname === "/search/suggest.json") {
        const id = "twitter-suggest-" + slugOf(u.searchParams.get("q"));
        return manifest.some((e) => e.id === id)
          ? { entry: entry(id) }
          : undefined;
      }
      const page = manifest.find(
        (e) =>
          e.adapter === "twitter" &&
          e.kind === "bike" &&
          new URL(e.url).pathname === u.pathname,
      );
      return page ? { entry: page } : undefined;
    });
  it("asks the shop for the product page, not for each build's own address", async () => {
    const { http, requested } = twitterHttp();
    const a = new TwitterAdapter(http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [a],
      http,
      manual: new ManualSources(http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const query = ask("TWITTER", "Gravel V3", null);
    const offered = await withResolution(
      new AbortController().signal,
      undefined,
      () => search.all(query),
    );
    if (offered.status !== "ambiguous") throw Error("expected choices");
    const builds = offered.candidates.filter((c) => c.url.includes("?build="));
    expect(builds.length).toBeGreaterThanOrEqual(3);
    // The choices stay one per build, each with its own address...
    expect(new Set(builds.map((c) => c.url)).size).toBe(builds.length);
    // ...while the shop is only ever asked for the page they share.
    const pages = requested.filter((u) => u.includes("/products/"));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.some((u) => u.includes("build="))).toBe(false);
    // And each build still reads its own parts.
    const names = new Set(builds.map((c) => c.canonicalName));
    expect(names.size).toBe(builds.length);
  });
  it("a chosen build keeps its address and its own parts", async () => {
    const { http, requested } = twitterHttp();
    const a = new TwitterAdapter(http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [a],
      http,
      manual: new ManualSources(http, [a], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
    });
    const query = ask("TWITTER", "Gravel V3", null);
    const chosen = await withResolution(
      new AbortController().signal,
      undefined,
      async () => {
        const offered = await search.all(query);
        if (offered.status !== "ambiguous") throw Error("expected choices");
        const wanted = offered.candidates.find((c) =>
          /1×13|1x13/.test(c.canonicalName),
        );
        return search.select(query, wanted!.candidateId!);
      },
    );
    if (chosen?.status !== "resolved") throw Error("expected a result");
    expect(chosen.source.url).toMatch(/\?build=sensah-1-13$|\?build=.*1-13/);
    expect(requested.some((u) => u.includes("build="))).toBe(false);
  });
});

describe("the direct resolver keeps the kind of source an adapter has", () => {
  const twitter = () => {
    const { http } = fixtureRoutes((u) => {
      if (u.pathname === "/search/suggest.json") {
        const id = "twitter-suggest-" + slugOf(u.searchParams.get("q"));
        return manifest.some((e) => e.id === id)
          ? { entry: entry(id) }
          : undefined;
      }
      const page = manifest.find(
        (e) =>
          e.adapter === "twitter" &&
          e.kind === "bike" &&
          new URL(e.url).pathname === u.pathname,
      );
      return page ? { entry: page } : undefined;
    });
    return new Resolver(
      [new TwitterAdapter(http)],
      new MemoryCache(),
      pino({ level: "silent" }),
    );
  };
  it("labels the choices and the chosen page of a distributor, without a search", async () => {
    const resolver = twitter();
    const query = ask("TWITTER", "Cyclone 3rd", null);
    const offered = await resolver.resolve(query);
    if (offered.status !== "ambiguous") throw Error("expected choices");
    expect(offered.candidates.length).toBeGreaterThan(3);
    expect(offered.candidates.every((c) => c.kind === "distributor")).toBe(
      true,
    );
    const wanted = offered.candidates.find((c) =>
      /\(ET\)/.test(c.canonicalName),
    );
    const chosen = await resolver.resolve({
      ...query,
      candidateId: wanted!.candidateId,
    });
    if (chosen.status !== "resolved") throw Error("expected a result");
    expect(chosen.source).toMatchObject({
      adapter: "twitter",
      kind: "distributor",
    });
  });
  it("an adapter without a declared kind is the manufacturer's own site", async () => {
    const roseHttp = fixtureRoutes((u) => {
      const p = decodeURI(u.pathname);
      const id =
        p === "/sitemap.xml"
          ? "rose-sitemap"
          : p === "/bikes/gravel/adventure/backroad"
            ? "rose-family-backroad"
            : manifest.find((e) => e.adapter === "rose" && e.url.endsWith(p))
                ?.id;
      return id ? { entry: entry(id) } : undefined;
    }).http;
    const resolver = new Resolver(
      [new RoseAdapter(roseHttp)],
      new MemoryCache(),
      pino({ level: "silent" }),
    );
    const query = ask("ROSE", "Backroad Unsupported", null);
    const offered = await resolver.resolve(query);
    if (offered.status !== "ambiguous")
      throw Error("expected choices: " + JSON.stringify(offered).slice(0, 300));
    expect(offered.candidates.every((c) => c.kind === "manufacturer")).toBe(
      true,
    );
  });
});

describe("the registry", () => {
  const stub = {
    get: async () => {
      throw new Error("no network in this test");
    },
  } as unknown as ManufacturerHttpClient;
  it("registers the four brands, each on by default, and labels the distributor", async () => {
    const all = createAdapters(stub);
    for (const id of ["rose", "sava", "shulz", "twitter"])
      expect(all.map((a) => a.id)).toContain(id);
    const cache = new MemoryCache();
    const app = buildApp(
      new Resolver(all, cache, pino({ level: "silent" })),
      cache,
      new SettingsStore(),
      stub,
      [],
    );
    try {
      const brands = (await app.inject("/v1/brands")).json().brands as {
        id: string;
        kind: string;
        enabled: boolean;
        limitation: string | null;
      }[];
      const by = Object.fromEntries(brands.map((b) => [b.id, b]));
      for (const id of ["rose", "sava", "shulz"])
        expect(by[id]).toMatchObject({ kind: "direct", enabled: true });
      // Not the manufacturer's own site: the importer's official shop.
      expect(by.twitter).toMatchObject({ kind: "distributor", enabled: true });
      expect(by.twitter.limitation).toMatch(/дистрибьютор/);
      expect(by.rose.limitation).toMatch(/модельный год/);
    } finally {
      await app.close();
    }
  });
  it("settings saved before these adapters existed still load", () => {
    const legacy = {
      ...new SettingsStore().value,
      adapters: {
        cube: true,
        specialized: true,
        canyon: true,
        giant: true,
        trek: true,
        cannondale: true,
        scott: false,
        orbea: false,
        merida: true,
        bmc: false,
      },
    };
    const loaded = settingsSchema.parse(legacy);
    expect(loaded.adapters).toMatchObject({
      rose: true,
      sava: true,
      shulz: true,
      twitter: true,
      gt: true,
      scott: false,
    });
  });
});

describe("shared extraction details the four sites need", () => {
  it("does not treat «not included» as an installed part", () => {
    for (const value of [
      "Pedals are not included in the scope of delivery",
      "None (1× setup)",
      "-",
    ])
      expect(absentComponent(value)).toBe(true);
    expect(absentComponent("Shimano Deore (cassette not included)")).toBe(
      false,
    );
    expect(absentComponent("Rose Backroad ADV")).toBe(false);
  });
  it("reads «Label:value» lines that end at a block, not only at <br>", () => {
    const html =
      '<html><body><div class="specs"><p><strong>DRIVETRAIN</strong></p>' +
      "<p><strong>Rear Derailleur</strong>:SHIMANO RD-R7150</p>" +
      "<p><strong>Crankset</strong>:SHIMANO FC-R7100</p>" +
      "<p><strong>Chain</strong>:SHIMANO CN-M6100</p></div></body></html>";
    const parsed = parseDocument({
      url: "https://savadeck-bike.com/products/x",
      body: html.replace(
        'class="specs"',
        'class="collapsible-content__inner rte"',
      ),
      hash: "h",
      fetchedAt: "t",
    });
    expect(parsed.components.map((c) => c.type)).toEqual([
      "rear_derailleur",
      "crankset",
      "chain",
    ]);
    // The heading is not glued to the first label.
    expect(parsed.rawSpecification).not.toHaveProperty(
      "DRIVETRAINRear Derailleur",
    );
  });
  it("a weight range is not one weight, a Cyrillic «кг» is read", () => {
    const meta = (value: string) =>
      parseDocument({
        url: "https://example.com/p",
        body:
          "<table><tr><td>Frame</td><td>Alloy</td></tr><tr><td>Fork</td><td>Carbon</td></tr>" +
          "<tr><td>Saddle</td><td>Fizik</td></tr><tr><td>Weight</td><td>" +
          value +
          "</td></tr></table>",
        hash: "h",
        fetchedAt: "t",
      }).suggestedMetadata?.weight;
    expect(meta("9.7 - 9.9 kg")).toBeUndefined();
    expect(meta("13,1 кг")).toBe(13.1);
  });
});

describe("the matcher knows one model by its spellings", () => {
  const candidate = (name: string): BikeCandidate => ({
    brand: "ROSE",
    canonicalName: name,
    url: "https://www.rosebikes.com/p/x-1",
    year: null,
  });
  it("accepts run-together and spaced forms, and nothing broader", () => {
    const score = (model: string, name: string, trim: string | null = null) =>
      scoreCandidate(
        { brand: "ROSE", model, trim, year: null },
        candidate(name),
      );
    expect(score("BlackLava 2", "Black Lava 2")).toBeGreaterThan(0);
    expect(score("Black Lava 2", "BlackLava 2")).toBeGreaterThan(0);
    expect(score("BlackLava", "Black Lava 2 MidStep")).toBeGreaterThan(0);
    // A different number is a different bike.
    expect(score("BlackLava 2", "Black Lava 3")).toBe(0);
    expect(score("Black Lava 2", "Black Lava 2020 Seat Post Clamp")).toBe(0);
    // With a trim, the whole name must agree.
    expect(
      score("Backroad", "Backroad Unsupported", "Unsupported"),
    ).toBeGreaterThan(0);
    expect(score("Backroad", "Backroad AL", "Unsupported")).toBe(0);
  });
});

describe("the same spellings pass every filter of the search, not only discovery", () => {
  const brandName = (brand: string, name: string) => brand + " " + name;
  it("scores a run-together or spaced model as the page's own name", () => {
    const q = (brand: string, model: string) => ({
      brand,
      model,
      trim: null,
      year: null,
    });
    // One joined word has no word in common with the spaced name; it is still
    // the same model, and both directions agree.
    expect(
      partialScore(
        q("ROSE", "BlackLava"),
        brandName("ROSE", "Black Lava 2"),
        null,
      ),
    ).toBeGreaterThan(0);
    expect(
      partialScore(
        q("SHULZ", "BoysDontCry"),
        brandName("SHULZ", "Boys Don’t Cry"),
        null,
      ),
    ).toBeGreaterThan(0);
    expect(
      partialScore(
        q("ROSE", "Black Lava 2"),
        brandName("ROSE", "BlackLava 2"),
        null,
      ),
    ).toBeGreaterThan(0);
    // The joined word is not a licence for anything else.
    expect(
      partialScore(
        q("SHULZ", "BoysDontCry"),
        brandName("SHULZ", "Wanderer"),
        null,
      ),
    ).toBe(0);
    expect(
      partialScore(
        q("ROSE", "BlackLava"),
        brandName("ROSE", "Backroad AL"),
        null,
      ),
    ).toBe(0);
  });
  it("does not call the same bike another one when judging a chosen page", () => {
    const q = (model: string) => ({
      brand: "SHULZ",
      model,
      trim: null,
      year: null,
    });
    for (const model of ["BoysDontCry", "Boys Don't Cry", "boys dont cry"])
      expect(identityConflict(q(model), "SHULZ Boys Don’t Cry", null)).toBe(
        false,
      );
    expect(identityConflict(q("BoysDontCry"), "SHULZ Wanderer", null)).toBe(
      true,
    );
    // A stated different year stays a conflict whatever the spelling.
    expect(
      identityConflict(
        { ...q("BoysDontCry"), year: 2024 },
        "SHULZ Boys Don’t Cry",
        2025,
      ),
    ).toBe(true);
  });
  for (const model of ["Boys Don't Cry", "BoysDontCry"])
    it(`${model}: an official page is offered as sure, no store is asked, and the chosen page is not flagged`, async () => {
      const { http } = fixtureRoutes((u) => {
        if (u.pathname === "/catalog/all/bikes")
          return { entry: entry("shulz-catalog-all-bikes") };
        const page = manifest.find(
          (e) =>
            e.adapter === "shulz" &&
            e.kind === "bike" &&
            e.url.endsWith(u.pathname),
        );
        return page ? { entry: page } : undefined;
      });
      const settings = new SettingsStore();
      const a = new ShulzAdapter(http);
      const stores = createStores();
      const search = new SourceSearch({
        adapters: [a],
        http,
        manual: new ManualSources(http, [a], settings, stores),
        settings,
        stores,
        registry: new CandidateRegistry(),
      });
      const query = ask("SHULZ", model, null);
      const run = <T>(work: () => Promise<T>) =>
        withResolution(new AbortController().signal, undefined, work);
      const offered = await run(() => search.all(query));
      if (offered.status !== "ambiguous")
        throw Error("expected a choice: " + JSON.stringify(offered));
      expect(offered.candidates.map((c) => c.canonicalName)).toEqual([
        "Boys Don’t Cry",
      ]);
      // The official page carries the request: nothing weaker needs asking.
      expect(offered.search?.sources.some((s) => s.kind === "store")).toBe(
        false,
      );
      const chosen = await run(() =>
        search.select(query, offered.candidates[0].candidateId!),
      );
      if (chosen?.status !== "resolved") throw Error("expected a result");
      expect(chosen.warnings ?? []).not.toContain("identity_mismatch");
    });
});

describe("a request for an unknown model never claims an exact answer", () => {
  it("lists nothing for a model no page carries", async () => {
    const http = {
      get: async () => {
        throw new ResolverError("upstream_unavailable", "x", false, "http_404");
      },
    } as unknown as ManufacturerHttpClient;
    const a: BikeManufacturerAdapter = new SavaAdapter(http);
    await expect(
      a.discover(ask("SAVA", "Blade R7", null)),
    ).rejects.toBeDefined();
  });
});
