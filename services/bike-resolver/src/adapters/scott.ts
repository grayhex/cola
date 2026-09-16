import { CatalogueAdapter } from "./base.js";
import { normalize } from "../normalize.js";
import type { BikeQuery } from "../domain.js";
export class ScottAdapter extends CatalogueAdapter {
  readonly id = "scott";
  readonly brand = "Scott";
  readonly allowedDomains = ["www.scott-sports.com", "scott-sports.com"];
  readonly origin = "https://www.scott-sports.com";
  productPath = /\/us\/en\/product\//;
  protected rows = {
    row: ".product-specifications li, .product-specification",
    label: ".label, .name",
    value: ".value, .description",
  };
  protected direct(q: BikeQuery) {
    return [
      `${this.origin}/us/en/product/scott-${normalize(q.model + " " + (q.trim || "")).replaceAll(" ", "-")}-bike`,
    ];
  }
  protected seeds() {
    return [];
  }
}
