import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocument } from "../src/extract.js";
import { identityConflict } from "../src/identity.js";
import { RetailerSearch, searchLinks } from "../src/retailer-search.js";
import { SettingsStore } from "../src/settings.js";
const query = {
  brand: "Specialized",
  model: "Stumpjumper",
  trim: "EVO Comp",
  year: 2024,
};
for (const [name, host, count, year] of [
  ["velostrana", "www.velostrana.ru", 23, 2024],
  ["specialized", "www.specialized.com", 25, 2023],
] as const) {
  it(`extracts all ${name} components from a real specification fragment`, () => {
    const parsed = parseDocument({
      url: `https://${host}/product`,
      body: readFileSync(
        new URL(`./fixtures/refinement/${name}.html`, import.meta.url),
        "utf8",
      ),
      hash: "fixture",
      fetchedAt: "2026-09-19",
    });
    expect(parsed.components.length).toBeGreaterThanOrEqual(count);
    expect(parsed.year).toBe(year);
    for (const type of [
      "fork",
      "rear_derailleur",
      "front_brake",
      "rear_brake",
      "saddle",
      "handlebar",
    ])
      expect(parsed.components.some((c) => c.type === type)).toBe(true);
    expect(JSON.stringify(parsed.rawSpecification)).not.toContain("Закрыть");
  });
}
it("asks for explicit identity conflicts but not merely an unknown year", () => {
  expect(
    identityConflict(query, "Specialized Stumpjumper EVO Comp", null),
  ).toBe(false);
  expect(
    identityConflict(query, "Specialized Stumpjumper EVO Comp", 2023),
  ).toBe(true);
  expect(
    identityConflict(query, "Specialized Stumpjumper EVO Expert", 2024),
  ).toBe(true);
});
it("bounds and deduplicates public search links", () => {
  expect(
    searchLinks(
      "<rss><channel><item><link>https://shop.test/a?a=1&amp;b=2</link></item><item><link>https://shop.test/a?a=1&amp;b=2</link></item></channel></rss>",
    ),
  ).toEqual(["https://shop.test/a?a=1&b=2"]);
});
it("searches once, verifies product identity, skips blocked sources and reuses discovery cache", async () => {
  let searches = 0,
    products = 0;
  const settings = new SettingsStore();
  settings.value.blockedDomains = ["blocked.test"];
  const http = {
    get: async () => {
      searches++;
      return {
        body: "<rss><channel><item><link>https://blocked.test/bike</link></item><item><link>https://shop.test/bike</link></item></channel></rss>",
      };
    },
  };
  let year = 2023;
  const manual = {
    resolve: async () => {
      products++;
      return {
        status: "resolved",
        sourceYear: year,
        bike: { canonicalName: "Specialized Stumpjumper EVO Comp" },
        source: {},
        warnings: [],
      };
    },
  };
  const service = new RetailerSearch(http as any, manual as any, settings);
  expect((await service.resolve(query)).status).toBe("not_found");
  year = 2024;
  const result = await service.resolve(query);
  expect(result.status).toBe("resolved");
  expect(searches).toBe(1);
  expect(products).toBe(2);
  expect((result as any).manualSelection).toBe(false);
});
