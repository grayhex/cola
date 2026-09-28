import type { BikeQuery } from "../domain.js";
import { CatalogueAdapter } from "./base.js";
import { load } from "cheerio";
import type { SourceDocument } from "../domain.js";
export class SpecializedAdapter extends CatalogueAdapter {
  readonly adapterVersion = 2;
  readonly id = "specialized";
  readonly brand = "Specialized";
  readonly allowedDomains = [
    "www.specialized.com",
    "specialized.com",
    "media.specialized.com",
  ];
  readonly origin = "https://www.specialized.com";
  productPath = /\/(?:us|gb)\/en\/.*\/p\/\d+/;
  protected catalogueLinks(doc: SourceDocument) {
    if (!/<urlset/.test(doc.body)) return [];
    const $ = load(doc.body, { xml: true });
    return $("loc")
      .toArray()
      .flatMap((el) => {
        try {
          const url = new URL($(el).text());
          if (
            url.hostname !== "www.specialized.com" ||
            !url.pathname.startsWith("/en/")
          )
            return [];
          url.pathname = "/us" + url.pathname;
          return [url.href];
        } catch {
          return [];
        }
      });
  }
  protected allowSitemap(url: URL) {
    return /(?:US|GB)-Product-en-[A-Z]{3}\.xml$|sitemap.*product|product.*sitemap/i.test(
      url.pathname,
    );
  }
  protected seeds(q: BikeQuery) {
    return [
      this.origin +
        "/us/en/search?text=" +
        encodeURIComponent([q.model, q.year].filter(Boolean).join(" ")),
      this.origin + "/us/en/sitemap.xml",
    ];
  }
}
