import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import pino from "pino";
import { createAdapters } from "../src/adapters/index.js";
import { Resolver } from "../src/resolver.js";
import { MemoryCache } from "../src/cache.js";
import { SettingsStore } from "../src/settings.js";
import { ManualSources } from "../src/manual.js";
import { SourcePlanner } from "../src/planner.js";
import { SourceSearch } from "../src/search.js";
import { CandidateRegistry } from "../src/candidate-registry.js";
import { createStores } from "../src/stores/index.js";
import { ResolverError, type BikeQuery } from "../src/domain.js";
import type { ManufacturerHttpClient } from "../src/http.js";
const root = new URL("./fixtures/popular-bikes/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const bikes = JSON.parse(read("manifest.json")) as {
  id: string;
  category: string;
  query: BikeQuery;
  sourceYear: number | null;
  url: string;
  requestedUrl: string;
  retailer: boolean;
  retrievedAt: string;
}[];
const requests = JSON.parse(read("requests.json")) as {
  file: string;
  url: string;
  requestedUrl: string;
  retrievedAt: string;
}[];
function fixtureHttp() {
  const calls: string[] = [];
  const canonical = (input: string) => {
    const u = new URL(input);
    u.searchParams.sort();
    return u.href.replaceAll("%20", "+");
  };
  const http = {
    get: async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      const product = bikes.find(
        (b) =>
          canonical(b.requestedUrl) === canonical(url) ||
          canonical(b.url) === canonical(url) ||
          (u.hostname === "www.specialized.com" &&
            u.pathname.match(/\/p\/(\d+)/)?.[1] ===
              new URL(b.url).pathname.match(/\/p\/(\d+)/)?.[1] &&
            b.query.brand === "Specialized"),
      );
      const request = requests.find((r) =>
        [r.url, r.requestedUrl].some((x) => canonical(x) === canonical(url)),
      );
      const record = product || request;
      if (!record)
        throw new ResolverError(
          "upstream_unavailable",
          "Unrecorded fixture URL: " + url,
          false,
          "http_404",
        );
      const body = read(product ? product.id + ".html" : request!.file);
      return {
        url: record.url,
        body,
        fetchedAt: record.retrievedAt,
        hash: createHash("sha256").update(body).digest("hex"),
      };
    },
  } as unknown as ManufacturerHttpClient;
  return { http, calls };
}
describe("Popular Bikes 15 — recorded discovery → matching → acquisition → extraction → normalization", () => {
  it("contains five distinct models per category", () => {
    expect(bikes).toHaveLength(15);
    for (const category of ["MTB", "road", "gravel"])
      expect(bikes.filter((b) => b.category === category)).toHaveLength(5);
  });
  for (const bike of bikes)
    it(`${bike.category}: ${bike.query.brand} ${bike.query.model} ${bike.query.trim}`, async () => {
      const { http, calls } = fixtureHttp();
      const adapters = createAdapters(http),
        resolver = new Resolver(
          adapters,
          new MemoryCache(),
          pino({ level: "silent" }),
        );
      let result;
      if (bike.retailer) {
        // Official source first; a store page is offered as a choice and
        // becomes a specification only after that choice.
        const settings = new SettingsStore();
        const stores = createStores(),
          registry = new CandidateRegistry();
        const search = new SourceSearch({
          adapters,
          http,
          manual: new ManualSources(http, adapters, settings, stores),
          settings,
          stores,
          registry,
        });
        const query = { ...bike.query, year: bike.sourceYear };
        const offered = await new SourcePlanner().resolve(query, [
          {
            id: "official",
            kind: "manufacturer",
            resolve: () => resolver.resolve(query),
          },
          {
            id: "stores",
            kind: "store",
            resolve: () => search.stores(query),
          },
        ]);
        expect(offered.status, JSON.stringify(offered)).toBe("ambiguous");
        if (offered.status !== "ambiguous") return;
        const store = offered.candidates.find((c) => c.url === bike.url);
        expect(store, JSON.stringify(offered)).toBeDefined();
        expect(store!.kind).toBe("store");
        expect(store!.storeId).toBe("velosklad");
        result = await search.select(query, store!.candidateId!);
        expect(calls.some((u) => u.includes("velosipedy/poiskall/"))).toBe(
          true,
        );
      } else {
        result = await resolver.resolve(bike.query);
        if (result.status === "ambiguous") {
          const candidate = result.candidates.find((c) => c.url === bike.url);
          expect(candidate, JSON.stringify(result)).toBeDefined();
          result = await resolver.resolve({
            ...bike.query,
            candidateId: candidate!.candidateId,
          });
        }
      }
      expect(result.status, JSON.stringify(result)).toBe("resolved");
      if (result.status !== "resolved") return;
      expect(result.source.url).toBe(bike.url);
      expect(result.sourceYear).toBe(bike.sourceYear);
      expect(result.components.length).toBeGreaterThanOrEqual(15);
      const types = result.components.map((c) => c.type);
      for (const type of [
        "frame",
        "fork",
        "rear_derailleur",
        "saddle",
        "handlebar",
      ])
        expect(types).toContain(type);
      expect(
        types.some((t) => ["brake", "front_brake", "brake_lever"].includes(t)),
      ).toBe(true);
      for (const component of result.components) {
        expect(component.description).not.toMatch(
          /^(Details|Learn more|Read more)$/i,
        );
        expect(component.provenance?.sourceUrl).toBe(bike.url);
      }
      if (bike.sourceYear === null) expect(result.manualSelection).toBe(true);
      if (bike.query.brand === "Cannondale") {
        expect(types).not.toContain("motor");
        expect(types).not.toContain("rear_shock");
        expect(types).not.toContain("wheel");
      }
    });
});

it("rejects a Trek API response for another product before requesting specs", async () => {
  const { http, calls } = fixtureHttp();
  const get = http.get.bind(http);
  http.get = async (...args: Parameters<ManufacturerHttpClient["get"]>) => {
    const doc = await get(...args);
    if (args[0].endsWith("/57365/full")) {
      const body = JSON.parse(doc.body);
      body.code = "57367";
      return { ...doc, body: JSON.stringify(body) };
    }
    return doc;
  };
  const bike = bikes.find((b) => b.id === "marlin6")!;
  const result = await new Resolver(
    createAdapters(http),
    new MemoryCache(),
    pino({ level: "silent" }),
  ).resolve(bike.query);
  expect(result.status).not.toBe("resolved");
  expect(calls.some((u) => u.endsWith("/57365/specifications"))).toBe(false);
});
