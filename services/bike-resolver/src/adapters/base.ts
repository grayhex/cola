import { budgetLeft, checkAbort, noteCut } from "../context.js";
import { sourceIdentity, withAddressWords } from "../source-url.js";
import { load } from "cheerio";
import { normalize } from "../normalize.js";
import { modelWordsMatch } from "../matcher.js";
import { extractMetadata, parseDocument } from "../extract.js";
import {
  ResolverError,
  type BikeCandidate,
  type BikeManufacturerAdapter,
  type BikeQuery,
  type SourceDocument,
} from "../domain.js";
import { ManufacturerHttpClient, validateUrl } from "../http.js";
// Pages of one catalogue cost seconds each. When this little is left of the
// phase's budget and some pages are read, the rest are left unread.
const LAST_PAGE_MS = 3500;
// Never more than this many pages of a catalogue are read for one request.
const MAX_PAGES = 12;
// How many words of the request's trim an address carries. The model words are
// what made it a candidate at all; the trim tells the bikes of a model apart.
function trimHits(href: string, q: BikeQuery) {
  const wanted = normalize(q.trim ?? "")
    .split(" ")
    .filter(Boolean);
  let words = new Set<string>();
  try {
    words = new Set(
      normalize(
        decodeURIComponent(new URL(href).pathname).replace(/[/._-]+/g, " "),
      )
        .split(" ")
        .filter(Boolean),
    );
  } catch {}
  return { hits: wanted.filter((w) => words.has(w)).length, of: wanted.length };
}
export abstract class CatalogueAdapter implements BikeManufacturerAdapter {
  abstract readonly id: string;
  abstract readonly brand: string;
  abstract readonly allowedDomains: string[];
  readonly aliases: string[] = [];
  readonly adapterVersion: number = 1;
  abstract readonly origin: string;
  abstract productPath: RegExp;
  protected cataloguePath?: RegExp;
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
  protected catalogueLinks(_doc: SourceDocument): string[] {
    return [];
  }
  protected async document(url: string): Promise<SourceDocument> {
    checkAbort();
    url = sourceIdentity(url);
    const hit = this.documents.get(url);
    if (hit && hit.expires > Date.now()) return hit.doc;
    const doc = await this.http.get(url, this.allowedDomains);
    if (this.documents.size >= 40)
      this.documents.delete(this.documents.keys().next().value!);
    this.documents.set(url, { expires: Date.now() + 86400000, doc });
    return doc;
  }
  fetchUrl(url: string) {
    return url;
  }
  async fetch(c: BikeCandidate) {
    const read = this.fetchUrl(c.url);
    return withAddressWords(await this.document(read), c.url, read);
  }
  async parse(doc: SourceDocument, _q: BikeQuery) {
    return parseDocument(doc, this.rows);
  }
  protected matchesModel(value: string, q: BikeQuery) {
    return modelWordsMatch(normalize(q.model), normalize(value));
  }
  async discover(
    q: BikeQuery,
    options: { pages?: number; spare?: number } = {},
  ): Promise<BikeCandidate[]> {
    const deadline = Date.now() + 60000;
    const budget = () => {
      checkAbort();
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
          this.cataloguePath?.test(u.pathname) &&
          this.matchesModel(decodeURIComponent(u.pathname), q) &&
          !seen.has(u.href)
        )
          queue.unshift(u.href);
        else if (
          this.productPath.test(u.pathname) &&
          this.matchesModel(decodeURIComponent(u.pathname), q)
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
        for (const link of this.catalogueLinks(doc)) add(link, doc.url);
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
            add(href, doc.url);
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
                (this.matchesModel(name, q) ||
                  this.matchesModel(decodeURIComponent(u.pathname), q))
              )
                urls.add(u.href);
            } catch {}
          });
          // A current catalogue/search page already supplied product choices.
          // Do not spend the remaining budget downloading historical sitemaps
          // when the user has not requested a particular year.
          if (q.year === null && urls.size) break;
        }
      } catch (e) {
        failure = e;
      }
    }
    // Best first; the catalogue's own order decides between equals. When some
    // address carries every word of the trim, the others are other bikes of the
    // model and are not read: each page is seconds of the budget.
    const ranked = [...urls]
      .map((href, order) => ({ href, order, ...trimHits(href, q) }))
      .sort((a, b) => b.hits - a.hits || a.order - b.order);
    const complete = ranked.filter((r) => r.of > 0 && r.hits === r.of);
    const pages = (complete.length ? complete : ranked).map((r) => r.href);
    // No more than the caller will use, except for a year it asks for: a year
    // is on the page, not in the address, so the page of that year may lie
    // behind the pages the caller verifies. Reading goes on, up to MAX_PAGES,
    // while the pages read state years and none of them is that one; the caller
    // ranks by year before it cuts. Pages cost seconds each, so this is paid
    // from the spare part of the budget only: it never takes the time that
    // checking the pages needs.
    const keep = Math.min(options.pages ?? MAX_PAGES, MAX_PAGES);
    const candidates: BikeCandidate[] = [];
    const lookingForYear = () =>
      q.year !== null &&
      budgetLeft() > (options.spare ?? 0) &&
      candidates.some((c) => c.year !== null) &&
      !candidates.some((c) => c.year === q.year);
    let read = 0;
    for (const url of pages.slice(0, MAX_PAGES)) {
      if (read >= keep && !lookingForYear()) break;
      budget();
      // What was read is kept: the phase ends with its pages, not with none.
      if (candidates.length && budgetLeft() < LAST_PAGE_MS) {
        noteCut();
        break;
      }
      read++;
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
    if (pages.length > read) noteCut();
    // An incomplete catalogue must not become a negatively cached assertion of absence.
    if (
      !candidates.length &&
      (failure || queue.length || urls.size > MAX_PAGES)
    )
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
