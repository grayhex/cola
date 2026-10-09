import { load } from "cheerio";
import { parseDocument } from "../extract.js";
import { validateUrl } from "../http.js";
import {
  CatalogueIndex,
  rankCatalogue,
  sitemapEntries,
} from "../catalogue-index.js";
import { notCompleteBike } from "./classify.js";
import type { BikeQuery, SourceDocument } from "../domain.js";
import type { RetailStore, StoreEnv } from "./types.js";

export const notBikeName = (name: string) =>
  /(?:^|\s)(?:рама|фреймсет|frameset|frame\s*set)(?:\s|$)|велосипедная\s+рама/iu.test(
    name,
  );

export function bikeHeading(doc: SourceDocument, requireBicycle = false) {
  const name = load(doc.body)("h1").first().text().replace(/\s+/g, " ").trim();
  if (
    !name ||
    notBikeName(name) ||
    (requireBicycle &&
      !/(?:^|\s)велосипед(?:\s|$)|\bbicycle\b|\bbike\b/iu.test(name))
  )
    throw notCompleteBike();
  return name;
}

abstract class RussianStore implements RetailStore {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly allowedDomains: string[];
  readonly storeVersion = 1;
  readonly search = true;
  readonly partial = true;
  owns(url: URL) {
    return this.allowedDomains.includes(url.hostname);
  }
  abstract productKey(url: URL): string | null;
  fetchUrl(input: string) {
    const url = validateUrl(input, this.allowedDomains);
    url.protocol = "https:";
    url.hostname = this.allowedDomains[0];
    url.hash = "";
    return url.href;
  }
  abstract discover(query: BikeQuery, env: StoreEnv): Promise<string[]>;
  parse(doc: SourceDocument) {
    if (!this.productKey(new URL(doc.url))) throw notCompleteBike();
    bikeHeading(doc, true);
    return parseDocument(doc);
  }
}

export class TrialSportStore extends RussianStore {
  readonly id = "trial-sport";
  readonly name = "Триал-Спорт";
  readonly allowedDomains = ["trial-sport.ru", "www.trial-sport.ru"];
  productKey(url: URL) {
    return this.owns(url)
      ? (url.pathname.match(/^\/goods\/(?:\d+\/)?(\d+)\.html$/)?.[1] ?? null)
      : null;
  }
  async discover(query: BikeQuery, env: StoreEnv) {
    // The search compares the title; the season is a separate field on a card.
    const url = new URL("https://trial-sport.ru/gds.php");
    url.searchParams.set(
      "q",
      [query.brand, query.model, query.trim].filter(Boolean).join(" "),
    );
    const doc = await env.http.get(url.href, this.allowedDomains),
      $ = load(doc.body);
    const entries = new Map<
      string,
      { url: string; name: string; year: number | null }
    >();
    $(".object").each((_, element) => {
      const card = $(element),
        link = card.find("a.title").first();
      const name = link.text().replace(/\s+/g, " ").trim();
      if (
        !name ||
        notBikeName(name) ||
        !/(?:^|\s)велосипед(?:\s|$)/iu.test(name)
      )
        return;
      try {
        const target = validateUrl(
          new URL(link.attr("href") || "", doc.url).href,
          this.allowedDomains,
        );
        if (!this.productKey(target)) return;
        target.hash = "";
        const season = card.text().match(/Сезон:\s*((?:19|20)\d{2})/u)?.[1];
        entries.set(target.href, {
          url: target.href,
          name,
          year: season ? Number(season) : null,
        });
      } catch {
        /* Invalid links do not leave the store. */
      }
    });
    return rankCatalogue(query, [...entries.values()], env.limit).map(
      (entry) => entry.url,
    );
  }
}

