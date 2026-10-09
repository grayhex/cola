import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { createAdapters } from "../src/adapters/index.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { SettingsStore } from "../src/settings.js";
import { abortable, checkAbort, resolutionContext } from "../src/context.js";
import { ResolverError } from "../src/domain.js";
import type { ManufacturerHttpClient } from "../src/http.js";

// Reddit 10: ten bikes from a week of r/gravelcycling, asked of the resolver as
// a rider asks them. The discussion is only where the request comes from, never
// the reference for a factory build. Every page the flows read is a recording of
// the live site (tests/fixtures/reddit10/pages.json: date, SHA-256 of the whole
// page, what was kept). The test replays discovery → choice → extraction →
// normalization through the service's own HTTP interface and fails when a flow
// asks for a page nobody recorded.
const root = new URL("./fixtures/reddit10/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
interface Page {
  id: string;
  kind: string;
  requestedUrl: string;
  url: string;
  retrievedAt: string;
  rawSha256: string;
  rawBytes: number;
}
interface Component {
  type: string;
  contains: string;
}
interface Bike {
  n: number;
  id: string;
  query: string;
  reddit: { url: string; postedAt: string | null; dateStatus: string };
  normalized: {
    brand: string;
    model: string;
    trim: string | null;
    year: number | null;
  };
  chosen: { url: string } | null;
  manualUrl: { url: string } | null;
  confirmation: {
    year: { value: number | null; evidence: string };
    trim: { requested: string | null; evidence: string };
  };
  expect: {
    outcome:
      "identified" | "parsed_unconfirmed" | "alternatives_only" | "not_found";
    discovery: {
      status: string;
      complete: boolean;
      sources: Record<string, string>;
      candidates: {
        url: string;
        name: string;
        year: number | null;
        kind: string;
        storeId?: string;
        warnings: string[];
      }[];
    };
    chosen?: {
      year: number | null;
      minComponents: number;
      components: Component[];
      warnings: string[];
      sourceKind: string;
    };
    manual?: {
      status: string;
      reason?: string;
      minComponents?: number;
      warnings?: string[];
    };
  };
  // The recorded pages (ids of pages.json) the whole flow reads: nothing else.
  pages: string[];
}
const pages: Page[] = JSON.parse(read("pages.json"));
const bikes: Bike[] = JSON.parse(read("manifest.json")).bikes;
const fileOf = (page: Page) =>
  [".xml", ".html"]
    .map((extension) => page.id + extension)
    .find((file) => existsSync(new URL(file, root)))!;

const canonical = (input: string) => {
  const url = new URL(input);
  url.searchParams.sort();
  return url.href;
};
const recorded = new Map<string, Page>();
for (const page of pages)
  for (const url of [page.requestedUrl, page.url])
    recorded.set(canonical(url), page);

function recordedWeb(delayMs = 0) {
  const requested: string[] = [];
  const unrecorded: string[] = [];
  const http = {
    get: vi.fn(async (input: string) => {
      // As the real client does: a request that is cancelled asks for nothing.
      checkAbort();
      requested.push(input);
      if (delayMs)
        await abortable(
          new Promise((resolve) => setTimeout(resolve, delayMs)),
          resolutionContext.getStore()?.signal,
        );
      const page = recorded.get(canonical(input));
      if (!page) {
        unrecorded.push(input);
        throw new ResolverError(
          "upstream_unavailable",
          "Not recorded: " + input,
          false,
          "http_404",
        );
      }
      return {
        url: page.url,
        body: read(fileOf(page)),
        hash: page.rawSha256,
        fetchedAt: page.retrievedAt,
      };
    }),
  } as unknown as ManufacturerHttpClient;
  return { http, requested, unrecorded };
}
function service(delayMs = 0) {
  const web = recordedWeb(delayMs);
  const settings = new SettingsStore();
  // Replay the source set captured by this dated benchmark. New sources have
  // their own live capture/replay matrix in russian-sources.test.ts.
  for (const id of [
    "trial-sport",
    "velostrana",
    "velodrive",
    "alienbike",
  ] as const)
    settings.value.stores[id] = false;
  const cache = new MemoryCache();
  const logger = pino({ level: "silent" });
  const app = buildApp(
    new Resolver(createAdapters(web.http), cache, logger),
    cache,
    settings,
    web.http,
  );
  return { ...web, app };
}
interface Answer {
  status: string;
  reason?: string;
  candidates?: {
    candidateId: string;
    kind: string;
    storeId?: string;
    canonicalName: string;
    year: number | null;
    url: string;
    warnings?: string[];
  }[];
  components?: { type: string; description: string; raw?: { value: string } }[];
  sourceYear?: number | null;
  warnings?: string[];
  source?: { url: string; kind?: string };
  search?: { complete: boolean; sources: { id: string; status: string }[] };
}

describe("Reddit 10", () => {
  let results: Record<
    number,
    {
      first: Answer;
      chosen?: Answer;
      manual?: Answer;
      read: string[];
      unrecorded: string[];
    }
  >;
  beforeAll(async () => {
    vi.stubEnv("LOG_LEVEL", "silent");
    results = {};
    for (const bike of bikes) {
      const { app, requested, unrecorded } = service();
      const post = async (url: string, payload: object): Promise<Answer> =>
        (await app.inject({ method: "POST", url, payload })).json();
      const first = await post("/v1/resolve", {
        ...bike.normalized,
        chooseCandidates: true,
      });
      const pick = bike.chosen
        ? first.candidates?.find((c) => c.url === bike.chosen!.url)
        : undefined;
      results[bike.n] = {
        first,
        chosen: pick
          ? await post("/v1/resolve", {
              ...bike.normalized,
              candidateId: pick.candidateId,
            })
          : undefined,
        manual: bike.manualUrl
          ? await post("/v1/resolve-url", {
              ...bike.normalized,
              sourceUrl: bike.manualUrl.url,
            })
          : undefined,
        read: [...new Set(requested.map(canonical))],
        unrecorded,
      };
      await app.close();
    }
    // REDDIT10_DUMP=file.json writes what every flow answered, to write down
    // the expectations of freshly recorded pages.
    if (process.env.REDDIT10_DUMP)
      writeFileSync(
        process.env.REDDIT10_DUMP,
        JSON.stringify(results, null, 1),
      );
  });
  afterAll(() => vi.unstubAllEnvs());

  it("holds ten bikes of the issue's table, each with its source and provenance", () => {
    expect(bikes.map((b) => b.query)).toEqual([
      "Propain Terrel CF",
      "Van Rysel GRVL AF Shimano GRX 2x12",
      "Focus Atlas 6 LTD",
      "Canyon Grail SLX AXS",
      "Lauf Seigla Core Transmission",
      "Giant Revolt 2",
      "Canyon Grizl CF SLX 8",
      "Canyon Grizl CF SL 6 2023",
      "3T Ultra Apex/Eagle 1x12 700c 2025",
      "Ari Shafer CUES 1x11 2026",
    ]);
    for (const bike of bikes) {
      expect(bike.reddit.url).toMatch(
        /^https:\/\/www\.reddit\.com\/r\/gravelcycling\/comments\/[a-z0-9]+\//,
      );
      // The date is the post's own metadata or an honest «not retrieved»;
      // the date of the issue or of the run is never put in its place.
      expect(bike.reddit.postedAt).toBeNull();
      expect(bike.reddit.dateStatus).toMatch(/^not retrieved/);
      expect(bike.confirmation.year.evidence).toBeTruthy();
      expect(bike.confirmation.trim.evidence).toBeTruthy();
    }
    // Every recorded page belongs to a bike's flow.
    expect(new Set(bikes.flatMap((b) => b.pages))).toEqual(
      new Set(pages.map((p) => p.id)),
    );
    for (const page of pages) {
      expect(page.rawSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(page.retrievedAt).toMatch(/^2026-10-07T/);
      expect(existsSync(new URL(fileOf(page), root))).toBe(true);
    }
  });

  for (const bike of bikes)
    describe(`${bike.n}. ${bike.query}`, () => {
      const result = () => results[bike.n];

      it("reads the pages the manifest lists, all recorded, and none besides", () => {
        expect(result().unrecorded).toEqual([]);
        const listed = bike.pages.map((id) => {
          const page = pages.find((p) => p.id === id);
          expect(page, id).toBeDefined();
          return canonical(page!.requestedUrl);
        });
        expect(result().read.sort()).toEqual(listed.sort());
      });

      it("offers what the sources offer, flagged where it is not the bike asked for", () => {
        const { first } = result(),
          want = bike.expect.discovery;
        expect(first.status).toBe(want.status);
        expect(first.search?.complete).toBe(want.complete);
        for (const [id, status] of Object.entries(want.sources))
          expect(
            first.search?.sources.find((s) => s.id === id)?.status,
            id,
          ).toBe(status);
        const offered = (first.candidates ?? []).map((c) => ({
          url: c.url,
          name: c.canonicalName,
          year: c.year,
          kind: c.kind,
          ...(c.storeId ? { storeId: c.storeId } : {}),
          warnings: [...(c.warnings ?? [])].sort(),
        }));
        expect(offered).toEqual(
          want.candidates.map((c) => ({
            ...c,
            warnings: [...c.warnings].sort(),
          })),
        );
      });

      if (bike.expect.chosen) {
        const want = bike.expect.chosen;
        it("reads exactly the chosen page, with its own year, parts and honest warnings", () => {
          const chosen = result().chosen;
          expect(chosen?.status).toBe("resolved");
          expect(chosen?.source?.url).toBe(bike.chosen!.url);
          expect(chosen?.source?.kind).toBe(want.sourceKind);
          expect(chosen?.sourceYear).toBe(want.year);
          expect(chosen?.components?.length).toBeGreaterThanOrEqual(
            want.minComponents,
          );
          expect([...(chosen?.warnings ?? [])].sort()).toEqual(
            [...want.warnings].sort(),
          );
          for (const { type, contains } of want.components) {
            const component = chosen?.components?.find((c) => c.type === type);
            expect(component, type).toBeDefined();
            expect(
              (
                component?.raw?.value ??
                component?.description ??
                ""
              ).toLowerCase(),
              type,
            ).toContain(contains.toLowerCase());
          }
        });
        it("takes every expected part from the recorded page itself", () => {
          const page = pages.find(
            (p) => canonical(p.requestedUrl) === canonical(bike.chosen!.url),
          )!;
          const text = read(fileOf(page))
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .toLowerCase();
          for (const { contains } of want.components)
            expect(text, contains).toContain(contains.toLowerCase());
        });
      } else
        it("reads no page by itself: nothing was chosen", () => {
          expect(result().chosen).toBeUndefined();
        });

      if (bike.expect.manual) {
        const want = bike.expect.manual;
        it("a pasted address is read as the person's own choice", () => {
          const manual = result().manual;
          expect(manual?.status).toBe(want.status);
          if (want.reason) expect(manual?.reason).toBe(want.reason);
          if (want.minComponents)
            expect(manual?.components?.length).toBeGreaterThanOrEqual(
              want.minComponents,
            );
          if (want.warnings)
            expect([...(manual?.warnings ?? [])].sort()).toEqual(
              [...want.warnings].sort(),
            );
          expect(manual?.source?.kind ?? "manual").toBe("manual");
        });
      }

      it(`is classed ${bike.expect.outcome}, and only a chosen, parsed, confirmed bike counts as identified`, () => {
        const { first, chosen } = result();
        const outcome =
          chosen?.status === "resolved"
            ? chosen.warnings?.includes("identity_mismatch")
              ? "parsed_unconfirmed"
              : "identified"
            : first.status === "ambiguous"
              ? "alternatives_only"
              : "not_found";
        expect(outcome).toBe(bike.expect.outcome);
      });
    });
});

describe("Reddit 10 as a stream, and abandoned", () => {
  const bike = (n: number) => bikes.find((b) => b.n === n)!;
  interface Line {
    type: string;
    event?: string;
    result?: Answer;
  }
  const lines = async (address: string, payload: object) => {
    const response = await fetch(address + "/v1/resolve/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
    return (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Line);
  };

  it("streams the search as lines, ends with the choices, and reads the chosen page without asking anyone again", async () => {
    const { app, requested } = service();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const four = bike(4);
      const offered = await lines(address, {
        ...four.normalized,
        chooseCandidates: true,
      });
      const events = offered.filter((l) => l.type === "event");
      expect(events.length).toBeGreaterThan(0);
      // The browser proxy refuses long streams: the trace stays short.
      expect(offered.length).toBeLessThan(60);
      const last = offered.at(-1)!;
      expect(last.type).toBe("result");
      expect(last.result?.status).toBe("ambiguous");
      expect(last.result?.candidates?.map((c) => c.url)).toEqual(
        four.expect.discovery.candidates.map((c) => c.url),
      );
      const asked = requested.length;
      const pick = last.result!.candidates!.find(
        (c) => c.url === four.chosen!.url,
      )!;
      const chosen = await lines(address, {
        ...four.normalized,
        candidateId: pick.candidateId,
      });
      expect(chosen.at(-1)?.result?.status).toBe("resolved");
      expect(chosen.at(-1)?.result?.source?.url).toBe(four.chosen!.url);
      // The page was read while searching: choosing it asks nobody again.
      expect(requested.length).toBe(asked);
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });

  it("a request abandoned in the middle of its fan-out stops asking", async () => {
    // Every page takes 60 ms; the whole search (a manufacturer with a year in
    // the request, an archive, two stores, a search engine) would read nineteen
    // of them.
    const { app, requested } = service(60);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(address + "/v1/resolve/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bike(8).normalized,
          chooseCandidates: true,
        }),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      await reader.read();
      await vi.waitFor(() =>
        expect(requested.length).toBeGreaterThanOrEqual(3),
      );
      controller.abort();
      await reader.cancel().catch(() => {});
      const atAbort = requested.length;
      await new Promise((resolve) => setTimeout(resolve, 700));
      // Only what was already on its way finishes; nothing new is asked.
      expect(requested.length - atAbort).toBeLessThanOrEqual(1);
      expect(requested.length).toBeLessThan(13);
    } finally {
      app.server.closeAllConnections();
      await app.close();
    }
  });
});
