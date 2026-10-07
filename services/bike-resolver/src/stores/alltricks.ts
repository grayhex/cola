import { parseDocument } from "../extract.js";
import type { SourceDocument } from "../domain.js";
import { breadcrumbNames, notCompleteBike } from "./classify.js";
import type { RetailStore } from "./types.js";

const HOSTS = [
  "www.alltricks.fr",
  "alltricks.fr",
  "www.alltricks.com",
  "alltricks.com",
];
const PRODUCT = /^\/F-\d+-([^/]+)\/P-(\d+)-[^/]+$/i;
const BIKES = /^(?:v[ée]los?|bikes?|bicycles?)$/i;
// Product pages are /F-<family>-<slug>/P-<id>-<slug>. The catalogue search is
// not implemented: Alltricks answers automated requests with a Cloudflare
// challenge from datacenter networks, so only pasted URLs are served.
export class AlltricksStore implements RetailStore {
  readonly id = "alltricks";
  readonly name = "Alltricks";
  readonly allowedDomains = HOSTS;
  readonly storeVersion = 1;
  readonly search = false;
  owns(url: URL) {
    return HOSTS.includes(url.hostname);
  }
  productKey(url: URL) {
    const match = this.owns(url) ? PRODUCT.exec(url.pathname) : null;
    return match ? match[2] : null;
  }
  fetchUrl(url: string) {
    return url;
  }
  parse(doc: SourceDocument) {
    const crumbs = breadcrumbNames(doc);
    // Without breadcrumbs the product family in the URL is the only evidence.
    const family = PRODUCT.exec(new URL(doc.url).pathname)?.[1] ?? "";
    const bike = crumbs.length
      ? BIKES.test(crumbs[1] ?? "")
      : /(?:^|-)(?:velos?|bikes?)(?:-|$)/i.test(family) &&
        !/cadres?|frames?|pieces|accessoires/i.test(family);
    if (!bike) throw notCompleteBike();
    return parseDocument(doc);
  }
}
