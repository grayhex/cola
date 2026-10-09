import { load } from "cheerio";
import { CatalogueAdapter } from "./base.js";
import {
  CatalogueIndex,
  namedYear,
  rankCatalogue,
  sitemapEntries,
  type CatalogueEntry,
} from "../catalogue-index.js";
import { checkAbort, noteCut } from "../context.js";
import { validateUrl } from "../http.js";
import { parseDocument } from "../extract.js";
import { jsonRecords } from "../json-values.js";
import { normalizeBikeWords } from "../matcher.js";
import { bikeHeading, notBikeName } from "../stores/russian.js";
import { notCompleteBike } from "../stores/classify.js";
import type { BikeCandidate, BikeQuery, SourceDocument } from "../domain.js";

const candidate = (brand: string, entry: CatalogueEntry): BikeCandidate => ({
  brand,
  canonicalName: entry.name,
  url: entry.url,
  year: entry.year,
});

export class AspectAdapter extends CatalogueAdapter {
  readonly id = "aspect";
  readonly brand = "ASPECT";
  readonly aliases = ["Аспект"];
  readonly allowedDomains = ["www.aspect-bikes.ru", "aspect-bikes.ru"];
  readonly origin = "https://www.aspect-bikes.ru";
  readonly adapterVersion = 1;
  productPath = /^\/catalog\/(?!search\/|year\/)[a-z0-9-]+\/(?:20\d{2}\/?|)$/;
  private index = new CatalogueIndex();
  fetchUrl(input: string) {
    const url = validateUrl(input, this.allowedDomains);
    url.protocol = "https:";
    url.hostname = "www.aspect-bikes.ru";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.href;
  }
  private entries() {
    // The public autocomplete returns the whole catalogue, including named
    // model years. It is filtered by the browser, not by the search parameter.
    const url = this.origin + "/catalog/search/?search=";
    return this.index.read(url, async () => {
      const doc = await this.document(url);
      return jsonRecords(JSON.parse(doc.body)).flatMap((row) => {
        if (
          typeof row.url !== "string" ||
          typeof row.name !== "string" ||
          notBikeName(row.name)
        )
          return [];
        try {
          const target = new URL(this.fetchUrl(row.url));
          if (!this.productPath.test(target.pathname)) return [];
          return [
            { url: target.href, name: row.name, year: namedYear(row.name) },
          ];
        } catch {
          return [];
        }
      });
    });
  }
  async discover(query: BikeQuery) {
    return rankCatalogue(query, await this.entries(), 12).map((entry) =>
      candidate(this.brand, entry),
    );
  }
  async parse(doc: SourceDocument, _query: BikeQuery) {
    if (!this.productPath.test(new URL(doc.url).pathname))
      throw notCompleteBike();
    const name = bikeHeading(doc);
    let entry: CatalogueEntry | undefined;
    try {
      entry = (await this.entries()).find(
        (row) => row.url === this.fetchUrl(doc.url),
      );
    } catch {
      checkAbort();
      // The specification remains usable when its separate year index is down.
      // No query year is promoted to a published fact.
    }
    // A year comes from the publisher's catalogue entry for this exact page,
    // never the query or copyright. A missing entry keeps the year unknown.
    const sameName =
      entry &&
      normalizeBikeWords(
        entry.name.replace(/\s*\((?:19|20)\d{2}\)\s*$/, ""),
      ) === normalizeBikeWords(name);
    return parseDocument(doc, undefined, {
      name,
      ...(sameName && entry ? { year: entry.year } : {}),
    });
  }
}

export class StarkAdapter extends CatalogueAdapter {
  readonly id = "stark";
  readonly brand = "STARK";
  readonly aliases = ["Старк"];
  readonly allowedDomains = ["stark.ru", "www.stark.ru"];
  readonly origin = "https://stark.ru";
  readonly adapterVersion = 1;
  productPath = /^\/bikes\/velosipedy\/.+\/[^/]+-(?:19|20)\d{2}\/$/;
  protected rows = {
    row: ".property",
    label: ".property-name",
    value: ".property-value",
    // Here these labels contain the actual frame/fork specification. Other
    // sites use them for general classifications, so the mapping is local.
    types: { "Материал рамы": "frame", "Тип вилки": "fork" } as const,
  };
  async discover(query: BikeQuery) {
    // The published sitemap is stale (2019–2020). Follow the current menu's
    // matching family, not every family or the robots-disallowed /arhiv/.
    const doc = await this.document(this.origin + "/"),
      $ = load(doc.body);
    const word = normalizeBikeWords(query.model).split(" ")[0];
    const family = word === "grl" ? "gravel" : word;
    const paths = new Set<string>();
    $("a[href^='/bikes/velosipedy/']").each((_, element) => {
      if (normalizeBikeWords($(element).text()) === family)
        paths.add($(element).attr("href")!);
    });
    const found = new Map<string, CatalogueEntry>();
    for (const path of [...paths].slice(0, 2)) {
      const listing = await this.document(new URL(path, this.origin).href),
        page = load(listing.body);
      page(".product-item-title a").each((_, element) => {
        const name = page(element).text().replace(/\s+/g, " ").trim();
        if (notBikeName(name)) return;
        try {
          const url = validateUrl(
            new URL(page(element).attr("href") || "", listing.url).href,
            this.allowedDomains,
          );
          if (this.productPath.test(url.pathname))
            found.set(url.href, {
              url: url.href,
              name: this.brand + " " + name,
              year: namedYear(name),
            });
        } catch {
          /* Menu links never expand the host policy. */
        }
      });
    }
    return rankCatalogue(query, [...found.values()], 12).map((entry) =>
      candidate(this.brand, entry),
    );
  }
  async parse(doc: SourceDocument, _query: BikeQuery) {
    if (!this.productPath.test(new URL(doc.url).pathname))
      throw notCompleteBike();
    const name = bikeHeading(doc);
    return parseDocument(doc, this.rows, { name });
  }
}

