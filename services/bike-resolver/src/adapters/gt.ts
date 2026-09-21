import { CatalogueAdapter } from "./base.js";
import type { BikeQuery } from "../domain.js";
export class GtAdapter extends CatalogueAdapter {
  readonly id = "gt";
  readonly brand = "GT";
  readonly aliases = ["GT Bicycles"];
  readonly allowedDomains = ["gtbicycles.com", "www.gtbicycles.com"];
  readonly origin = "https://gtbicycles.com";
  productPath = /\/products\//;
  protected seeds(q: BikeQuery) {
    return [
      this.origin + "/search?type=product&q=" + encodeURIComponent(q.model),
    ];
  }
}