abstract class SitemapStore extends RussianStore {
  abstract readonly sitemap: string;
  private index = new CatalogueIndex();
  protected catalogueProduct(url: URL) {
    return !!this.productKey(url);
  }
  async discover(query: BikeQuery, env: StoreEnv) {
    const entries = await this.index.read(this.sitemap, async () =>
      sitemapEntries(
        await env.http.get(this.sitemap, this.allowedDomains),
        this.allowedDomains,
        (url) => this.catalogueProduct(url),
      ),
    );
    return rankCatalogue(query, entries, env.limit).map((entry) => entry.url);
  }
}

export class VeloStranaStore extends SitemapStore {
  readonly id = "velostrana";
  readonly name = "ВелоСтрана";
  readonly allowedDomains = ["www.velostrana.ru", "velostrana.ru"];
  readonly sitemap = "https://www.velostrana.ru/ya-sitemap.xml";
  fetchUrl(input: string) {
    const url = new URL(super.fetchUrl(input));
    url.search = "";
    return url.href;
  }
  productKey(url: URL) {
    if (
      !this.owns(url) ||
      !/^\/[a-z0-9-]+\/[a-z0-9-]+\/(?:20\d{2}\/)?$/.test(url.pathname) ||
      /^\/(?:velo|all_brand|action|contact|shops|reviews)/.test(url.pathname) ||
      /\/group-/.test(url.pathname)
    )
      return null;
    return url.pathname;
  }
}

export class VeloDriveStore extends SitemapStore {
  readonly id = "velodrive";
  readonly name = "ВелоДрайв";
  readonly allowedDomains = ["www.velodrive.ru", "velodrive.ru"];
  readonly sitemap = "https://www.velodrive.ru/sitemap_goods.xml";
  fetchUrl(input: string) {
    const url = new URL(super.fetchUrl(input));
    url.search = "";
    return url.href;
  }
  productKey(url: URL) {
    return this.owns(url) &&
      /^\/bicycles\/[^/]+\/[^/]+\.html$/.test(url.pathname)
      ? url.pathname
      : null;
  }
  parse(doc: SourceDocument) {
    if (!this.productKey(new URL(doc.url))) throw notCompleteBike();
    bikeHeading(doc, true);
    return parseDocument(doc, {
      row: ".tabs_block-about_good-item__elem",
      label: ".tabs_block-about_good-item__list_left",
      value: ".tabs_block-about_good-item__list_text",
    });
  }
}

export class AlienBikeStore extends SitemapStore {
  readonly id = "alienbike";
  readonly name = "AlienBike";
  readonly allowedDomains = ["www.alienbike.ru", "alienbike.ru"];
  readonly sitemap = "https://www.alienbike.ru/sitemap.xml";
  productKey(url: URL) {
    if (!this.owns(url)) return null;
    if (url.pathname === "/index.php")
      return url.searchParams.get("route") === "product/product" &&
        /^\d+$/.test(url.searchParams.get("product_id") || "")
        ? url.searchParams.get("product_id")
        : null;
    return /^\/[a-zA-Z0-9_-][a-zA-Z0-9_./-]+$/.test(url.pathname)
      ? url.pathname
      : null;
  }
  parse(doc: SourceDocument) {
    if (!this.productKey(new URL(doc.url))) throw notCompleteBike();
    bikeHeading(doc, true);
    return parseDocument(doc, {
      row: ".attribute__item",
      label: ".name",
      value: ".value",
    });
  }
  protected catalogueProduct(url: URL) {
    // OpenCart category 59 is bicycles; components are category 83 and others.
    return (
      !!this.productKey(url) &&
      (url.pathname !== "/index.php" ||
        /^59(?:_|$)/.test(url.searchParams.get("path") || ""))
    );
  }
  fetchUrl(input: string) {
    const url = new URL(super.fetchUrl(input));
    if (url.pathname === "/index.php") {
      const params = new URLSearchParams();
      for (const key of ["route", "path", "product_id"]) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
      }
      url.search = params.toString();
    }
    return url.href;
  }
}
