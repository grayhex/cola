import { load } from "cheerio";
import { checkAbort, noteCut } from "./context.js";
import { validateUrl } from "./http.js";
import { modelWordsMatch, partialScore } from "./matcher.js";
import type { BikeQuery, SourceDocument } from "./domain.js";

export interface CatalogueEntry {
  url: string;
  name: string;
  year: number | null;
}
export const namedYear = (name: string) =>
  Number(name.match(/\b(?:19|20)\d{2}\b/g)?.at(-1)) || null;

// Cache bounded public indexes, not failures or a request's abortable promise.
// A cancelled first reader cannot poison another request for the cache's TTL.
export class CatalogueIndex {
  private values = new Map<
    string,
    { expires: number; entries: CatalogueEntry[] }
  >();
  async read(key: string, loadEntries: () => Promise<CatalogueEntry[]>) {
    checkAbort();
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now()) return hit.entries;
    const entries = await loadEntries();
    checkAbort();
    if (this.values.size >= 4)
      this.values.delete(this.values.keys().next().value!);
    if (entries.length > 50000) noteCut();
    const bounded = entries.slice(0, 50000);
    this.values.set(key, {
      expires: Date.now() + 6 * 3600000,
      entries: bounded,
    });
    return bounded;
  }
}

export function sitemapEntries(
  doc: SourceDocument,
  hosts: string[],
  accepts: (url: URL) => boolean,
): CatalogueEntry[] {
  const $ = load(doc.body, { xml: true });
  const entries = new Map<string, CatalogueEntry>();
  $("url").each((_, element) => {
    checkAbort();
    try {
      const url = validateUrl($(element).children("loc").text().trim(), hosts);
      if (!accepts(url)) return;
      const name =
        $(element).find("image\\:title").first().text().trim() ||
        decodeURIComponent(url.pathname).replace(/[-_/]+/g, " ");
      entries.set(url.href, { url: url.href, name, year: namedYear(name) });
    } catch {
      // A foreign or malformed sitemap entry is never fetched.
    }
  });
  return [...entries.values()];
}

export function rankCatalogue(
  query: BikeQuery,
  entries: CatalogueEntry[],
  limit: number,
) {
  const matching = entries.filter((entry) =>
    modelWordsMatch(query.model, entry.name),
  );
  return (matching.length ? matching : entries)
    .map((entry) => ({
      entry,
      score: partialScore(query, entry.name, entry.year),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.name.length - b.entry.name.length ||
        a.entry.url.localeCompare(b.entry.url),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}
