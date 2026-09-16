import { CatalogueAdapter } from "./base.js";
export class MeridaAdapter extends CatalogueAdapter {
  readonly id = "merida";
  readonly brand = "Merida";
  readonly allowedDomains = ["www.merida-bikes.com", "merida-bikes.com"];
  readonly origin = "https://www.merida-bikes.com";
  productPath = /\/en\/bike\/(archive\/)?\d+\//;
  protected seeds() {
    return [this.origin + "/en/bikefinder"];
  }
  protected rows = {
    row: ".specification-wrap",
    label: ".specification-name",
    value: ".specification-value",
  };
}
