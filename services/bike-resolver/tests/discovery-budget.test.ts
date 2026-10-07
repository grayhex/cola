import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogueAdapter } from "../src/adapters/base.js";
import { CandidateRegistry } from "../src/candidate-registry.js";
import { ManualSources } from "../src/manual.js";
import { SourceSearch, type Limits } from "../src/search.js";
import { SettingsStore } from "../src/settings.js";
import {
  budgetLeft,
  resolutionContext,
  withinBudget,
  withResolution,
} from "../src/context.js";
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
function shop(
  page: (url: string) => void = () => {},
  options: {
    // Another catalogue, and the year each page states (none: no year on it).
    slugs?: string[];
    year?: (url: string) => number | undefined;
    // As the real client does: a page read once is served again, for no time,
    // to whoever asks for it in the same request.
    memo?: boolean;
  } = {},
) {
  const requested: string[] = [];
  const http = {
    get: vi.fn(async (url: string) => {
      const documents = resolutionContext.getStore()?.documents;
      const shared = JSON.stringify([url, {}]);
      if (options.memo && documents?.has(shared)) return documents.get(shared)!;
      requested.push(url);
      if (url.endsWith("/sitemap.xml"))
        return doc(
          url,
          `<urlset>${(options.slugs ?? slugs).map((s) => `<url><loc>${origin}/p/${s}</loc></url>`).join("")}</urlset>`,
        );
      page(url);
      const year = options.year?.(url);
      const read = doc(
        url,
        `<h1>${nameOf(url)}${year ? " " + year : ""}</h1>${table}`,
      );
      if (options.memo) documents?.set(shared, Promise.resolve(read));
      return read;
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
const searching = (
  http: ManufacturerHttpClient,
  limits: Partial<Limits> = {},
) => {
  const adapter = new Catalogue(http);
  const settings = new SettingsStore();
  settings.value.retailerSearch = false;
  return new SourceSearch({
    adapters: [adapter],
    http,
    manual: new ManualSources(http, [adapter], settings, []),
    settings,
    stores: [],
    registry: new CandidateRegistry(),
    limits,
  });
};

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
  const slow = (ms: number, options: Parameters<typeof shop>[1] = {}) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
    return shop(() => vi.setSystemTime(Date.now() + ms), options);
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

  it("counts the pages it checked, not the pages it planned to check", async () => {
    const { http } = slow(2500);
    const result = await within(() =>
      searching(http, { officialMs: 8000 }).all(ask(null)),
    );
    if (result.status !== "ambiguous") throw Error("expected choices");
    const source = result.search?.sources.find((s) => s.id === "canyon");
    // Two pages were found; the time ran short after the first was verified, and
    // the report must not say two pages were checked.
    expect(result.candidates).toHaveLength(1);
    expect(source).toMatchObject({ status: "ok", pages: 1, candidates: 1 });
    expect(result.search?.complete).toBe(false);
  });

  it("verifies the pages it has already read, however little time is left", async () => {
    // A page costs 2.6 s of 9: discovery reads three and stops with 1.2 s left.
    // The three are in the request's memory, and asking for them costs no time.
    const { http } = slow(2600, { memo: true });
    const result = await within(() =>
      searching(http, { officialMs: 9000 }).all(ask(null)),
    );
    if (result.status !== "ambiguous") throw Error("expected choices");
    expect(result.candidates).toHaveLength(3);
    expect(result.search?.sources[0]).toMatchObject({
      pages: 3,
      candidates: 3,
    });
    // Six pages are in the catalogue and three were read: still a cut.
    expect(result.search?.complete).toBe(false);
  });
});

describe("a request for a year reads on until a page of that year is read", () => {
  // The year of a bike is on its page, not in its address: after the pages a
  // search will verify (six), only reading the next ones can tell the year.
  const pagesOf = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `grail/cf/grail-cf-${i + 1}/${300 + i}`,
    );
  const eighth = (url: string) => (url.endsWith("/307") ? 2023 : 2026);
  const asked = (year: number | null): BikeQuery => ({ ...ask(null), year });
  const verified = async (
    http: ManufacturerHttpClient,
    year: number | null,
  ) => {
    const result = await within(() =>
      searching(http, { officialPages: 6 }).all(asked(year)),
    );
    if (result.status !== "ambiguous") throw Error("expected choices");
    return result;
  };

  it("offers the page of the year that lies behind the pages a search verifies", async () => {
    const { http, pages } = shop(() => {}, {
      slugs: pagesOf(9),
      year: eighth,
    });
    const result = await verified(http, 2023);
    expect(result.candidates[0]).toMatchObject({ year: 2023 });
    expect(result.candidates[0].url).toMatch(/\/307$/);
    // It reads up to that page and no further: the ninth is never asked for.
    expect(new Set(pages()).size).toBe(8);
    // Eight were found, six verified: the list is a cut and says so.
    expect(result.candidates).toHaveLength(6);
    expect(result.search?.complete).toBe(false);
    expect(result.search?.sources[0]).toMatchObject({ pages: 6 });
  });

  it("reads no more than the search verifies when a page of the year is among them", async () => {
    const { http, pages } = shop(() => {}, {
      slugs: pagesOf(9),
      year: eighth,
    });
    const result = await verified(http, 2026);
    expect(result.candidates.every((c) => c.year === 2026)).toBe(true);
    expect(new Set(pages()).size).toBe(6);
  });

  it("reads no more than the search verifies when the pages state no year", async () => {
    const { http, pages } = shop(() => {}, { slugs: pagesOf(9) });
    await verified(http, 2023);
    expect(new Set(pages()).size).toBe(6);
  });

  it("stops at twelve pages when none is of that year, and says the list is a cut", async () => {
    const { http, pages } = shop(() => {}, {
      slugs: pagesOf(14),
      year: () => 2026,
    });
    const result = await verified(http, 2023);
    expect(new Set(pages()).size).toBe(12);
    expect(result.candidates.every((c) => c.year === 2026)).toBe(true);
    expect(result.search?.complete).toBe(false);
  });

  it("looks for the year only in the spare part of the budget, so slow pages do not take it all", async () => {
    // A page costs 1 s of the 12 the source has; reading beyond the six that are
    // verified must leave 5 s unspent: the seventh is read, the eighth is not.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
    const { http, pages } = shop(() => vi.setSystemTime(Date.now() + 1000), {
      slugs: pagesOf(14),
      year: () => 2026,
      memo: true,
    });
    const result = await within(() =>
      searching(http, {
        officialMs: 12000,
        officialPages: 6,
        officialSpareMs: 5000,
      }).all(asked(2023)),
    );
    if (result.status !== "ambiguous") throw Error("expected choices");
    expect(new Set(pages()).size).toBe(7);
    expect(result.candidates).toHaveLength(6);
    expect(result.search?.complete).toBe(false);
  });

  it("discovery gives the caller what it read, and notes the pages it left", async () => {
    const { http, pages } = shop(() => {}, {
      slugs: pagesOf(9),
      year: eighth,
    });
    const notes: Notes = { cut: false };
    const found = await within(() =>
      withinBudget(
        60000,
        () => new Catalogue(http).discover(asked(2023), { pages: 6 }),
        notes,
      ),
    );
    expect(found).toHaveLength(8);
    expect(found.map((c) => c.year).at(-1)).toBe(2023);
    expect(pages()).toHaveLength(8);
    expect(notes.cut).toBe(true);
  });
});
