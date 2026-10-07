import { parseDocument } from "../extract.js";
import type { SourceDocument } from "../domain.js";
import type { RetailStore } from "./types.js";

const HOSTS = ["www.bike24.com", "bike24.com"];
const PRODUCT = /^\/p(\d{5,9})\.html$/;
// Product pages are /p<id>.html. BIKE24 rejects automated requests at its edge
// (HTTP 403), so neither the search nor the parser could be checked on a real
// page: they stay generic and the store is off until an operator verifies it.
export class Bike24Store implements RetailStore {
  readonly id = "bike24";
  readonly name = "BIKE24";
  readonly allowedDomains = HOSTS;
  readonly storeVersion = 1;
  readonly search = false;
  owns(url: URL) {
    return HOSTS.includes(url.hostname);
  }
  productKey(url: URL) {
    const match = this.owns(url) ? PRODUCT.exec(url.pathname) : null;
    return match ? match[1] : null;
  }
  fetchUrl(url: string) {
    return url;
  }
  parse(doc: SourceDocument) {
    return parseDocument(doc);
  }
}
