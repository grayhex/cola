import { load } from "cheerio";
import { normalize } from "../normalize.js";
import { extractMetadata, parseDocument } from "../extract.js";
import {
  ResolverError,
  type BikeCandidate,
  type BikeManufacturerAdapter,
  type BikeQuery,
  type SourceDocument,
} from "../domain.js";
import { ManufacturerHttpClient, validateUrl } from "../http.js";
export abstract class CatalogueAdapter implements BikeManufacturerAdapter {
  abstract readonly id: string;
  abstract readonly brand: string;
  abstract readonly allowedDomains: string[];
  readonly aliases: string[] = [];
  readonly adapterVersion = 1;
  abstract readonly origin: string;
  abstract productPath: RegExp;
  protected rows?: { row: string; label: string; value: string };
  private documents = new Map<
    string,
    { expires: number; doc: SourceDocument }
  >();
  constructor(protected http: ManufacturerHttpClient) {}
  protected allowSitemap(_url: URL) {
    return true;
  }
  protected seeds(q: BikeQuery): string[] {
    return [this.origin + "/robots.txt"];
  }
  protected direct(_q: BikeQuery): string[] {
    return [];
  }
  protected async document(url: string): Promise<SourceDocument> {
    const hit = this.documents.get(url);
    if (hit && hit.expires > Date.now()) return hit.doc;
    const doc = await this.http.get(url, this.allowedDomains);
    if (this.documents.size >= 40)
      this.documents.delete(this.documents.keys().next().value!);
    this.documents.set(url, { expires: Date.now() + 86400000, doc });
    return doc;
  }
  async fetch(c: BikeCandidate) {
    return this.document(c.url);
  }
  async parse(doc: SourceDocument, _q: BikeQuery) {
    return parseDocument(doc, this.rows);
  }
  async discover(q: BikeQuery): Promise<BikeCandidate[]> {
    const deadline = Date.now() + 60000;
    const budget = () => {
      if (Date.now() > deadline)
        throw new ResolverError(
          "upstream_unavailable",
          "Discovery time budget exceeded",
          true,
        );
    };
    const urls = new Set(this.direct(q));
    const queue = this.seeds(q);
    const seen = new Set<string>();
    let meaningful = false;
    let failure: unknown;
    const add = (value: string, base: string) => {
      try {
        const u = validateUrl(new URL(value, base).href, this.allowedDomains);
        u.hash = "";
        if (
          this.productPath.test(u.pathname) &&
          normalize(decodeURIComponent(u.pathname)).includes(
            normalize(q.model + " " + (q.trim || "")),
          )
        )
          urls.add(u.href);
        else if (
          /\.xml(?:\?|$)/i.test(u.href) &&
          !seen.has(u.href) &&
          this.allowSitemap(u)
        )
          queue.push(u.href);
      } catch {}
    };
    while (queue.length && seen.size < 10 && urls.size < 16) {
      budget();
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const doc = await this.document(url);
        if (/<app-root|<title>\s*Cube Info Portal/i.test(doc.body))
          throw new ResolverError(
            "upstream_unavailable",
            "Archive redirects to a portal without a public catalogue",
          );
        const $ = load(doc.body, {
          xml: /<urlset|<sitemapindex/.test(doc.body),
        });
        if (/<urlset|<sitemapindex/.test(doc.body)) {
          meaningful = true;
          $("loc").each((_, e) => add($(e).text(), doc.url));
        } else if (/Sitemap:/i.test(doc.body)) {
          for (const m of doc.body.matchAll(/^Sitemap:\s*(\S+)/gim))
            add(m[1], doc.url);
        } else {
          const anchors = $("a[href]");
          if (anchors.length > 3) meaningful = true;
          anchors.each((_, e) => {
            const href = $(e).attr("href")!;
            try {
              const u = validateUrl(
                new URL(href, doc.url).href,
                this.allowedDomains,
              );
              const name = normalize(
                $(e).text() + " " + $(e).find("img").attr("alt"),
              );
              if (
                this.productPath.test(u.pathname) &&
                (name.includes(normalize(q.model)) ||
                  normalize(decodeURIComponent(u.pathname)).includes(
                    normalize(q.model + " " + (q.trim || "")),
                  ))
              )
                urls.add(u.href);
            } catch {}
          });
        }
      } catch (e) {
        failure = e;
      }
    }
    const candidates: BikeCandidate[] = [];
    for (const url of [...urls].slice(0, 12)) {
      budget();
      try {
        const doc = await this.document(url);
        const meta = extractMetadata(doc);
        if (!meta.canonicalName)
          throw new ResolverError("parse_error", "Missing product identity");
        const parsedName = this.candidateMetadata(doc, q);
        candidates.push({ brand: this.brand, url: doc.url, ...parsedName });
      } catch (e) {
        failure = e;
      }
    }
    // An incomplete catalogue must not become a negatively cached assertion of absence.
    if (failure || queue.length || urls.size > 12)
      throw (
        failure ||
        new ResolverError(
          "upstream_unavailable",
          "Catalogue discovery budget exceeded",
          true,
        )
      );
    if (!meaningful && !urls.size)
      throw new ResolverError(
        "parse_error",
        "Manufacturer catalogue not recognizable",
      );
    return candidates;
  }
  protected candidateMetadata(doc: SourceDocument, _q: BikeQuery) {
    return extractMetadata(doc);
  }
}
