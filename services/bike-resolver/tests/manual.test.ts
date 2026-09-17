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
    settings.value.blockedDomains=['evil.example'];
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
});
