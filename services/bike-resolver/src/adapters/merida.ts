import { CatalogueAdapter } from "./base.js";
import { load } from "cheerio";
import { extractMetadata } from "../extract.js";
import type { BikeQuery, SourceDocument, BikeCandidate } from "../domain.js";
// Only product imagery supplies this metadata, never a year mentioned in site navigation.
export function meridaYear(doc: SourceDocument) {
  const $ = load(doc.body);
  const years = new Set<number>();
  $("img.bike-variant-header-image, #model .bike-image img").each((_, el) => {
    const src = $(el).attr("src") || "";
    const m = src.match(/\/bikes\/(20\d{2})(?:[_/])/);
    if (m) years.add(Number(m[1]));
  });
  return years.size === 1 ? [...years][0] : null;
}
export class MeridaAdapter extends CatalogueAdapter {
  readonly id = "merida";
  readonly brand = "Merida";
  readonly allowedDomains = ["www.merida-bikes.com", "merida-bikes.com"];
  readonly origin = "https://www.merida-bikes.com";
  readonly adapterVersion = 2;
  productPath = /\/[a-z]{2}(?:-[a-z]{2})?\/bike\/(?:archive\/)?\d+(?:-\d+)?\//;
  protected rows = {
    row: ".specification-wrap",
    label: ".specification-name",
    value: ".specification-value",
  };
  async parse(doc: SourceDocument, q: BikeQuery) {
    const parsed = await super.parse(doc, q);
    return { ...parsed, year: parsed.year || meridaYear(doc) };
  }
  protected candidateMetadata(doc: SourceDocument) {
    const meta = extractMetadata(doc);
    return { ...meta, year: meta.year || meridaYear(doc) };
  }
  async discover(q: BikeQuery): Promise<BikeCandidate[]> {
    const candidates: BikeCandidate[] = [];
    // The archive returns all model years on one filtered page, including discontinued trims.
    for (const part of ["archive", ""]) {
      const url =
        this.origin +
        "/en/bikefinder" +
        (part ? "/" + part : "") +
        "?query=" +
        encodeURIComponent(q.model);
      const doc = await this.document(url),
        $ = load(doc.body);
      $(".bike-card").each((_, el) => {
        const link = $(el).find(".variant-img a[href]").first();
        const name =
          link.find("img").attr("alt") || $(el).find("h2,h3").first().text();
        const href = link.attr("href");
        if (!href || !this.matchesModel(name, q)) return;
        const year =
          Number(
            link
              .find("img")
              .attr("src")
              ?.match(/\/bikes\/(20\d{2})(?:[_/])/)?.[1],
          ) || null;
        const product = new URL(href, doc.url);
        if (
          !this.allowedDomains.includes(product.hostname) ||
          !this.productPath.test(product.pathname)
        )
          return;
        candidates.push({
          brand: this.brand,
          canonicalName: name,
          url: product.href,
          year,
        });
      });
      if (candidates.some((c) => c.year === q.year)) break;
    }
    return [...new Map(candidates.map((c) => [c.url, c])).values()]
      .sort((a, b) => Number(b.year === q.year) - Number(a.year === q.year))
      .slice(0, 12);
  }
}
