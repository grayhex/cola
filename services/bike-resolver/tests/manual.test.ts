import { describe, it, expect } from "vitest";
import {
  ManualSources,
  extractImages,
  parseCubePayload,
} from "../src/manual.js";
import { SettingsStore } from "../src/settings.js";
import type { ManufacturerHttpClient } from "../src/http.js";
const query = { brand: "Giant", model: "Tourer", trim: "GTS", year: 2024 };
const url =
  "https://www.velo-port.ru/catalog/gorodskie/velosiped_giant_tourer_gts/";
// Synthetic semantic rows using public retailer terminology; not a captured HTML fixture.
const body =
  '<h1>GIANT Tourer GTS</h1><meta property="og:image" content="/bike.jpg"><table><tr><td>Рама</td><td>Giant AluxX</td></tr><tr><td>Вилка</td><td>SR Suntour CR-8V</td></tr><tr><td>Задняя втулка</td><td>Shimano Nexus SG-C6001-8</td></tr></table>';
const doc = { url, body, hash: "fixture", fetchedAt: "2026-09-16T00:00:00Z" };
const client = {
  get: async () => doc,
  getBytes: async () => ({
    bytes: Buffer.from("fake"),
    contentType: "image/svg+xml",
  }),
} as unknown as ManufacturerHttpClient;
describe("a pasted page of the brand's own site", () => {
  const table =
    "<table><tr><td>Frame</td><td>Carbon</td></tr><tr><td>Fork</td><td>Carbon</td></tr><tr><td>Brakes</td><td>Shimano GRX</td></tr></table>";
  const resolve = (
    pageUrl: string,
    heading: string,
    q: { brand: string; model: string; trim: string | null },
  ) =>
    new ManualSources(
      {
        get: async () => ({
          url: pageUrl,
          body: `<h1>${heading}</h1>${table}`,
          hash: "fixture",
          fetchedAt: "2026-10-07T00:00:00Z",
        }),
      } as unknown as ManufacturerHttpClient,
      [],
      new SettingsStore(),
    ).resolve({ ...q, year: null }, pageUrl);
  const warnings = async (...args: Parameters<typeof resolve>) => {
    const result = await resolve(...args);
    if (result.status !== "resolved") throw Error("expected a result");
    return result.warnings;
  };
  const propain = {
    brand: "Propain",
    model: "Terrel CF",
    trim: null,
  };
  it("names the bike without the brand, as an official page does", async () => {
    expect(
      await warnings(
        "https://www.propain-bikes.com/us/product/bikes/gravel/terrel-cf/",
        "TERREL CF",
        propain,
      ),
    ).not.toContain("identity_mismatch");
  });
  it("still says when the page is another bike or lacks the requested trim", async () => {
    const page = "https://www.propain-bikes.com/us/product/bikes/gravel/x/";
    expect(await warnings(page, "TYEE CF", propain)).toContain(
      "identity_mismatch",
    );
    expect(
      await warnings(page, "TERREL CF", { ...propain, trim: "Adventure" }),
    ).toContain("identity_mismatch");
  });
  it("is not a licence for a shop's page that names no brand", async () => {
    expect(
      await warnings(
        "https://www.somebikeshop.test/p/terrel-cf",
        "TERREL CF",
        propain,
      ),
    ).toContain("identity_mismatch");
  });
});

describe("manual sources", () => {
  it("extracts Russian components and keeps manual identity unverified", async () => {
    const result = await new ManualSources(
      client,
      [],
      new SettingsStore(),
    ).resolve(query, url);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.confidence).toBe(0);
      expect(result.manualSelection).toBe(true);
      expect(result.components.map((c) => c.type)).toEqual([
        "frame",
        "fork",
        "rear_hub",
      ]);
      expect(result.source.url).toBe(url);
    }
  });
  it("rejects blocked URLs and private destinations before transport and honours service disable", async () => {
    const settings = new SettingsStore(),
      manual = new ManualSources(client, [], settings);
    settings.value.blockedDomains = ["evil.example"];
    for (const bad of [
      "http://127.0.0.1/",
      "file:///etc/passwd",
      "https://evil.example/",
      "https://www.velo-port.ru:8080/",
      "https://user:pass@www.velo-port.ru/",
    ])
      expect((await manual.resolve(query, bad)).status).toBe(
        "upstream_unavailable",
      );
    settings.value.enabled = false;
    expect((await manual.resolve(query, url)).status).toBe(
      "upstream_unavailable",
    );
  });
  it("returns bounded deduplicated source images and rejects SVG downloads and unknown tokens", async () => {
    expect(extractImages(doc)).toEqual(["https://www.velo-port.ru/bike.jpg"]);
    const manual = new ManualSources(client, [], new SettingsStore());
    const data = await manual.search(query, url);
    expect(data.photos).toHaveLength(1);
    expect(data.photos[0].sourceUrl).toBe(url);
    await expect(manual.photo(data.photos[0].id)).rejects.toThrow(
      "Unsupported image",
    );
    await expect(manual.photo("no-token")).rejects.toThrow("Search expired");
  });
  it("parses portal dictionary in English without inventing missing fields", () => {
    const features = ["FRAME", "FORK", "BRAKE SYSTEM"].map(
      (description, i) => ({
        productFeatureId: i,
        languageData: [{ languageId: 2, description }],
      }),
    );
    const product = {
      mainId: 350600,
      description: "Travel SL",
      specs: ["Aluminium", "Rigid fork", "Shimano XT BR-T8000"].map(
        (value, i) => ({
          productSpecTypeId: i,
          languageData: [{ languageId: 2, productSpecValueDescription: value }],
        }),
      ),
    };
    const parsed = parseCubePayload(product, features);
    expect(parsed.components).toHaveLength(3);
    expect(parsed.year).toBeNull();
    expect(parsed.components[2].model).toBe("BR-T8000");
    expect(() =>
      parseCubePayload({ ...product, specs: [] }, features),
    ).toThrow();
  });
  it("ignores malformed CUBE rows and rejects an invalid top-level payload", () => {
    const features = [
      null,
      false,
      ...["FRAME", "FORK", "BRAKE SYSTEM"].map((description, i) => ({
        productFeatureId: i,
        languageData: [null, { languageId: 2, description }],
      })),
    ];
    const product = {
      mainId: 350600,
      description: "Travel SL",
      specs: [
        null,
        false,
        ...["Aluminium", "Rigid fork", "Shimano XT BR-T8000"].map(
          (value, i) => ({
            productSpecTypeId: i,
            languageData: [
              null,
              { languageId: 2, productSpecValueDescription: value },
            ],
          }),
        ),
      ],
    };
    expect(parseCubePayload(product, features).components).toHaveLength(3);
    for (const payload of [null, [], false, "invalid"])
      expect(() => parseCubePayload(payload, features)).toThrow(
        "format changed",
      );
    expect(() => parseCubePayload(product, {})).toThrow("format changed");
    expect(() =>
      parseCubePayload({ ...product, mainId: {} }, features),
    ).toThrow("format changed");
    expect(() =>
      parseCubePayload({ ...product, description: [] }, features),
    ).toThrow("format changed");
  });
});
