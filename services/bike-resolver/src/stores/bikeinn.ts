import { parseDocument } from "../extract.js";
import {
  ResolverError,
  type BikeQuery,
  type SourceDocument,
} from "../domain.js";
import type { ManufacturerHttpClient } from "../http.js";
import { breadcrumbNames, notCompleteBike } from "./classify.js";
import { rankSlugs } from "./support.js";
import type { RetailStore, StoreEnv } from "./types.js";

const HOSTS = ["www.tradeinn.com", "tradeinn.com"];
const SITEMAPS =
  "https://www.tradeinn.com/bikeinn/sitemaps/sitemap-bikeinn.xml";
const PRODUCT = /^\/bikeinn\/([a-z]{2}(?:-[a-z]{2})?)\/([^/]+)\/(\d{5,12})\/p$/;
const DAY = 24 * 3600000;
interface Entry {
  url: string;
  slug: string;
}
// Tradeinn hosts many shops; only the /bikeinn/ section is ever requested.
// Its search is script-driven, so discovery reads the public product sitemap,
// which lists only part of the catalogue: a miss is not proof of absence.
export class BikeinnStore implements RetailStore {
  readonly id = "bikeinn";
  readonly name = "Bikeinn";
  readonly allowedDomains = HOSTS;
  readonly storeVersion = 1;
  readonly search = true;
  readonly partial = true;
  private index?: { entries: Promise<Entry[]>; expires: number };
  owns(url: URL) {
    return HOSTS.includes(url.hostname) && url.pathname.startsWith("/bikeinn/");
  }
  productKey(url: URL) {
    const match = this.owns(url) ? PRODUCT.exec(url.pathname) : null;
    return match ? match[3] : null;
  }
  // The product id decides the page; labels are English only in the /en/ shop.
  fetchUrl(url: string) {
    const u = new URL(url),
      match = this.owns(u) ? PRODUCT.exec(u.pathname) : null;
    if (!match || match[1] === "en") return url;
    return `https://www.tradeinn.com/bikeinn/en/product/${match[3]}/p`;
  }
  private entries(http: ManufacturerHttpClient) {
    if (!this.index || this.index.expires < Date.now()) {
      const entries = (async () => {
        const root = await http.get(SITEMAPS, HOSTS);
        const files = [
          ...root.body.matchAll(
            /<loc>\s*([^<\s]+_productos_\d+_eng_bikeinn\.xml)\s*<\/loc>/g,
          ),
        ].map((m) => m[1]);
        if (!files.length)
          throw new ResolverError(
            "parse_error",
            "Bikeinn sitemap not recognizable",
          );
        const found: Entry[] = [];
        for (const file of files.slice(0, 4)) {
          const doc = await http.get(file, HOSTS);
          for (const m of doc.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
            const url = new URL(m[1]),
              product = PRODUCT.exec(url.pathname);
            if (this.owns(url) && product && product[2].endsWith("-bike"))
              found.push({ url: url.href, slug: product[2] });
          }
        }
        return found;
      })();
      this.index = { entries, expires: Date.now() + DAY };
      // A failed load must not be remembered for a day.
      entries.catch(() => {
        if (this.index?.entries === entries) this.index = undefined;
      });
    }
    return this.index.entries;
  }
  async discover(query: BikeQuery, env: StoreEnv) {
    const entries = await this.entries(env.http);
    return rankSlugs(query, entries, env.limit).map((e) => e.url);
  }
  parse(doc: SourceDocument) {
    const crumbs = breadcrumbNames(doc);
    if (
      !/^bikes and frames$/i.test(crumbs[1] ?? "") ||
      !/\bbikes?$/i.test(crumbs.at(-1) ?? "")
    )
      throw notCompleteBike();
    return parseDocument(doc);
  }
}
