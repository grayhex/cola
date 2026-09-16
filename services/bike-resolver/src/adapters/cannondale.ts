import { CatalogueAdapter } from "./base.js";
export class CannondaleAdapter extends CatalogueAdapter {
  readonly id = "cannondale";
  readonly brand = "Cannondale";
  readonly allowedDomains = [
    "www.cannondale.com",
    "cannondale.com",
    "a304077.sitemaphosting6.com",
  ];
  readonly origin = "https://www.cannondale.com";
  productPath = /\/en-us\/bikes\/.+\/.+/;
  protected seeds() {
    return [this.origin + "/robots.txt"];
  }
  protected rows = {
    row: ".inner-trigger.trigger",
    label: "strong.name",
    value: ".desc",
  };
}
