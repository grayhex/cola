import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createStores } from "../src/stores/index.js";
import { ResolverError, type BikeQuery } from "../src/domain.js";
import type { ManufacturerHttpClient } from "../src/http.js";

// Real pages, reduced to the nodes extraction reads. tests/fixtures/stores/
// manifest.json records where each came from: a live request through the
// resolver's own client, or a Common Crawl record for sites that refuse
// automated requests from this network (Cloudflare, Akamai).
const root = new URL("./fixtures/stores/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
interface Entry {
  id: string;
  store: string;
  kind: "bike" | "frameset" | "accessory" | "sitemap";
  requestedUrl: string;
  url: string;
  retrievedAt: string;
  rawSha256: string;
  reducedSha256: string;
  origin: {
    source: string;
    crawl?: string;
    warcFile?: string;
    warcOffset?: number;
  };
  expected?: {
    name?: string;
    year?: number | null;
    productId?: string;
    minComponents?: number;
    types?: string[];
    strategy?: string;
    reason?: string;
  };
}
const manifest: Entry[] = JSON.parse(read("manifest.json"));
const file = (e: Entry) => e.id + (e.kind === "sitemap" ? ".xml" : ".html");
const stores = createStores();
const store = (id: string) => stores.find((s) => s.id === id)!;
const blank: BikeQuery = { brand: "x", model: "y", trim: null, year: null };

describe("store fixtures keep their provenance", () => {
  for (const e of manifest)
    it(e.id, () => {
      expect(
        createHash("sha256")
          .update(read(file(e)))
          .digest("hex"),
      ).toBe(e.reducedSha256);
      expect(e.rawSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(new Date(e.retrievedAt).toISOString().slice(0, 4)).toMatch(/^20/);
      expect(["live", "Common Crawl"]).toContain(e.origin.source);
      if (e.origin.source === "Common Crawl")
        expect(e.origin.warcFile).toMatch(/^crawl-data\/CC-MAIN-/);
    });
  it("covers each store with two bikes of different brands and a negative", () => {
    for (const id of ["bikeinn", "alltricks"]) {
      const own = manifest.filter((e) => e.store === id);
      const bikes = own.filter((e) => e.kind === "bike");
      expect(bikes.length).toBeGreaterThanOrEqual(2);
      expect(
        new Set(
          bikes.map((e) =>
            e
              .expected!.name!.match(
                /\b(WRC|3t|Giant|Scott|Focus|Lapierre|Trek|Orbea|Kona)\b/i,
              )?.[0]
              .toLowerCase(),
          ),
        ).size,
      ).toBeGreaterThanOrEqual(2);
      expect(
        own.some((e) => e.kind === "frameset" || e.kind === "accessory"),
      ).toBe(true);
    }
  });
});

describe("store parsers on recorded pages", () => {
  for (const e of manifest.filter((m) => m.kind !== "sitemap"))
    it(`${e.store}: ${e.id}`, () => {
      const doc = {
        url: e.url,
        body: read(file(e)),
        hash: e.rawSha256,
        fetchedAt: e.retrievedAt,
      };
      const parse = () => store(e.store).parse(doc, blank);
      const want = e.expected!;
      if (want.reason) {
        // A frame or part can list three "components": the store must refuse it.
        try {
          parse();
          throw new Error("accepted a page that is not a complete bicycle");
        } catch (error) {
          expect(error).toBeInstanceOf(ResolverError);
          expect((error as ResolverError).reason).toBe(want.reason);
        }
        return;
      }
      const parsed = parse();
      expect(parsed.canonicalName).toBe(want.name);
      // The year is the page's own claim; none is invented.
      expect(parsed.year).toBe(want.year);
      expect(parsed.manufacturerProductId).toBe(want.productId);
      expect(parsed.components.length).toBeGreaterThanOrEqual(
        want.minComponents!,
      );
      const types = parsed.components.map((c) => c.type);
      for (const type of want.types!) expect(types).toContain(type);
      expect(parsed.quality?.level).toBe("complete");
      expect(parsed.quality?.strategies).toContain(want.strategy);
      for (const c of parsed.components) {
        expect(c.provenance?.sourceUrl).toBe(e.url);
        expect(c.raw.value.length).toBeGreaterThan(0);
        expect(c.description).not.toMatch(/^(Details|Learn more)$/i);
      }
    });
  it("keeps front and rear brake and size-dependent values as published", () => {
    const e = manifest.find((m) => m.id === "bikeinn-3t-exploro")!;
    const parsed = store("bikeinn").parse(
      { url: e.url, body: read(file(e)), hash: "h", fetchedAt: e.retrievedAt },
      blank,
    );
    expect(
      parsed.components.find((c) => c.type === "front_brake")?.raw.label,
    ).toBe("Front Brake");
    expect(
      parsed.components.find((c) => c.type === "rear_brake")?.raw.label,
    ).toBe("Rear Brake");
    expect(
      parsed.components.find((c) => c.type === "stem")?.raw.value,
    ).toContain("Xxs: 70Mm");
  });
  it("recognizes the French labels without guessing a bare «Dérailleur»", () => {
    const e = manifest.find((m) => m.id === "alltricks-kona-rove")!;
    const parsed = store("alltricks").parse(
      { url: e.url, body: read(file(e)), hash: "h", fetchedAt: e.retrievedAt },
      blank,
    );
    const labels = parsed.components.map((c) => c.raw.label);
    expect(labels).toContain("Dérailleur arrière");
    expect(labels).not.toContain("Dérailleur");
    expect(parsed.suggestedMetadata).toMatchObject({
      color: expect.stringContaining("Matte Bloodstone"),
    });
  });
});

describe("store URLs", () => {
  const url = (value: string) => new URL(value);
  it("Bikeinn: one product id across locales, and only the Bikeinn shop", () => {
    const bikeinn = store("bikeinn");
    const en = url(
        "https://www.tradeinn.com/bikeinn/en/wrc-eolian-carbon-grx810-krdrx812-gravel-bike/139992578/p",
      ),
      es = url(
        "https://www.tradeinn.com/bikeinn/es/wrc-bicicleta-de-gravel-eolian-carbon-grx810-krdrx812/139992578/p",
      );
    expect(bikeinn.productKey(en)).toBe("139992578");
    expect(bikeinn.productKey(es)).toBe("139992578");
    expect(bikeinn.fetchUrl(es.href)).toBe(
      "https://www.tradeinn.com/bikeinn/en/product/139992578/p",
    );
    expect(bikeinn.fetchUrl(en.href)).toBe(en.href);
    expect(
      bikeinn.owns(url("https://www.tradeinn.com/trekkinn/en/tent/123456/p")),
    ).toBe(false);
    expect(
      bikeinn.productKey(
        url("https://www.tradeinn.com/bikeinn/en/trek--/1275/m"),
      ),
    ).toBeNull();
    expect(
      bikeinn.owns(url("https://evil.test/bikeinn/en/x/139992578/p")),
    ).toBe(false);
  });
  it("Alltricks: product id from both country sites; BIKE24: /p<id>.html", () => {
    const alltricks = store("alltricks");
    expect(
      alltricks.productKey(
        url(
          "https://www.alltricks.fr/F-41505-velos-route-_-cyclocross-_-triathlon/P-2470911-velo_de_gravel_kona_libre_al_sram_apex_11v_vert",
        ),
      ),
    ).toBe("2470911");
    expect(
      alltricks.productKey(
        url(
          "https://www.alltricks.com/F-41505-velos-route-_-cyclocross-_-triathlon/P-2470911-velo_de_gravel_kona_libre_al_sram_apex_11v_vert",
        ),
      ),
    ).toBe("2470911");
    expect(
      alltricks.productKey(
        url("https://www.alltricks.fr/C-1375894-gravel-bikes"),
      ),
    ).toBeNull();
    expect(
      store("bike24").productKey(url("https://www.bike24.com/p2959759.html")),
    ).toBe("2959759");
    expect(
      store("bike24").productKey(
        url("https://www.bike24.com/cycling/bikes/road-bikes/gravel-bikes"),
      ),
    ).toBeNull();
  });
  it("registry: capabilities are honest", () => {
    expect(stores.map((s) => [s.id, s.search])).toEqual([
      ["velosklad", true],
      ["bikeinn", true],
      ["alltricks", false],
      ["bike24", false],
    ]);
  });
});

describe("Bikeinn discovery reads the public product sitemap", () => {
  const files: Record<string, string> = {
    "https://www.tradeinn.com/bikeinn/sitemaps/sitemap-bikeinn.xml":
      "bikeinn-sitemap-index.xml",
    "https://www.tradeinn.com/bikeinn/sitemaps/sitemap_productos_1_eng_bikeinn.xml":
      "bikeinn-sitemap-products-1.xml",
    "https://www.tradeinn.com/bikeinn/sitemaps/sitemap_productos_2_eng_bikeinn.xml":
      "bikeinn-sitemap-products-2.xml",
  };
  function fake(failFirst = false) {
    const calls: string[] = [];
    let failed = !failFirst;
    const http = {
      get: async (url: string) => {
        calls.push(url);
        if (!failed) {
          failed = true;
          throw new ResolverError(
            "upstream_unavailable",
            "Fixture outage",
            true,
            "timeout",
          );
        }
        if (!files[url]) throw new Error("Unrecorded sitemap " + url);
        return {
          url,
          body: read(files[url]),
          hash: "h",
          fetchedAt: "2026-10-07T00:00:00Z",
        };
      },
    } as unknown as ManufacturerHttpClient;
    return { http, calls };
  }
  const bikeinn = () => createStores().find((s) => s.id === "bikeinn")!;
  it("finds the Giant Revolt 2 page and lists only bicycles, never frames", async () => {
    const { http } = fake();
    const urls = await bikeinn().discover!(
      { brand: "Giant", model: "Revolt", trim: "2", year: 2026 },
      { http, limit: 4 },
    );
    expect(urls[0]).toContain(
      "/giant-revolt-2-cues-u4020-2026-gravel-bike/142587127/p",
    );
    expect(urls.length).toBeLessThanOrEqual(4);
    const frames = await bikeinn().discover!(
      { brand: "Ritchey", model: "Montebello", trim: null, year: null },
      { http, limit: 4 },
    );
    expect(frames).toEqual([]);
  });
  it("offers a near miss for an LTD request without pretending it is the LTD", async () => {
    const { http } = fake();
    const urls = await bikeinn().discover!(
      { brand: "Focus", model: "Atlas 6", trim: "LTD", year: null },
      { http, limit: 4 },
    );
    expect(
      urls.some((u) => u.includes("focus-atlas-6.7-cues-gravel-bike")),
    ).toBe(true);
    expect(urls.every((u) => !/ltd/i.test(u))).toBe(true);
  });
  it("answers nothing for a brand the shop does not list", async () => {
    const { http } = fake();
    expect(
      await bikeinn().discover!(
        { brand: "Canyon", model: "Grail", trim: "SLX AXS", year: null },
        { http, limit: 4 },
      ),
    ).toEqual([]);
  });
  it("loads the sitemap once, and does not remember a failed load", async () => {
    const { http, calls } = fake(true);
    const store = bikeinn(),
      query = { brand: "Scott", model: "Addict", trim: null, year: null };
    await expect(store.discover!(query, { http, limit: 3 })).rejects.toThrow();
    const first = await store.discover!(query, { http, limit: 3 });
    const loaded = calls.length;
    const second = await store.discover!(query, { http, limit: 3 });
    expect(second).toEqual(first);
    expect(first.some((u) => u.includes("scott-addict-rc-20"))).toBe(true);
    expect(calls.length).toBe(loaded);
  });
});
