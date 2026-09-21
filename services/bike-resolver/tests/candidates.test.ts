import { describe, it, expect } from "vitest";
import { partialScore, findCandidates } from "../src/candidates.js";
import { ManualSources } from "../src/manual.js";
import { SettingsStore } from "../src/settings.js";
import type { ManufacturerHttpClient } from "../src/http.js";
import type { BikeManufacturerAdapter } from "../src/domain.js";
const query = { brand: "Giant", model: "Contend AR", trim: "1", year: 2024 };
describe("explicit candidate choice", () => {
  it("ranks partial models without treating a different brand or unrelated model as a match", () => {
    expect(partialScore(query, "Giant Contend AR 2", 2023)).toBeGreaterThan(0);
    expect(partialScore(query, "Giant Contend AR 1", 2024)).toBeGreaterThan(
      partialScore(query, "Giant Contend AR 2", 2023),
    );
    expect(partialScore(query, "Other Contend AR", 2024)).toBe(0);
    expect(partialScore(query, "Giant Trance", 2024)).toBe(0);
  });
  it("returns several parsable manufacturer/store pages with thumbnails, and never returns a snippet or unrelated product", async () => {
    const store = new SettingsStore();
    const docs: Record<string, string> = {
      "https://www.giant-bicycles.com/a": "Contend AR 1",
      "https://shop.example.test/b": "Giant Contend AR 2",
      "https://shop.example.test/c": "Other Bicycle",
      "https://shop.example.test/empty": "Giant Contend AR",
    };
    const http = {
      get: async (url: string) => ({
        url,
        hash: url,
        fetchedAt: new Date().toISOString(),
        body: url.includes("bing.com")
          ? `<rss><channel>${Object.keys(docs)
              .slice(1)
              .map(
                (url) =>
                  `<item><title>Contend AR</title><link>${url}</link></item>`,
              )
              .join("")}</channel></rss>`
          : url.endsWith("empty")
            ? "<h1>No specs</h1>"
            : `<h1>${docs[url]}</h1><meta property="og:image" content="https://images.example.test/bike.png"><table><tr><td>Frame</td><td>Aluminum</td></tr><tr><td>Fork</td><td>Carbon</td></tr><tr><td>Brakes</td><td>Shimano</td></tr></table>`,
      }),
    } as ManufacturerHttpClient;
    const adapter = {
      id: "giant",
      brand: "Giant",
      aliases: [],
      allowedDomains: ["www.giant-bicycles.com"],
      adapterVersion: 1,
      discover: async () => [
        {
          brand: "Giant",
          canonicalName: "Contend AR 1",
          url: "https://www.giant-bicycles.com/a",
          year: 2024,
        },
      ],
      parse: async () => ({
        canonicalName: "Contend AR 1",
        year: 2024,
        rawSpecification: {},
        components: [
          {
            type: "frame",
            description: "Frame",
            attributes: {},
            raw: { label: "Frame", value: "Aluminum" },
          },
          {
            type: "fork",
            description: "Fork",
            attributes: {},
            raw: { label: "Fork", value: "Carbon" },
          },
          {
            type: "brake",
            description: "Brake",
            attributes: {},
            raw: { label: "Brake", value: "Shimano" },
          },
        ],
      }),
    } as unknown as BikeManufacturerAdapter;
    const manual = new ManualSources(http, [adapter], store);
    const result = await findCandidates(query, [adapter], http, manual, store);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") throw Error("No candidates");
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.every(
        (c) => c.selectable && c.thumbnailId && c.sourceHost,
      ),
    ).toBe(true);
    expect(result.candidates.map((c) => c.url)).toContain(
      "https://shop.example.test/b",
    );
  });
});
