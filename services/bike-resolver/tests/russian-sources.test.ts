import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters/index.js";
import { createStores } from "../src/stores/index.js";
import { ResolverError, type BikeQuery } from "../src/domain.js";
import {
  normalizeBikeWords,
  requestInName,
  scoreCandidate,
} from "../src/matcher.js";
import { SettingsStore, settingsSchema } from "../src/settings.js";
import {
  splitComponentField,
  absentComponent,
  componentIdentity,
} from "../src/component-identity.js";
import { withResolution } from "../src/context.js";
import { ManualSources } from "../src/manual.js";
import { CandidateRegistry } from "../src/candidate-registry.js";
import { SourceSearch } from "../src/search.js";

import {
  pages,
  page,
  document,
  key,
  RecordedHttp,
} from "./fixtures/russian-recordings.js";
const blank: BikeQuery = {
  brand: "unknown",
  model: "unknown",
  year: null,
  trim: null,
};
const cases: [string, string, string, number | null, number][] = [
  ["trial-sport", "Corratec", "VERT PRO", 2025, 21],
  ["trial-vert-current", "Corratec", "VERT PRO", 2026, 21],
  ["trial-vector", "Outleap", "VECTOR PRO 29", 2026, 21],
  ["velostrana", "Format", "5222 CF", 2023, 23],
  ["velostrana-2022", "Format", "5222 CF", 2022, 22],
  ["velostrana-specialized", "Specialized", "Stumpjumper Evo Comp", 2024, 23],
  ["velodrive-author", "Author", "Compact", 2025, 18],
  ["velodrive-stels", "STELS", "Navigator 900 MD 29", 2024, 12],
  ["alienbike", "Superior", "RR 9.5", 2025, 20],
  ["alienbike-bross", "Bross", "Keystone A3", 2024, 12],
  ["aspect-pro-2025", "ASPECT", "RONIN PRO 29", 2025, 15],
  ["aspect-ronin-2022", "ASPECT", "RONIN", 2022, 12],
  ["aspect-allroad", "ASPECT", "ALLROAD", 2026, 18],
  ["stark-peloton-2025", "STARK", "Peloton 700.4 D", 2025, 17],
  ["stark-peloton-2024", "STARK", "Peloton 700.4 D", 2024, 17],
  ["stark-grl-2025", "STARK", "GRL 700.6 HD", 2025, 17],
  ["welt", "WELT", "G100", 2025, 14],
  ["welt-g90", "WELT", "G90", 2025, 13],
  ["welt-sainty", "WELT", "Sainty 1.0", null, 12],
  ["stels-navigator", "STELS", "Navigator 900 29 MD Z010", null, 15],
  ["stels-pilot", "STELS", "Pilot 710 24", null, 10],
  ["forbike-navigator", "STELS", "Navigator 870 V", 2016, 16],
  ["forbike-pilot", "STELS", "Pilot 710", 2016, 12],
];
async function parse(id: string) {
  const entry = page(id),
    http = new RecordedHttp();
  const parsed = entry.adapter
    ? await createAdapters(http)
        .find((adapter) => adapter.id === entry.adapter)!
        .parse(document(entry), blank)
    : createStores()
        .find((store) => store.id === entry.store)!
        .parse(document(entry), blank);
  expect(http.missing).toEqual([]);
  return parsed;
}

