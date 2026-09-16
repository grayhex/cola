import { CatalogueAdapter } from "./base.js";
export class CanyonAdapter extends CatalogueAdapter {
  readonly id = "canyon";
  readonly brand = "Canyon";
  readonly allowedDomains = ["www.canyon.com", "canyon.com"];
  readonly origin = "https://www.canyon.com";
  productPath = /\/en-nl\/.*\/\d+\.html$/;
  protected seeds() {
    return [this.origin + "/sitemap-en_NL.xml"];
  }
  protected rows = {
    row: ".allComponents__sectionSpecListItemInner",
    label: ".allComponents__sectionSpecListItemTitle",
    value:
      ".allComponents__specItemListItem--name, .allComponents__specItemListItem--feature",
  };
}
