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
  productPath = /\/us\/en\/.*\/p\/\d+/;
  protected allowSitemap(url: URL) {
    return /US-Product-en-USD\.xml$/.test(url.pathname);
  }
  protected seeds() {
    return [this.origin + "/us/en/sitemap.xml"];
  }
  protected rows = {
    row: '[id="technical-specifications"] [class*="SpecContainer_componentContainer"]',
    label: "p:first-child",
    value: "p:nth-child(2)",
  };
}
