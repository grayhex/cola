import { CatalogueAdapter } from "./base.js";
import { normalize } from "../normalize.js";
import type { BikeQuery } from "../domain.js";
export class GiantAdapter extends CatalogueAdapter {
  readonly id = "giant";
  readonly brand = "Giant";
  readonly allowedDomains = ["www.giant-bicycles.com", "giant-bicycles.com"];
  readonly origin = "https://www.giant-bicycles.com";
  productPath = /\/gb\/[a-z0-9-]+/;
  protected rows = { row: "li.datarow", label: ".label", value: ".value" };
  protected direct(q: BikeQuery) {
    return [
      `${this.origin}/gb/${normalize(q.model + " " + (q.trim || "")).replaceAll(" ", "-")}${q.year == null ? "" : "-" + q.year}`,
    ];
  }
  protected seeds() {
    return [];
  }
}
