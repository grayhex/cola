import { CatalogueAdapter } from "./base.js";
export class TrekAdapter extends CatalogueAdapter {
  readonly id = "trek";
  readonly brand = "Trek";
  readonly allowedDomains = [
    "www.trekbikes.com",
    "trekbikes.com",
    "api.trekbikes.com",
    "wcpcdn.blob.core.windows.net",
  ];
  readonly origin = "https://www.trekbikes.com";
  productPath = /\/us\/en_US\/bikes\/.*\/p\/\d+/;
  protected allowSitemap(url: URL) {
    return (
      url.hostname !== "wcpcdn.blob.core.windows.net" ||
      /Trek-en-US-/.test(url.pathname)
    );
  }
  protected rows = {
    row: ".product-specs tr, .specs-table tr",
    label: "th",
    value: "td",
  };
}
