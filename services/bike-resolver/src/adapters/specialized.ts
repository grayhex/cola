import type { BikeQuery } from "../domain.js";
import { CatalogueAdapter } from "./base.js";
export class SpecializedAdapter extends CatalogueAdapter {
  readonly id = "specialized";
  readonly brand = "Specialized";
  readonly allowedDomains = [
    "www.specialized.com",
    "specialized.com",
    "media.specialized.com",
  ];
  readonly origin = "https://www.specialized.com";
  productPath = /\/(?:us|gb)\/en\/.*\/p\/\d+/;
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