describe("Russian sources: recorded evidence before selectors", () => {
  for (const entry of pages)
    it("provenance: " + entry.id, () => {
      expect(
        createHash("sha256").update(document(entry).body).digest("hex"),
      ).toBe(entry.reducedSha256);
      expect(entry.rawSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.origin.source).toBe("live");
      expect(new Date(entry.retrievedAt).toISOString()).toMatch(/^2026-10-09/);
    });
  for (const [id, brand, model, year, minimum] of cases)
    it("parses the page, not the query: " + id, async () => {
      const parsed = await parse(id);
      expect(parsed.year).toBe(year);
      expect(parsed.components.length).toBeGreaterThanOrEqual(minimum);
      expect(
        requestInName(
          { brand, model, trim: null, year },
          brand + " " + parsed.canonicalName,
        ),
      ).toBe(true);
      for (const component of parsed.components) {
        expect(component.provenance?.sourceUrl).toBe(page(id).url);
        expect(component.raw.value).toBeTruthy();
      }
    });
  for (const id of [
    "trial-frame",
    "velostrana-part",
    "velodrive-part",
    "alienbike-part",
    "stark-frameset",
    "aspect-about",
    "welt-about",
  ])
    it("rejects a non-bicycle: " + id, async () => {
      await expect(parse(id)).rejects.toMatchObject({
        reason: "not_complete_bike",
      });
    });
  it("keeps source contradictions rather than repairing GRX by memory", async () => {
    const parsed = await parse("welt");
    expect(parsed.warnings).toContain("conflicting_sources");
    for (const type of ["rear_derailleur", "front_derailleur", "shifter"])
      expect(
        parsed.components.find((component) => component.type === type)?.raw
          .value,
      ).toContain("RD-RX400");
  });
  it("separates published front/rear hardware and keeps size dependencies", async () => {
    const alien = await parse("alienbike");
    expect(
      alien.components.find((c) => c.type === "front_hub")?.raw.value,
    ).toContain("HB-RS470");
    expect(
      alien.components.find((c) => c.type === "rear_hub")?.raw.value,
    ).toContain("FH-RS470");
    expect(alien.components.some((c) => c.type === "seat_clamp")).toBe(true);
    expect(alien.components.some((c) => c.type === "bar_tape")).toBe(true);
    const aspect = await parse("aspect-pro-2025");
    expect(
      aspect.components.find((c) => c.type === "crankset")?.raw.value,
    ).toContain("М-175 мм, L-175 мм, XL-175 мм");
    expect(aspect.components.find((c) => c.type === "stem")?.raw.value).toMatch(
      /M|L|XL/,
    );
  });
  it("deduplicates desktop/mobile rows but keeps both brakes and the weight's frame size", async () => {
    const parsed = await parse("trial-sport");
    expect(parsed.components.filter((c) => c.type === "fork")).toHaveLength(1);
    expect(
      parsed.components.filter((c) => c.type === "front_brake"),
    ).toHaveLength(1);
    expect(
      parsed.components.filter((c) => c.type === "rear_brake"),
    ).toHaveLength(1);
    expect(parsed.suggestedMetadata?.weightSize).toBeTruthy();
    expect(parsed.suggestedMetadata?.weight).toBeGreaterThan(1);
  });
  it("retains a freewheel and does not invent products from material or a brand alone", async () => {
    const parsed = await parse("velodrive-author");
    expect(
      parsed.components.find((c) => c.type === "freewheel")?.raw.value,
    ).toContain("MF-TZ510");
    expect(
      componentIdentity(parsed.components.find((c) => c.type === "frame")!),
    ).toBeNull();
    expect(
      componentIdentity(parsed.components.find((c) => c.type === "shifter")!),
    ).toBeNull();
    for (const value of [
      "Нет",
      "Не указан",
      "педали не входят",
      "педали не входят в комплект",
    ])
      expect(absentComponent(value)).toBe(true);
    expect(
      splitComponentField("Передняя/задняя втулка", "a / b").map(
        (field) => field.label,
      ),
    ).toEqual(["Передняя втулка", "Задняя втулка"]);
  });
});

function workflow(onlyStores: string[] = []) {
  const http = new RecordedHttp(),
    adapters = createAdapters(http),
    stores = createStores(),
    settings = new SettingsStore();
  for (const id of Object.keys(settings.value.stores))
    settings.value.stores[id as keyof typeof settings.value.stores] =
      onlyStores.includes(id);
  const manual = new ManualSources(http, adapters, settings, stores);
  const registry = new CandidateRegistry();
  const search = new SourceSearch({
    http,
    adapters,
    stores,
    manual,
    settings,
    registry,
  });
  return { http, adapters, stores, settings, manual, search };
}

