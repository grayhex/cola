import { CatalogueAdapter } from "./base.js";
import { normalize } from "../normalize.js";
import type { BikeQuery } from "../domain.js";
export class OrbeaAdapter extends CatalogueAdapter {
  readonly id = "orbea";
  readonly brand = "Orbea";
  readonly allowedDomains = ["www.orbea.com", "orbea.com"];
  readonly origin = "https://www.orbea.com";
  productPath = /\/en-us\//;
  protected rows = {
    row: ".specification, .technical-specification",
    label: ".label, .name",
    value: ".value, .description",
  };
  protected direct(q: BikeQuery) {
    return [
      `${this.origin}/en-us/${normalize(q.model + " " + (q.trim || "")).replaceAll(" ", "-")}`,
    ];
  }
  protected seeds() {
    return [];
  }
}
