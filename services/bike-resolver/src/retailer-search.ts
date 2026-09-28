import { load } from "cheerio";
import { ManufacturerHttpClient, validateUrl } from "./http.js";
import { ManualSources } from "./manual.js";
import { normalize } from "./normalize.js";
import { trace, checkAbort } from "./context.js";
import { ResolverError, type BikeQuery, type ResolveResult } from "./domain.js";
import type { SettingsStore } from "./settings.js";

export function searchLinks(
  xml: string,
  query?: BikeQuery,
  limit = 3,
): string[] {
  const $ = load(xml, { xml: true });
  const model = query ? normalize(query.model).split(" ") : [];
  const entries = $("item")
    .toArray()
    .slice(0, 30)
    .map((e) => {
      const url = $(e).find("link").text().trim();
      const text = normalize($(e).find("title,description").text() + " " + url);
      return {
        url,
        described: !!$(e).find("title,description").text().trim(),
        score: model.filter((t) => text.includes(t)).length,
      };
    })
    .filter(
      (e) =>
        e.url.length <= 2048 && (!model.length || !e.described || e.score > 0),
    )
    .sort((a, b) => b.score - a.score);
  return [...new Set(entries.map((e) => e.url))].slice(0, limit);
}
export async function retailerLinks(
  http: ManufacturerHttpClient,
  query: BikeQuery,
  limit = 3,
) {
  const words = [query.brand, query.model, query.trim, query.year]
    .filter(Boolean)
    .join(" ");
  const search = new URL("https://www.bing.com/search");
  search.searchParams.set("format", "rss");
  search.searchParams.set("q", words + " bicycle specifications");
  try {
    const doc = await http.get(search.href, ["www.bing.com", "bing.com"]);
    if (/<rss[\s>]/i.test(doc.body)) {
      const links = searchLinks(doc.body, query, limit);
      if (links.length) return links;
    }
  } catch {
    checkAbort();
  }
  // A real retailer catalogue is useful when the search engine is unavailable
  // or returns an empty RSS. Product identity is still verified after fetching.
  const url = new URL("https://www.velosklad.ru/velosipedy/poiskall/");
  url.searchParams.set("text", words);
  const doc = await http.get(url.href, ["www.velosklad.ru", "velosklad.ru"]);
  const $ = load(doc.body),
    tokens = normalize(
      [query.brand, query.model, query.trim].filter(Boolean).join(" "),
    ).split(" ");
  const links = $("a[href]")
    .toArray()
    .flatMap((el) => {
      try {
        const link = validateUrl(new URL($(el).attr("href")!, doc.url).href, [
          "www.velosklad.ru",
          "velosklad.ru",
        ]);
        if (!/^\/velosipedy\/bike\/\d+\/[^/]+\/$/.test(link.pathname))
          return [];
        const text = new Set(
          normalize(
            $(el).text() +
              " " +
              $(el).find("img").attr("alt") +
              " " +
              link.pathname,
          ).split(" "),
        );
        return tokens.every((token) => text.has(token)) ? [link.href] : [];
      } catch {
        return [];
      }
    });
  return [...new Set(links)].slice(0, limit);
}
// Bounded discovery and at most three product pages; snippets are never specs.
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
        entry = {
          urls: await retailerLinks(this.http, query),
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
          (query.year !== null && result.sourceYear !== query.year) ||
          result.sourceYear == null ||
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