const discoveries: [string, string, string, number | null][] = [
  ["trial-sport", "Corratec", "VERT PRO", 2025],
  ["velostrana", "Format", "5222 CF", 2023],
  ["velodrive-author", "Author", "Compact", 2025],
  ["neighbor-12", "Superior", "RR 9.5", 2025],
  ["aspect-pro-2025", "ASPECT", "RONIN PRO 29", 2025],
  ["aspect-ronin-2022", "ASPECT", "RONIN", 2022],
  ["stark-peloton-2025", "STARK", "Peloton 700.4 D", 2025],
  ["welt", "WELT", "G100", 2025],
  ["forbike-navigator", "STELS", "Navigator 870 V", 2016],
  ["stels-navigator", "STELS", "Navigator 900 29 MD Z010", null],
];
for (const [id, brand, model, year] of discoveries)
  it("discovery -> selection -> extraction: " + id, async () => {
    const entry = page(id),
      w = workflow(entry.store ? [entry.store] : []);
    const query = { brand, model, year, trim: null };
    await withResolution(AbortSignal.timeout(10000), undefined, async () => {
      const result = await w.search.all(query);
      expect(
        result.status,
        JSON.stringify({ result, missing: w.http.missing }),
      ).toBe("ambiguous");
      if (result.status !== "ambiguous") return;
      const chosen = result.candidates.find(
        (c) =>
          key(c.url).split("?optionId=")[0] ===
          key(entry.url).split("?optionId=")[0],
      );
      expect(chosen, JSON.stringify(result)).toBeTruthy();
      const resolved = await w.search.select(query, chosen!.candidateId!);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      expect(resolved.sourceYear).toBe(year);
      expect(resolved.components.length).toBeGreaterThan(8);
      if (id.startsWith("forbike")) {
        expect(chosen!.kind).toBe("archive");
        expect(resolved.source.kind).toBe("archive");
      }
      expect(w.http.missing).toEqual([]);
    });
  });

it("Russian aliases never merge STARK/STELS or neighboring indexes", () => {
  expect(normalizeBikeWords("Стелс Навигатор 900 29MD Z010")).toBe(
    "stels navigator 900 29 md z010",
  );
  expect(
    requestInName(
      { brand: "Аспект", model: "Ронин", trim: "PRO 29", year: 2025 },
      "ASPECT RONIN PRO 29 2025",
    ),
  ).toBe(true);
  const q = { brand: "STARK", model: "Peloton", trim: "700.4 D", year: 2025 };
  expect(
    scoreCandidate(q, {
      brand: "STELS",
      canonicalName: "Peloton 700.4 D",
      url: "https://stelsbicycle.ru/",
      year: 2025,
    }),
  ).toBe(0);
  for (const canonicalName of [
    "Peloton 700.3 D",
    "Peloton 700.4 V",
    "Peloton 700.4 D PRO",
  ])
    expect(
      scoreCandidate(q, {
        brand: "STARK",
        canonicalName,
        url: "https://stark.ru/",
        year: 2025,
      }),
    ).toBe(0);
});
it("old operator flags survive new source defaults", () => {
  const old = structuredClone(new SettingsStore().value);
  old.stores.velosklad = false;
  old.adapters.giant = false;
  const input = {
    ...old,
    stores: {
      velosklad: false,
      bikeinn: true,
      alltricks: false,
      bike24: false,
    },
    adapters: Object.fromEntries(
      Object.entries(old.adapters).filter(
        ([id]) => !["aspect", "stark", "welt", "stels"].includes(id),
      ),
    ),
  };
  const parsed = settingsSchema.parse(input);
  expect(parsed.stores.velosklad).toBe(false);
  expect(parsed.adapters.giant).toBe(false);
  expect(parsed.stores["trial-sport"]).toBe(true);
  expect(parsed.adapters.stels).toBe(true);
});

