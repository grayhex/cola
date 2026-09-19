import { SettingsStore } from "../src/settings.js";
import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { readFileSync } from "node:fs";
import {
  querySchema,
  requestSchema,
  ResolverError,
  type BikeManufacturerAdapter,
  type BikeQuery,
} from "../src/domain.js";
import {
  normalize,
  queryKey,
  normalizeComponent,
  componentType,
} from "../src/normalize.js";
import {
  match,
  scoreCandidate,
  MATCH_THRESHOLD,
  MATCH_MARGIN,
} from "../src/matcher.js";
import {
  validateUrl,
  publicAddress,
  ManufacturerHttpClient,
} from "../src/http.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { createAdapters } from "../src/adapters/index.js";
import { buildApp } from "../src/app.js";
const logger = pino({ level: "silent" });
const q: BikeQuery = { brand: "CUBE", model: "Travel", trim: "SL", year: 2020 };
const candidate = {
  brand: "CUBE",
  canonicalName: "Travel SL",
  year: 2020,
  url: "https://archiv.cube.eu/2020/350600",
};
const parsed = {
  canonicalName: "Travel SL",
  year: 2020,
  rawSpecification: { "REAR HUB": "Shimano Alfine SG-S7001, 11-Speed" },
  components: [
    normalizeComponent("REAR HUB", "Shimano Alfine SG-S7001, 11-Speed"),
  ],
};
function adapter(
  overrides: Partial<BikeManufacturerAdapter> = {},
): BikeManufacturerAdapter {
  return {
    id: "cube",
    brand: "CUBE",
    aliases: [],
    allowedDomains: ["archiv.cube.eu"],
    adapterVersion: 1,
    discover: vi.fn(async () => [candidate]),
    fetch: vi.fn(async () => ({
      url: candidate.url,
      body: "",
      hash: "abc",
      fetchedAt: "2026-09-15T00:00:00Z",
    })),
    parse: vi.fn(async () => parsed),
    ...overrides,
  };
}
it("normalizes case, Unicode, entities and punctuation without losing trim tokens", () => {
  expect(["CUBE", "Cube", "cube"].map(normalize)).toEqual([
    "cube",
    "cube",
    "cube",
  ]);
  expect(normalize("  CF™—SLX  8 AXS &amp; Di2 ")).toBe("cf slx 8 axs di2");
  expect(normalize("S-Works Gen 4 EVO Pro Expert Comp")).toBe(
    "s works gen 4 evo pro expert comp",
  );
  expect(queryKey(q)).toBe(queryKey({ ...q, brand: "cube" }));
});
it("rejects arbitrary URL and extra input fields", () => {
  expect(
    querySchema.safeParse({ ...q, url: "https://localhost" }).success,
  ).toBe(false);
  expect(querySchema.safeParse({ ...q, year: "2020" }).success).toBe(false);
  expect(
    requestSchema.safeParse({ ...q, candidateId: "https://cube.eu" }).success,
  ).toBe(false);
});
it("matches exact trim and year, never adjacent model year", () => {
  expect(scoreCandidate(q, candidate)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  expect(scoreCandidate(q, { ...candidate, canonicalName: "Travel EXC" })).toBe(
    0,
  );
  expect(scoreCandidate(q, { ...candidate, year: 2021 })).toBe(0);
  expect(match(q, [{ ...candidate, year: null }]).chosen).toBeNull();
  expect(MATCH_MARGIN).toBeGreaterThan(0);
});
it("ambiguous without trim or when near-identical candidates tie", () => {
  expect(
    match({ ...q, trim: null }, [
      candidate,
      {
        ...candidate,
        canonicalName: "Travel Pro",
        url: "https://archiv.cube.eu/2020/350200",
      },
    ]).chosen,
  ).toBeNull();
  expect(
    match(q, [candidate, { ...candidate, url: candidate.url + "Z" }]).chosen,
  ).toBeNull();
});
it.each([
  ["REAR HUB", "rear_hub"],
  ["TYRES", "tire"],
  ["SEAT POST", "seatpost"],
  ["BREMSANLAGE", "brake"],
  ["SATTELSTÜTZE", "seatpost"],
])("maps %s", (label, type) => expect(componentType(label)).toBe(type));
it("parses conservative component identity and retains original raw data", () => {
  expect(
    normalizeComponent("REAR HUB", "Shimano Alfine SG-S7001, 11-Speed"),
  ).toMatchObject({
    type: "rear_hub",
    brand: "Shimano",
    family: "Alfine",
    model: "SG-S7001",
    attributes: { speeds: 11 },
    raw: { label: "REAR HUB", value: "Shimano Alfine SG-S7001, 11-Speed" },
  });
  expect(normalizeComponent("KETTE", "Gates CDX, 113T").type).toBe("belt");
  expect(normalizeComponent("Saddle", "Custom saddle").model).toBeUndefined();
});
it.each([
  "http://localhost",
  "http://127.0.0.1",
  "http://169.254.169.254",
  "file:///etc/passwd",
  "ftp://cube.eu/a",
  "https://cube.eu.evil.test",
  "https://evilcube.eu",
  "https://user:pass@cube.eu",
  "https://cube.eu:444",
])("rejects SSRF URL %s", (url) =>
  expect(() => validateUrl(url, ["cube.eu"])).toThrow(),
);
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "172.16.0.1",
  "192.168.1.2",
  "169.254.169.254",
  "0.0.0.0",
  "::1",
  "fe80::1",
  "fc00::1",
  "::ffff:127.0.0.1",
  "224.0.0.1",
])("rejects non-public address %s", (ip) =>
  expect(publicAddress(ip)).toBe(false),
);
it("allows exact official host and public IP", () => {
  expect(validateUrl("https://cube.eu/bikes", ["cube.eu"]).hostname).toBe(
    "cube.eu",
  );
  expect(publicAddress("8.8.8.8")).toBe(true);
});
it("resolved cache hits skip network and version bumps invalidate", async () => {
  const a = adapter(),
    cache = new MemoryCache(),
    r = new Resolver([a], cache, logger);
  expect((await r.resolve(q)).status).toBe("resolved");
  expect((await r.resolve({ ...q, brand: "cube" })).cached).toBe(true);
  expect(a.discover).toHaveBeenCalledTimes(1);
  const newer = adapter({ adapterVersion: 2 });
  await new Resolver([newer], cache, logger).resolve(q);
  expect(newer.discover).toHaveBeenCalledOnce();
});
it("unsupported brand, not found, ambiguity and upstream failure differ", async () => {
  expect(
    (await new Resolver([], new MemoryCache(), logger).resolve(q)).status,
  ).toBe("unsupported_brand");
  expect(
    (
      await new Resolver(
        [adapter({ discover: async () => [] })],
        new MemoryCache(),
        logger,
      ).resolve(q)
    ).status,
  ).toBe("not_found");
  expect(
    (
      await new Resolver(
        [adapter({ discover: async () => [{ ...candidate, year: null }] })],
        new MemoryCache(),
        logger,
      ).resolve(q)
    ).status,
  ).toBe("ambiguous");
  for (const status of ["parse_error", "upstream_unavailable"] as const) {
    const r = new Resolver(
      [
        adapter({
          discover: async () => {
            throw new ResolverError(status, "test");
          },
        }),
      ],
      new MemoryCache(),
      logger,
    );
    expect((await r.resolve(q)).status).toBe(status);
  }
});
it("never negatively caches an upstream or parse failure", async () => {
  const discover = vi.fn(async () => {
    throw new ResolverError("upstream_unavailable", "blocked");
  });
  const r = new Resolver([adapter({ discover })], new MemoryCache(), logger);
  await r.resolve(q);
  await r.resolve(q);
  expect(discover).toHaveBeenCalledTimes(2);
});
it("single-flight coalesces identical concurrent lookups", async () => {
  const a = adapter(),
    r = new Resolver([a], new MemoryCache(), logger);
  await Promise.all([r.resolve(q), r.resolve(q)]);
  expect(a.discover).toHaveBeenCalledOnce();
});
it("explicit candidate selection cannot select an arbitrary URL or wrong-year bike", async () => {
  const a = adapter({
    discover: async () => [
      candidate,
      { ...candidate, url: candidate.url + "Z" },
    ],
  });
  const r = new Resolver([a], new MemoryCache(), logger);
  const result = await r.resolve(q);
  expect(result.status).toBe("ambiguous");
  if (result.status === "ambiguous") {
    expect(
      (await r.resolve({ ...q, candidateId: result.candidates[0].candidateId }))
        .status,
    ).toBe("resolved");
    expect(
      (await r.resolve({ ...q, candidateId: "0".repeat(64) })).status,
    ).toBe("ambiguous");
  }
});
it("API health, readiness, exact ten brands and invalid input", async () => {
  const cache = new MemoryCache(),
    r = new Resolver(
      createAdapters(new ManufacturerHttpClient(logger)),
      cache,
      logger,
    ),
    settings = new SettingsStore();
  settings.value.retailerSearch = false;
  const app = buildApp(r, cache, settings);
  try {
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/ready")).statusCode).toBe(200);
    expect((await app.inject("/v1/brands")).json().brands).toHaveLength(10);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/resolve",
          payload: { ...q, url: "https://localhost" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/resolve",
          payload: { ...q, brand: "Unknown" },
        })
      ).json().status,
    ).toBe("unsupported_brand");
  } finally {
    await app.close();
  }
});
describe("real reduced manufacturer fixtures", () => {
  const adapters = createAdapters(new ManufacturerHttpClient(logger));
  for (const id of [
    "specialized",
    "canyon",
    "giant",
    "cannondale",
    "merida",
    "bmc",
  ])
    it(id + " extracts factory components from captured HTML", async () => {
      const source = JSON.parse(
        readFileSync(
          new URL(`./fixtures/${id}/source.json`, import.meta.url),
          "utf8",
        ),
      );
      const body = readFileSync(
        new URL(`./fixtures/${id}/product.html`, import.meta.url),
        "utf8",
      );
      const p = await adapters
        .find((a) => a.id === id)!
        .parse(
          {
            body,
            url: source.url,
            hash: "fixture",
            fetchedAt: source.retrievedAt,
          },
          q,
        );
      expect(p.components.length).toBeGreaterThan(10);
      expect(p.components.some((c) => c.type === "frame")).toBe(true);
      expect(p.components.every((c) => c.raw.value)).toBe(true);
      if (id === "canyon") expect(p.year).toBe(2026);
      if (id === "specialized") expect(p.year).toBe(2023);
      if (id === "giant") expect(p.year).toBe(2024);
      if (id === "merida" || id === "cannondale" || id === "bmc")
        expect(p.year).toBeNull();
    });
  for (const id of ["cube", "trek", "scott", "orbea"])
    it(
      id + " does not fabricate specs from actual unavailable page",
      async () => {
        const source = JSON.parse(
          readFileSync(
            new URL(`./fixtures/${id}/source.json`, import.meta.url),
            "utf8",
          ),
        );
        const body = readFileSync(
          new URL(`./fixtures/${id}/unavailable.html`, import.meta.url),
          "utf8",
        );
        await expect(
          adapters
            .find((a) => a.id === id)!
            .parse(
              {
                body,
                url: source.url,
                hash: "fixture",
                fetchedAt: source.retrievedAt,
              },
              q,
            ),
        ).rejects.toBeInstanceOf(ResolverError);
      },
    );
});
it("CUBE archive data regression: all required factory parts survive normalization (not a live acceptance test)", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/cube/archive-specification.json", import.meta.url),
      "utf8",
    ),
  );
  const { normalizeSpecification } = await import("../src/normalize.js");
  const parts = normalizeSpecification(fixture.rawSpecification);
  for (const type of [
    "brake",
    "shifter",
    "crankset",
    "rear_sprocket",
    "belt",
    "front_hub",
    "rear_hub",
    "tire",
    "handlebar",
    "seatpost",
    "saddle",
    "headset",
    "pedals",
    "front_light",
    "rear_light",
    "mudguards",
    "rack",
  ])
    expect(
      parts.some((c) => c.type === type),
      type,
    ).toBe(true);
  expect(parts.find((c) => c.type === "rear_hub")?.model).toBe("SG-S7001");
  expect(parts.find((c) => c.type === "brake")?.model).toBe("BR-T8000");
});
it("Giant deterministic discovery resolves a real fixture through HTTP API, then cache", async () => {
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
    get: vi.fn(async (url: string) => {
      expect(url).toBe(source.url);
      return { body, url, hash: "fixture", fetchedAt: source.retrievedAt };
    }),
  } as unknown as ManufacturerHttpClient;
  const cache = new MemoryCache(),
    r = new Resolver(createAdapters(transport), cache, logger),
    settings = new SettingsStore();
  settings.value.retailerSearch = false;
  const app = buildApp(r, cache, settings);
  try {
    for (const cached of [false, true]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/resolve",
        payload: { brand: "Giant", model: "Contend", trim: "AR 1", year: 2024 },
      });
      expect(response.json()).toMatchObject({
        status: "resolved",
        cached,
        bike: { year: 2024 },
        source: { url: source.url },
      });
    }
  } finally {
    await app.close();
  }
});
it("explicit confirmed-year variant can be chosen when trim was omitted", async () => {
  const a = adapter({
    discover: async () => [
      candidate,
      { ...candidate, canonicalName: "Travel Pro", url: candidate.url + "pro" },
    ],
  });
  const r = new Resolver([a], new MemoryCache(), logger);
  const query = { ...q, trim: null };
  const result = await r.resolve(query);
  expect(result.status).toBe("ambiguous");
  if (result.status === "ambiguous") {
    const sl = result.candidates.find((c) => c.canonicalName === "Travel SL")!;
    expect(
      (await r.resolve({ ...query, candidateId: sl.candidateId })).status,
    ).toBe("resolved");
  }
});
it("missing year requires candidate confirmation and never appears as a verified source year", async () => {
  const a = adapter({
    discover: async () => [{ ...candidate, year: null }],
    parse: async () => ({ ...parsed, year: null }),
  });
  const r = new Resolver([a], new MemoryCache(), logger);
  const first = await r.resolve(q);
  expect(first.status).toBe("ambiguous");
  if (first.status === "ambiguous") {
    const confirmed = await r.resolve({
      ...q,
      candidateId: first.candidates[0].candidateId,
    });
    expect(confirmed.status).toBe("resolved");
    if (confirmed.status === "resolved") {
      expect(confirmed.sourceYear).toBeNull();
      expect(confirmed.manualSelection).toBe(true);
      expect(confirmed.bike.canonicalName).not.toContain("2020");
      expect(confirmed.warnings).toContain("identity_mismatch");
    }
  }
});
it("matching tolerates token order without confusing SL and SLX", () => {
  expect(
    scoreCandidate(q, { ...candidate, canonicalName: "SL Travel" }),
  ).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  expect(scoreCandidate(q, { ...candidate, canonicalName: "Travel SLX" })).toBe(
    0,
  );
});
