import { load } from "cheerio";
import { CatalogueAdapter } from "./base.js";
import { clean, extractMetadata } from "../extract.js";
import { normalizeSpecification } from "../normalize.js";
import {
  ResolverError,
  type SourceDocument,
  type BikeQuery,
} from "../domain.js";
export class BmcAdapter extends CatalogueAdapter {
  readonly id = "bmc";
  readonly brand = "BMC";
  readonly allowedDomains = [
    "bmc-switzerland.com",
    "www.bmc-switzerland.com",
    "us.bmc-switzerland.com",
  ];
  readonly origin = "https://bmc-switzerland.com";
  productPath = /\/products\/.*-bikes-bmc-/;
  protected allowSitemap(url: URL) {
    return /^\/sitemap_products_\d+\.xml$/.test(url.pathname);
  }
  protected seeds() {
    return [this.origin + "/sitemap.xml"];
  }
  async parse(doc: SourceDocument, _q: BikeQuery) {
    const $ = load(doc.body),
      rawSpecification: Record<string, string> = Object.create(null);
    $(".specs__info p").each((_, e) => {
      const el = $(e),
        label = clean(el.find("b").first().text()).replace(/:$/, "");
      const value = clean(el.clone().find("b").remove().end().text());
      if (label && value) rawSpecification[label] = value;
    });
    if (Object.keys(rawSpecification).length < 3)
      throw new ResolverError(
        "parse_error",
        "BMC technical overview not found",
      );
    return {
      ...extractMetadata(doc),
      rawSpecification,
      components: normalizeSpecification(rawSpecification),
    };
  }
}