it("offers two new stores for a brand without an adapter and keeps their builds separate", async () => {
  const w = workflow(["alienbike", "velodrive"]);
  const query = { brand: "Superior", model: "RR 9.5", trim: null, year: 2025 };
  await withResolution(AbortSignal.timeout(10000), undefined, async () => {
    const result = await w.search.all(query);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(
      new Set(result.candidates.map((c) => c.storeId)),
      JSON.stringify({ result, missing: w.http.missing }),
    ).toEqual(new Set(["alienbike", "velodrive"]));
    expect(new Set(result.candidates.map((c) => c.candidateId)).size).toBe(
      result.candidates.length,
    );
    const before = w.http.requested.length;
    for (const candidate of result.candidates) {
      const chosen = await w.search.select(query, candidate.candidateId!);
      expect(chosen?.status).toBe("resolved");
      if (chosen?.status === "resolved")
        expect(
          chosen.components.every(
            (c) => c.provenance?.sourceUrl === chosen.source.url,
          ),
        ).toBe(true);
    }
    expect(w.http.requested).toHaveLength(before);
    expect(w.http.missing).toEqual([]);
  });
});

it("keeps current STELS pages when Forbike is down", async () => {
  const http = new RecordedHttp();
  const original = http.get.bind(http);
  http.get = async (url, policy) => {
    if (new URL(url).hostname === "forbike.ru")
      throw new ResolverError(
        "upstream_unavailable",
        "Archive unavailable",
        true,
        "http_429",
      );
    return original(url, policy);
  };
  const adapter = createAdapters(http).find((a) => a.id === "stels")!;
  const found = await adapter.discover({
    brand: "STELS",
    model: "Navigator 900",
    trim: "29 MD Z010",
    year: null,
  });
  expect(found.some((c) => c.url === page("stels-navigator").url)).toBe(true);
});

it("caches public indexes across queries but never caches a cancelled load", async () => {
  const { CatalogueIndex } = await import("../src/catalogue-index.js");
  const index = new CatalogueIndex();
  const controller = new AbortController();
  let loads = 0;
  await expect(
    withResolution(controller.signal, undefined, () =>
      index.read("catalogue", async () => {
        loads++;
        controller.abort();
        return [];
      }),
    ),
  ).rejects.toBeDefined();
  await withResolution(new AbortController().signal, undefined, async () => {
    await index.read("catalogue", async () => {
      loads++;
      return [];
    });
    await index.read("catalogue", async () => {
      loads++;
      return [];
    });
  });
  expect(loads).toBe(2);
  const w = workflow(["velostrana"]),
    store = w.stores.find((s) => s.id === "velostrana")!;
  for (const model of ["5222 CF", "Stumpjumper Evo Comp"])
    await store.discover!(
      {
        brand: model === "5222 CF" ? "Format" : "Specialized",
        model,
        year: null,
        trim: null,
      },
      { http: w.http, limit: 2 },
    );
  expect(
    w.http.requested.filter((url) => url.endsWith("ya-sitemap.xml")),
  ).toHaveLength(1);
});

it("keeps the actual fork ahead of general fork classifications and preserves STARK's local labels", async () => {
  const alien = await parse("alienbike");
  expect(alien.components.find((c) => c.type === "fork")?.raw.value).toBe(
    "RR Mid Modulus Carbon Fork, Rake 50mm",
  );
  expect(alien.rawSpecification["Тип вилки"]).toBeTruthy();
  const stark = await parse("stark-peloton-2025");
  expect(stark.components.find((c) => c.type === "fork")?.raw).toEqual({
    label: "Тип вилки",
    value: "Grinz Agger RCR",
  });
  expect(stark.components.find((c) => c.type === "frame")?.raw.label).toBe(
    "Материал рамы",
  );
  const current = await parse("aspect-ronin-pro");
  expect(
    current.components.find((c) => c.type === "crankset")?.raw.value,
  ).toContain("М-165mm, L-170mm, XL-170mm");
  expect(
    (await parse("welt-g90")).components.some(
      (c) => c.type === "front_derailleur",
    ),
  ).toBe(false);
  expect(
    (await parse("forbike-pilot")).components.find(
      (c) => c.type === "rear_sprocket",
    )?.raw.value,
  ).toBe("18Т");
});

