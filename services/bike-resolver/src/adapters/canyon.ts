import { CatalogueAdapter } from "./base.js";
import type { BikeQuery, SourceDocument } from "../domain.js";

// A new model carries a badge inside its heading, written without a space:
// "Grail CF SLX 8 AXS" is read as "Grail CF SLX 8 AXSNew".
const unbadged = (name: string) => name.replace(/(?<=[\p{L}\p{N})])New$/u, "");
export class CanyonAdapter extends CatalogueAdapter {
  readonly id = "canyon";
  readonly brand = "Canyon";
  readonly allowedDomains = ["www.canyon.com", "canyon.com"];
  readonly origin = "https://www.canyon.com";
  productPath = /\/en-nl\/.*\/\d+\.html$/;
  protected seeds() {
    return [this.origin + "/sitemap-en_NL.xml"];
  }
  protected candidateMetadata(doc: SourceDocument, q: BikeQuery) {
    const found = super.candidateMetadata(doc, q);
    return { ...found, canonicalName: unbadged(found.canonicalName) };
  }
  async parse(doc: SourceDocument, q: BikeQuery) {
    const parsed = await super.parse(doc, q);
    return { ...parsed, canonicalName: unbadged(parsed.canonicalName) };
  }
  protected rows = {
    row: ".allComponents__sectionSpecListItemInner",
    label: ".allComponents__sectionSpecListItemTitle",
    value:
      ".allComponents__specItemListItem--name, .allComponents__specItemListItem--feature",
  };
}
