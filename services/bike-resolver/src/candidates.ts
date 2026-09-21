import { archiveLinks } from "./archive-search.js";
import { createHash } from "node:crypto";
import { normalize } from "./normalize.js";
import { sourceIdentity } from "./source-url.js";
import { trace, checkAbort, resolutionContext } from "./context.js";
import { searchLinks } from "./retailer-search.js";
import type {
  BikeQuery,
  BikeCandidate,
  BikeManufacturerAdapter,
  ResolveResult,
  Resolved,
} from "./domain.js";
import type { ManufacturerHttpClient } from "./http.js";
import type { ManualSources } from "./manual.js";
import type { SettingsStore } from "./settings.js";
async function withinBudget<T>(ms: number, task: () => Promise<T>): Promise<T> {
  const context = resolutionContext.getStore();
  if (!context) return task();
  return resolutionContext.run(
    {
      ...context,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(ms)]),
    },
    task,
  );
}
export function partialScore(
  query: BikeQuery,
  name: string,
  year: number | null,
): number {
  const text = normalize(name),
    words = new Set(text.split(" "));
  if (
    !normalize(query.brand)
      .split(" ")
      .every((w) => words.has(w))
  )
    return 0;
  const model = normalize(query.model).split(" ").filter(Boolean);
  const matches = model.filter((w) => words.has(w)).length;
  if (!matches || matches / model.length < 0.5) return 0;
  const trim = normalize(query.trim || "")
    .split(" ")
    .filter(Boolean);
  return (
    (matches / model.length) * 0.65 +
    (year === query.year ? 0.2 : 0) +
    (trim.length
      ? (trim.filter((w) => words.has(w)).length / trim.length) * 0.15
      : 0.1)
  );
}
// A bounded discovery pass. Every shown page has a parsable product specification;
// partial identity matches require explicit selection and keep mismatch warnings.
export async function findCandidates(
  query: BikeQuery,
  adapters: BikeManufacturerAdapter[],
  http: ManufacturerHttpClient,
  manual: ManualSources,
  settings: SettingsStore,
): Promise<ResolveResult> {
  const urls: string[] = [];
  const adapter = adapters.find((a) =>
    [a.brand, ...a.aliases].some(
      (b) => normalize(b) === normalize(query.brand),
    ),
  );
  let unavailable = false;
  trace("discovery_started");
  // Independent indexes share the request's cancellation/deadline.
  const results = await Promise.allSettled([
    withinBudget(20000, async () => {
      if (!adapter || !settings.value.adapters[adapter.id]) return [];
      const found = await adapter.discover(query);
      return found
        .filter(
          (c) =>
            partialScore(query, query.brand + " " + c.canonicalName, c.year) >
            0,
        )
        .sort(
          (a, b) =>
            partialScore(query, query.brand + " " + b.canonicalName, b.year) -
            partialScore(query, query.brand + " " + a.canonicalName, a.year),
        )
        .slice(0, 6)
        .map((c) => c.url);
    }),
    withinBudget(12000, async () => {
      if (!settings.value.retailerSearch) return [];
      trace("retailer_search_started");
      const search = new URL("https://www.bing.com/search");
      search.searchParams.set("format", "rss");
      search.searchParams.set(
        "q",
        [
          query.brand,
          query.model,
          query.trim,
          query.year,
          "bicycle specifications",
        ]
          .filter(Boolean)
          .join(" "),
      );
      const doc = await http.get(search.href, ["www.bing.com", "bing.com"]);
      if (!/<rss[\s>]/i.test(doc.body)) throw Error("Search unavailable");
      return searchLinks(doc.body, query, 6);
    }),
    withinBudget(12000, async () =>
      settings.value.retailerSearch && query.year < new Date().getUTCFullYear()
        ? archiveLinks(http, query)
        : [],
    ),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled") urls.push(...result.value);
    else unavailable = true;
  }
  checkAbort();
  const candidates: BikeCandidate[] = [];
  const unique = [...new Set(urls.map(sourceIdentity))].slice(0, 12);
  for (let offset = 0; offset < unique.length; offset += 3) {
    checkAbort();
    await Promise.all(
      unique.slice(offset, offset + 3).map(async (url) => {
        let result: ResolveResult;
        try {
          result = (await withinBudget(12000, () =>
            manual.resolve(query, url),
          )) as ResolveResult;
        } catch {
          unavailable = true;
          return;
        }
        if (result.status !== "resolved" || result.components.length < 3)
          return;
        const official = adapter?.allowedDomains.includes(
          new URL(result.source.url).hostname,
        );
        const score = partialScore(
          query,
          (official ? query.brand + " " : "") + result.bike.canonicalName,
          result.sourceYear ?? null,
        );
        if (!score) return;
        candidates.push({
          candidateId: createHash("sha256")
            .update(result.source.url)
            .digest("hex"),
          brand: query.brand,
          canonicalName: result.bike.canonicalName,
          url: result.source.url,
          year: result.sourceYear ?? null,
          score,
          thumbnailId: (result as Resolved).thumbnailId,
          sourceHost: new URL(result.source.url).hostname,
          selectable: true,
        });
      }),
    );
  }
  trace("candidate_found", { count: candidates.length });
  return candidates.length
    ? {
        status: "ambiguous",
        query,
        candidates: candidates
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 8),
        cached: false,
      }
    : {
        status: unavailable ? "upstream_unavailable" : "not_found",
        query,
        brand: query.brand,
        retryable: unavailable,
        cached: false,
      };
}