export class WeltAdapter extends CatalogueAdapter {
  readonly id = "welt";
  readonly brand = "WELT";
  readonly aliases = ["Велт", "Вельт"];
  readonly allowedDomains = ["www.welt-bikes.com", "welt-bikes.com"];
  readonly origin = "https://www.welt-bikes.com";
  readonly adapterVersion = 1;
  productPath = /^\/ru\/ru\/vse-velosipedy\/[^/]+\/[^/]+\/?$/;
  protected rows = {
    row: ".specification-params__item-param",
    label: ".specification-params__item-param-title",
    value: ".specification-params__item-param-value",
  };
  async discover(query: BikeQuery) {
    const doc = await this.document(this.origin + "/ru/ru/vse-velosipedy"),
      $ = load(doc.body);
    const found = new Map<string, CatalogueEntry>();
    $("a[href*='/vse-velosipedy/']").each((_, element) => {
      const name = $(element)
        .find("p")
        .toArray()
        .map((p) => $(p).text().trim())
        .find((text) => /^welt\s/i.test(text));
      if (!name || notBikeName(name)) return;
      try {
        const url = validateUrl(
          new URL($(element).attr("href")!, doc.url).href,
          this.allowedDomains,
        );
        if (this.productPath.test(url.pathname))
          found.set(url.href, { url: url.href, name, year: namedYear(name) });
      } catch {
        /* Reject external catalogue links. */
      }
    });
    return rankCatalogue(query, [...found.values()], 12).map((entry) =>
      candidate(this.brand, entry),
    );
  }
  async parse(doc: SourceDocument, _query: BikeQuery) {
    if (!this.productPath.test(new URL(doc.url).pathname))
      throw notCompleteBike();
    bikeHeading(doc);
    const parsed = parseDocument(doc, this.rows);
    const drivetrain = parsed.components.filter((component) =>
      ["rear_derailleur", "front_derailleur", "shifter"].includes(
        component.type,
      ),
    );
    const codes = new Map<string, Set<string>>();
    for (const component of drivetrain) {
      const code = component.raw.value
        .match(/\b(?:RD|FD|ST|SL)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i)?.[0]
        .toUpperCase();
      if (!code) continue;
      const types = codes.get(code) ?? new Set<string>();
      types.add(component.type);
      codes.set(code, types);
    }
    if ([...codes.values()].some((types) => types.size > 1)) {
      parsed.warnings = [
        ...new Set([
          ...(parsed.warnings ?? []),
          "conflicting_sources" as const,
        ]),
      ];
    }
    return parsed;
  }
}

export class StelsAdapter extends CatalogueAdapter {
  readonly id = "stels";
  readonly brand = "STELS";
  readonly aliases = ["Стелс"];
  readonly allowedDomains = [
    "stelsbicycle.ru",
    "www.stelsbicycle.ru",
    "forbike.ru",
    "www.forbike.ru",
  ];
  readonly origin = "https://stelsbicycle.ru";
  readonly adapterVersion = 1;
  productPath =
    /^\/(?:catalog\/bicycle\/[^/]+\/[^/]+|bicycle(?:-stels-20\d{2})?\/[^/]+\/[^/]+)\/$/;
  private index = new CatalogueIndex();
  sourceKindForUrl(url: string): "archive" | "manufacturer" {
    return /^(?:www\.)?forbike\.ru$/.test(new URL(url).hostname)
      ? "archive"
      : "manufacturer";
  }
  private entries(url: string) {
    return this.index.read(url, async () =>
      sitemapEntries(await this.document(url), this.allowedDomains, (entry) =>
        this.productPath.test(entry.pathname),
      ),
    );
  }
  async discover(query: BikeQuery) {
    const urls =
      query.year !== null && query.year <= 2020
        ? [
            "https://forbike.ru/sitemap.xml",
            this.origin + "/sitemap-iblock-36.xml",
          ]
        : [
            this.origin + "/sitemap-iblock-36.xml",
            "https://forbike.ru/sitemap.xml",
          ];
    const entries: CatalogueEntry[] = [];
    let failure: unknown;
    for (const url of urls) {
      try {
        entries.push(...(await this.entries(url)));
      } catch (error) {
        checkAbort();
        failure = error;
        noteCut();
      }
    }
    if (!entries.length && failure) throw failure;
    return rankCatalogue(
      query,
      entries.map((entry) => ({
        ...entry,
        name: this.brand + " " + entry.name,
      })),
      12,
    ).map((entry) => ({
      ...candidate(this.brand, entry),
      kind: this.sourceKindForUrl(entry.url),
    }));
  }
  async parse(doc: SourceDocument, _query: BikeQuery) {
    if (!this.productPath.test(new URL(doc.url).pathname))
      throw notCompleteBike();
    const $ = load(doc.body);
    let name = $(".product__heading").first().text().trim() || bikeHeading(doc);
    // STELS publishes the build index in the canonical product address.
    const build = new URL(doc.url).pathname.match(/-([a-z]\d{3})\/$/i)?.[1];
    if (build && !name.toLowerCase().includes(build.toLowerCase()))
      name += " " + build.toUpperCase();
    if (notBikeName(name)) throw notCompleteBike();
    const rows =
      this.sourceKindForUrl(doc.url) === "archive"
        ? {
            row: ".table-object > .row",
            label: ".col-sm-5",
            value: ".col-sm-7",
          }
        : {
            row: ".product-card__tr",
            label: ".product-card__td:first-child",
            value: ".product-card__td:last-child",
          };
    return parseDocument(doc, rows, { name });
  }
}
