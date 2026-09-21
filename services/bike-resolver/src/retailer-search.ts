import { load } from "cheerio";
import { ManufacturerHttpClient, validateUrl } from "./http.js";
import { ManualSources } from "./manual.js";
import { normalize } from "./normalize.js";
import { trace, checkAbort } from "./context.js";
import { ResolverError, type BikeQuery, type ResolveResult } from "./domain.js";
import type { SettingsStore } from "./settings.js";

export function searchLinks(xml: string, query?: BikeQuery, limit = 3): string[] {
  const $ = load(xml, { xml: true });
  const model = query ? normalize(query.model).split(" ") : [];
  const entries = $("item")
    .toArray()
    .slice(0, 30)
    .map((e) => {
      const url = $(e).find("link").text().trim();
      const text = normalize($(e).find("title,description").text() + " " + url);
      return { url, described: !!$(e).find("title,description").text().trim(), score: model.filter((t) => text.includes(t)).length };
    })
    .filter((e) => e.url.length <= 2048 && (!model.length || !e.described || e.score > 0))
    .sort((a, b) => b.score - a.score);
  return [...new Set(entries.map((e) => e.url))].slice(0, limit);
}
// One public search request, at most three product pages. Never parse search snippets as specs.
export class RetailerSearch {
  private cache = new Map<string, { urls: string[]; expires: number }>();
  constructor(
    private http: ManufacturerHttpClient,
    private manual: ManualSources,
    private settings: SettingsStore,
  ) {}
  async resolve(query: BikeQuery): Promise<ResolveResult> {
    let last: ResolveResult = {
      status: "not_found",
      query,
      brand: query.brand,
      cached: false,
      retryable: false,
    };
    try {
      trace("retailer_search_started");
      const key = JSON.stringify(query);
      let entry = this.cache.get(key);
      if (!entry || entry.expires < Date.now()) {
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
        const doc = await this.http.get(search.href, [
          "www.bing.com",
          "bing.com",
        ]);
        if (!/<rss[\s>]/i.test(doc.body))
          throw new ResolverError("upstream_unavailable", "Search unavailable");
        entry = {
          urls: searchLinks(doc.body, query),
          expires: Date.now() + 3600000,
        };
        if (this.cache.size >= 100)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, entry);
      }
      trace("candidate_found", { count: entry.urls.length });
      for (const url of entry.urls) {
        checkAbort();
        try {
          validateUrl(url, {
            blockedDomains: this.settings.value.blockedDomains,
          });
        } catch {
          continue;
        }
        const result = (await this.manual.resolve(query, url)) as ResolveResult;
        if (result.status !== "resolved") {
          last = result;
          continue;
        }
        // Never accept a different trim, an unverified year or a search-engine snippet.
        const name = normalize(result.bike.canonicalName);
        const actual = name
          .replace(/\b(?:19|20)\d{2}\b/g, "")
          .replace(
            /^(?:велосипед|двухподвесный велосипед|горный велосипед)\s+/,
            "",
          )
          .trim()
          .split(/\s+/)
          .sort()
          .join(" ");
        const wanted = normalize(
          [query.brand, query.model, query.trim].filter(Boolean).join(" "),
        )
          .split(" ")
          .sort()
          .join(" ");
        if (
          result.sourceYear !== query.year ||
          actual !== wanted ||
          result.warnings?.includes("identity_mismatch")
        ) {
          trace("conflict_found", { reason: "identity_mismatch" });
          continue;
        }
        return {
          ...result,
          manualSelection: false,
          confidence: 0.99,
          source: { ...result.source, adapter: "retailer-search" },
        };
      }
      return last;
    } catch (e) {
      checkAbort();
      return {
        status: "upstream_unavailable",
        query,
        brand: query.brand,
        cached: false,
        retryable: true,
        reason: e instanceof ResolverError ? e.reason : "connection_failed",
      };
    }
  }
}
