import { createHash } from "node:crypto";
import { normalize } from "./normalize.js";
import { sourceIdentity } from "./source-url.js";
import { trace, checkAbort } from "./context.js";
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
  trace("discovery_started");
  if (adapter && settings.value.adapters[adapter.id]) {
    try {
      const found = await adapter.discover(query);
      urls.push(
        ...found
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
          .slice(0, 3)
          .map((c) => c.url),
      );
    } catch {
      checkAbort();
    }
  }
  if (settings.value.retailerSearch) {
    try {
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
      if (/<rss[\s>]/i.test(doc.body))
        urls.push(...searchLinks(doc.body, query));
    } catch {
      checkAbort();
    }
  }
  const candidates: BikeCandidate[] = [];
  for (const url of [...new Set(urls.map(sourceIdentity))].slice(0, 6)) {
    checkAbort();
    const result = (await manual.resolve(query, url)) as ResolveResult;
    if (result.status !== "resolved" || result.components.length < 3) continue;
    const official = adapter?.allowedDomains.includes(
      new URL(result.source.url).hostname,
    );
    const score = partialScore(
      query,
      (official ? query.brand + " " : "") + result.bike.canonicalName,
      result.sourceYear ?? null,
    );
    if (!score) continue;
    candidates.push({
      candidateId: createHash("sha256").update(result.source.url).digest("hex"),
      brand: query.brand,
      canonicalName: result.bike.canonicalName,
      url: result.source.url,
      year: result.sourceYear ?? null,
      score,
      thumbnailId: (result as Resolved).thumbnailId,
      sourceHost: new URL(result.source.url).hostname,
      selectable: true,
    });
  }
  trace("candidate_found", { count: candidates.length });
  return candidates.length
    ? {
        status: "ambiguous",
        query,
        candidates: candidates.sort((a, b) => (b.score || 0) - (a.score || 0)),
        cached: false,
      }
    : {
        status: "not_found",
        query,
        brand: query.brand,
        retryable: false,
        cached: false,
      };
}
