import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogueAdapter } from "../src/adapters/base.js";
import { CandidateRegistry } from "../src/candidate-registry.js";
import { ManualSources } from "../src/manual.js";
import { SourceSearch } from "../src/search.js";
import { SettingsStore } from "../src/settings.js";
import { budgetLeft, withinBudget, withResolution } from "../src/context.js";
import type { Notes } from "../src/context.js";
import type { BikeQuery } from "../src/domain.js";
import type { ManufacturerHttpClient } from "../src/http.js";

// A catalogue with a sitemap and one page per bike, as the big manufacturers
// have: every page costs seconds, so which pages are read decides the time.
const origin = "https://shop.test";
const slugs = [
  "grail/cf-slx/grail-cf-slx-7-di2/101",
  "grail/cf/grail-cf-7/102",
  "grail/cf-slx/grail-cf-slx-8-axs/103",
  "grail/cfr/grail-cfr-axs/104",
  "grail/cfr/grail-cfr-di2/105",
  "grail/cf/grail-cf-7-speed/106",
];
const nameOf = (url: string) =>
  url
    .split("/")
    .at(-2)!
    .split("-")
    .map((w) => w.toUpperCase())
    .join(" ");
const table =
  "<table><tr><td>Frame</td><td>Carbon</td></tr><tr><td>Fork</td><td>Carbon</td></tr><tr><td>Brakes</td><td>Shimano GRX</td></tr></table>";
class Catalogue extends CatalogueAdapter {
  readonly id = "canyon";
  readonly brand = "Canyon";
  readonly allowedDomains = ["shop.test"];
  readonly origin = origin;
  productPath = /^\/p\/.*\/\d+$/;
  protected seeds() {
    return [origin + "/sitemap.xml"];
  }
}
function shop(page: (url: string) => void = () => {}) {
  const requested: string[] = [];
  const http = {
    get: vi.fn(async (url: string) => {
      requested.push(url);
      if (url.endsWith("/sitemap.xml"))
        return doc(
          url,
          `<urlset>${slugs.map((s) => `<url><loc>${origin}/p/${s}</loc></url>`).join("")}</urlset>`,
        );
      page(url);
      return doc(url, `<h1>${nameOf(url)}</h1>${table}`);
    }),
  } as unknown as ManufacturerHttpClient;
  return {
    http,
    requested,
    pages: () => requested.filter((u) => /\d$/.test(u)),
  };
}
const doc = (url: string, body: string) => ({
  url,
  body,
  hash: url,
  fetchedAt: "2026-10-07T00:00:00.000Z",
});
const ask = (trim: string | null): BikeQuery => ({
  brand: "Canyon",
  model: "Grail",
  trim,
  year: null,
});
const within = <T>(work: () => Promise<T>) =>
  withResolution(new AbortController().signal, undefined, work);

afterEach(() => vi.useRealTimers());

describe("a catalogue reads the pages that can be the request, best first", () => {
  it("reads only the page that carries every word of the trim", async () => {
    const { http, pages } = shop();
    const found = await within(() =>
      new Catalogue(http).discover(ask("SLX AXS")),
    );
    expect(found.map((c) => c.url)).toEqual([
      origin + "/p/grail/cf-slx/grail-cf-slx-8-axs/103",
    ]);
    expect(pages()).toHaveLength(1);
  });

  it("reads the nearest pages first when no page carries the whole trim", async () => {
    const { http, pages } = shop();
    const found = await within(() =>
      new Catalogue(http).discover(ask("SLX 9")),
    );
    // Both SLX pages carry part of the trim; the others carry none of it.
    expect(pages().slice(0, 2)).toEqual([
      origin + "/p/grail/cf-slx/grail-cf-slx-7-di2/101",
      origin + "/p/grail/cf-slx/grail-cf-slx-8-axs/103",
    ]);
    // Nothing is hidden: the other bikes of the model follow as variants.
    expect(found).toHaveLength(slugs.length);
  });

  it("reads every page of the model when the request names no trim", async () => {
    const { http, pages } = shop();
    const found = await within(() => new Catalogue(http).discover(ask(null)));
    expect(found).toHaveLength(slugs.length);
    expect(pages()).toHaveLength(slugs.length);
  });
});

describe("a catalogue reads no more pages than the caller will use", () => {
  it("stops at the page limit and says the list is a cut", async () => {
    const { http, pages } = shop();
    const notes: Notes = { cut: false };
    const found = await within(() =>
      withinBudget(
        60000,
        () => new Catalogue(http).discover(ask(null), { pages: 2 }),
        notes,
      ),
    );
    expect(found).toHaveLength(2);
    expect(pages()).toHaveLength(2);
    expect(notes.cut).toBe(true);
  });

  it("a search asks only for the pages it verifies", async () => {
    const { http, pages } = shop();
    const adapter = new Catalogue(http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [adapter],
      http,
      manual: new ManualSources(http, [adapter], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
      limits: { officialPages: 3 },
    });
    const result = await within(() => search.all(ask(null)));
    if (result.status !== "ambiguous") throw Error("expected choices");
    expect(result.candidates).toHaveLength(3);
    // Three pages, not nine. (The client's request-scoped memo, tested in
    // http.test.ts, serves the second look at each; this fake has none.)
    expect(new Set(pages()).size).toBe(3);
    expect(result.search?.complete).toBe(false);
    expect(result.search?.sources[0]).toMatchObject({ pages: 3 });
  });
});

describe("a phase with little time left keeps what it has read", () => {
  const slow = (ms: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
    return shop(() => vi.setSystemTime(Date.now() + ms));
  };

  it("knows how much of its budget is left", async () => {
    expect(budgetLeft()).toBe(Infinity);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
    await within(() =>
      withinBudget(10000, async () => {
        expect(budgetLeft()).toBe(10000);
        vi.setSystemTime(Date.now() + 4000);
        expect(budgetLeft()).toBe(6000);
        // A narrower budget inside wins; a wider one never extends it.
        await withinBudget(1000, async () => expect(budgetLeft()).toBe(1000));
        await withinBudget(60000, async () => expect(budgetLeft()).toBe(6000));
      }),
    );
  });

  it("returns the pages read so far and says the list is a cut", async () => {
    const { http, pages } = slow(2500);
    const notes: Notes = { cut: false };
    const found = await within(() =>
      withinBudget(8000, () => new Catalogue(http).discover(ask(null)), notes),
    );
    // Every page costs 2.5 s of the 8 s: the loop stops while a page is still
    // affordable, instead of running into the end and losing all of them.
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.length).toBeLessThan(slugs.length);
    expect(pages()).toHaveLength(found.length);
    expect(notes.cut).toBe(true);
  });

  it("a search reports the cut and still offers what was read", async () => {
    const { http } = slow(2500);
    const adapter = new Catalogue(http);
    const settings = new SettingsStore();
    settings.value.retailerSearch = false;
    const search = new SourceSearch({
      adapters: [adapter],
      http,
      manual: new ManualSources(http, [adapter], settings, []),
      settings,
      stores: [],
      registry: new CandidateRegistry(),
      limits: { officialMs: 8000 },
    });
    const result = await within(() => search.all(ask(null)));
    if (result.status !== "ambiguous")
      throw Error("expected choices: " + JSON.stringify(result).slice(0, 300));
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    const source = result.search?.sources.find((s) => s.id === "canyon");
    expect(source?.status).toBe("ok");
    expect(result.search?.complete).toBe(false);
  });
});
