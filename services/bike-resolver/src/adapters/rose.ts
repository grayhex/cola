import { load } from "cheerio";
import { CatalogueAdapter } from "./base.js";
import { checkAbort } from "../context.js";
import { normalize } from "../normalize.js";
import { parseDocument } from "../extract.js";
import { notCompleteBike } from "../stores/classify.js";
import type { BikeCandidate, BikeQuery, SourceDocument } from "../domain.js";

// /p/rose-<model words>-<numeric id>: bikes, parts and clothing alike.
const PRODUCT = /^\/p\/rose-([a-z0-9-]+)-(\d{5,8})$/;
const words = (s: string) => normalize(s).split(" ").filter(Boolean);
// The slug starts with the model (as written or run together) and goes on
// with at most a few variant words ("midstep", "women").
function variantOf(slug: string[], model: string[]): string[] | undefined {
  const target = model.join("");
  let joined = "";
  for (let i = 0; i < slug.length && joined.length < target.length; i++) {
    joined += slug[i];
    if (joined === target) return slug.slice(i + 1);
  }
  return undefined;
}
const title = (tokens: string[]) =>
  tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" ");

// ROSE Bikes publishes no model year on a product page. Pages stay online
// after a season: the family page lists the current bikes, the site map also
// holds the older ones. Both are offered; the year is never inferred.
export class RoseAdapter extends CatalogueAdapter {
  readonly id = "rose";
  readonly brand = "ROSE";
  readonly aliases = ["Rose Bikes", "ROSE Bikes", "Rosebikes"];
  readonly allowedDomains = ["www.rosebikes.com", "rosebikes.com"];
  readonly origin = "https://www.rosebikes.com";
  readonly adapterVersion = 1;
  productPath = PRODUCT;

  private sitemap(doc: SourceDocument) {
    return [...doc.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((m) => m[1].replaceAll("&amp;", "&"))
      .flatMap((loc) => {
        try {
          return [new URL(loc, this.origin)];
        } catch {
          return [];
        }
      })
      .filter((u) => u.origin === this.origin);
  }

  // Family pages of the current range whose name is part of the model:
  // /bikes/gravel/adventure/backroad serves "Backroad Unsupported".
  private families(urls: URL[], model: string[]) {
    const wanted = new Set(model),
      found = new Map<string, URL>();
    for (const u of urls) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] !== "bikes" || parts.length !== 4 || parts[1] === "sale")
        continue;
      const slug = words(parts[3]);
      if (
        slug.length &&
        slug.every((w) => wanted.has(w)) &&
        !found.has(parts[3])
      )
        found.set(parts[3], u);
    }
    return [...found.values()].slice(0, 2);
  }

  async discover(q: BikeQuery): Promise<BikeCandidate[]> {
    checkAbort();
    const model = words([q.model, q.trim].filter(Boolean).join(" "));
    if (!model.length) return [];
    const urls = this.sitemap(
      await this.document(this.origin + "/sitemap.xml"),
    );
    const links = new Map<string, string>(); // path -> id
    const add = (path: string) => {
      const m = path.match(PRODUCT);
      if (!m) return;
      const variant = variantOf(m[1].split("-"), model);
      if (variant && variant.length <= 3) links.set(path, m[2]);
    };
    // The current range first: its pages are known to be bikes.
    for (const family of this.families(urls, model)) {
      checkAbort();
      const $ = load((await this.document(family.href)).body);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        add(href.startsWith("/") ? href.split("?")[0] : "");
      });
    }
    for (const u of urls) add(u.pathname);
    return [...links].map(([path, id]) => ({
      brand: this.brand,
      url: this.origin + path,
      canonicalName: title(path.match(PRODUCT)![1].split("-")),
      year: null,
      manufacturerProductId: id,
    }));
  }

  async parse(doc: SourceDocument, _q: BikeQuery) {
    // The shop's own page template tells a bike from a part or an accessory:
    // only a bike page has the bike blocks. (Pages of the earlier shop have
    // another title and no such markup at all.)
    if (
      /<title>[^<]*\| Rose Bikes/.test(doc.body) &&
      !/data-test="bike-/.test(doc.body)
    )
      throw notCompleteBike();
    return parseDocument(doc, this.rows);
  }
}
