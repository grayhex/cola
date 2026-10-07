import { load } from "cheerio";
import { parseDocument } from "../extract.js";
import { validateUrl } from "../http.js";
import { normalize } from "../normalize.js";
import type { BikeQuery, SourceDocument } from "../domain.js";
import type { RetailStore, StoreEnv } from "./types.js";

const HOSTS = ["www.velosklad.ru", "velosklad.ru"];
const PRODUCT = /^\/velosipedy\/bike\/(\d+)\/[^/]+\/$/;
// The retailer's own catalogue search renders matching bikes into the page.
export class VeloSkladStore implements RetailStore {
  readonly id = "velosklad";
  readonly name = "ВелоСклад";
  readonly allowedDomains = HOSTS;
  readonly storeVersion = 1;
  readonly search = true;
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
  async discover(query: BikeQuery, env: StoreEnv) {
    const search = new URL("https://www.velosklad.ru/velosipedy/poiskall/");
    search.searchParams.set(
      "text",
      [query.brand, query.model, query.trim, query.year]
        .filter(Boolean)
        .join(" "),
    );
    const doc = await env.http.get(search.href, HOSTS);
    const $ = load(doc.body),
      tokens = normalize(
        [query.brand, query.model, query.trim].filter(Boolean).join(" "),
      ).split(" ");
    const links = $("a[href]")
      .toArray()
      .flatMap((el) => {
        try {
          const link = validateUrl(
            new URL($(el).attr("href")!, doc.url).href,
            HOSTS,
          );
          if (!PRODUCT.test(link.pathname)) return [];
          const text = new Set(
            normalize(
              $(el).text() +
                " " +
                $(el).find("img").attr("alt") +
                " " +
                link.pathname,
            ).split(" "),
          );
          return tokens.every((token) => text.has(token)) ? [link.href] : [];
        } catch {
          return [];
        }
      });
    return [...new Set(links)].slice(0, env.limit);
  }
  parse(doc: SourceDocument) {
    return parseDocument(doc);
  }
}
