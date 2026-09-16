import { load } from "cheerio";
import { CatalogueAdapter } from "./base.js";
import { extractMetadata, parseDocument } from "../extract.js";
import type { BikeQuery, SourceDocument } from "../domain.js";
export class CubeAdapter extends CatalogueAdapter {
  readonly id = "cube";
  readonly brand = "CUBE";
  readonly allowedDomains = [
    "archiv.cube.eu",
    "cube.eu",
    "www.cube.eu",
    "info.cube.eu",
  ];
  readonly origin = "https://archiv.cube.eu";
  productPath = /\/(?:19|20)\d{2}\/\d+/;
  protected rows = {
    row: ".specs .row, .specification .row, .equipment .row, .specs li",
    label: ".name, .label, .spec-title",
    value: ".value, .description, .spec-value",
  };
  protected seeds(q: BikeQuery) {
    return [`${this.origin}/${q.year}/`, `${this.origin}/sitemap.xml`];
  }
  protected candidateMetadata(doc: SourceDocument, _q: BikeQuery) {
    const $ = load(doc.body);
    return extractMetadata(doc, {
      name:
        [$("h1").first().text(), $("h2").first().text()].join(" ").trim() ||
        undefined,
      year:
        Number(new URL(doc.url).pathname.match(/\/(20\d{2})\//)?.[1]) || null,
      id: new URL(doc.url).pathname.match(/\/(\d{6})[A-Z]?$/)?.[1],
    });
  }
  async parse(doc: SourceDocument, q: BikeQuery) {
    return {
      ...parseDocument(doc, this.rows),
      ...this.candidateMetadata(doc, q),
    };
  }
}
