import { load } from "cheerio";
import { ShopifyAdapter, type ShopifyHit } from "./shopify.js";
import { extractMetadata, parseDocument } from "../extract.js";
import type { BikeQuery, SourceDocument } from "../domain.js";

// The earliest of these starts the shop's descriptive tail of a title:
// "…Blade R7-105 Di2 [Full Carbon Road Bike 24S]".
const TAIL = [
  /\b(?:full\s+)?(?:carbon|aluminum|aluminium|alloy)\b(?:\s+fiber)?(?:\s+electronic)?(?:\s+(?:road|gravel|racing|mountain|city|folding))?\s+bike\b/i,
  /\b(?:disc\s+brake\s+)?(?:road|gravel|racing|mountain|city|folding)\s+bike\b/i,
];
const YEAR = /\b(20\d{2})\b/;
// "2026 SAVA Blade R7-105 Di2 Full Carbon Road Bike 24S" -> "Blade R7-105 Di2".
// A trailing "US" (the shop's US-warehouse listing) is a different offer and stays.
export function savaName(title: string) {
  const cut = Math.min(
    ...TAIL.map((pattern) => pattern.exec(title)?.index ?? title.length),
  );
  const us = /\bUS\s*$/.test(title) ? " US" : "";
  const model = title
    .slice(0, cut)
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/^\s*SAVA\b/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (model + us).trim() || title.trim();
}

// savadeck-bike.com is the Shopify storefront of SAVA Carbon Bike. The page
// carries the specification twice: as a structured block and as the merchant's
// own "Technical Specifications" tab. They can disagree; the structured block
// wins and the difference is reported, never merged.
export class SavaAdapter extends ShopifyAdapter {
  readonly id = "sava";
  readonly brand = "SAVA";
  readonly aliases = ["SAVA Bikes", "SAVA Carbon Bike", "SAVA Carbon"];
  readonly allowedDomains = ["savadeck-bike.com", "www.savadeck-bike.com"];
  readonly origin = "https://savadeck-bike.com";
  readonly adapterVersion = 1;
  protected rows = {
    row: "tr[class*='ai-specs-accordion__row']",
    label: "td[class*='ai-specs-accordion__label']",
    value: "td[class*='ai-specs-accordion__value']",
  };

  protected isBike(hit: ShopifyHit) {
    return (
      /\bbike\b/i.test(hit.type) &&
      !/second.?hand|\bused\b|\bkids?\b/i.test(hit.type + " " + hit.title) &&
      !/frame\s*set/i.test(hit.title)
    );
  }
  protected nameOf(hit: ShopifyHit) {
    return savaName(hit.title);
  }
  protected yearOf(hit: ShopifyHit) {
    return Number(YEAR.exec(hit.title)?.[1]) || null;
  }

  async parse(doc: SourceDocument, _q: BikeQuery) {
    const $ = load(doc.body),
      title = extractMetadata(doc).canonicalName ?? "";
    // The year is the page's own: the product title or its "Model" row
    // ("2026 SAVA Gelaro S8 (R21-…)"), never the collection in the address.
    const model = $(this.rows.row)
      .filter((_, row) =>
        /^model$/i.test($(row).find(this.rows.label).first().text().trim()),
      )
      .find(this.rows.value)
      .first()
      .text();
    const year = Number((YEAR.exec(title) ?? YEAR.exec(model))?.[1]) || null;
    return parseDocument(doc, this.rows, {
      name: savaName(title) || undefined,
      year,
    });
  }
}