it("checks the manifest's published component evidence independently of the request", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest: {
    id: string;
    expected: { componentsContain?: Record<string, string> };
  }[] = JSON.parse(
    readFileSync(
      new URL("./fixtures/russian-sources/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  for (const entry of manifest) {
    if (!entry.expected.componentsContain) continue;
    const parsed = await parse(entry.id);
    for (const [type, text] of Object.entries(entry.expected.componentsContain))
      expect(
        parsed.components.find((c) => c.type === type)?.raw.value,
        entry.id + ": " + type,
      ).toContain(text);
  }
});

it("does not relabel the currently published Outleap as the requested 2025 model", async () => {
  const w = workflow(["trial-sport"]);
  const query = {
    brand: "Outleap",
    model: "VECTOR PRO 29",
    trim: null,
    year: 2025,
  };
  const result = await withResolution(
    AbortSignal.timeout(10000),
    undefined,
    () => w.search.all(query),
  );
  expect(result.status).toBe("ambiguous");
  if (result.status !== "ambiguous") return;
  const current = result.candidates.find(
    (c) => key(c.url) === key(page("trial-vector").url),
  );
  expect(current?.year).toBe(2026);
  expect(current?.warnings).toContain("identity_mismatch");
  expect(
    result.candidates.some(
      (c) => c.year === 2025 && requestInName(query, c.canonicalName),
    ),
  ).toBe(false);
});

for (const [id, brand, model, year] of cases)
  it("discovers the recorded family/year: " + id, async () => {
    const entry = page(id),
      w = workflow(entry.store ? [entry.store] : []);
    const query = { brand, model, year, trim: null };
    const urls = entry.store
      ? await w.stores.find((s) => s.id === entry.store)!.discover!(query, {
          http: w.http,
          limit: 4,
        })
      : (
          await w.adapters.find((a) => a.id === entry.adapter)!.discover(query)
        ).map((c) => c.url);
    const selected = id === "alienbike" ? page("neighbor-12").url : entry.url;
    const identity = (url: string) => key(url).split("?optionId=")[0];
    expect(urls.map(identity), id).toContain(identity(selected));
    expect(w.http.missing).toEqual([]);
  });

it("canonicalizes mirrors and excludes robots-disallowed query parameters without erasing AlienBike variants", () => {
  const stores = createStores();
  expect(
    stores
      .find((s) => s.id === "velostrana")!
      .fetchUrl("http://velostrana.ru/format/5222-cf/?city=1"),
  ).toBe("https://www.velostrana.ru/format/5222-cf/");
  expect(
    stores
      .find((s) => s.id === "velodrive")!
      .fetchUrl(
        "https://velodrive.ru/bicycles/author/author-compact-2025.html?sort=price",
      ),
  ).toBe("https://www.velodrive.ru/bicycles/author/author-compact-2025.html");
  const alien = stores.find((s) => s.id === "alienbike")!;
  expect(
    new URL(alien.fetchUrl(page("alienbike").url)).searchParams.get(
      "product_id",
    ),
  ).toBe("6865");
  expect(alien.productKey(new URL(page("alienbike").url))).not.toBe(
    alien.productKey(new URL(page("neighbor-12").url)),
  );
});

it("keeps ASPECT's readable specification without inventing a year when the separate index fails", async () => {
  const http = new RecordedHttp();
  http.get = async () => {
    throw new ResolverError(
      "upstream_unavailable",
      "Index timeout",
      true,
      "timeout",
    );
  };
  const adapter = createAdapters(http).find((a) => a.id === "aspect")!;
  const result = await adapter.parse(document(page("aspect-pro-2025")), {
    brand: "ASPECT",
    model: "RONIN PRO 29",
    trim: null,
    year: 2030,
  });
  expect(result.components.length).toBeGreaterThan(12);
  expect(result.year).toBeNull();
});
