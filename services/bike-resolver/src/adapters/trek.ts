import { CatalogueAdapter } from "./base.js";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { componentType } from "../normalize.js";
import { parseDocument } from "../extract.js";
import {
  ResolverError,
  type SourceDocument,
  type BikeQuery,
} from "../domain.js";
export class TrekAdapter extends CatalogueAdapter {
  readonly adapterVersion = 2;
  readonly id = "trek";
  readonly brand = "Trek";
  readonly allowedDomains = [
    "www.trekbikes.com",
    "trekbikes.com",
    "api.trekbikes.com",
    "wcpcdn.blob.core.windows.net",
  ];
  readonly origin = "https://www.trekbikes.com";
  productPath =
    /\/us\/en_US\/bikes\/.*\/(?:p\/\d+|f\/[^/]+\/[^/]+\/\d+)(?:\/|$)/;
  protected seeds(q: BikeQuery) {
    return [
      this.origin + "/us/en_US/search/?text=" + encodeURIComponent(q.model),
      this.origin + "/robots.txt",
    ];
  }
  protected cataloguePath = /\/us\/en_US\/bikes\/.*\/c\/[^/]+\/?$/;
  protected catalogueLinks(doc: SourceDocument) {
    const $ = load(doc.body);
    return $("product-card-item")
      .toArray()
      .flatMap((el) => {
        try {
          const product = JSON.parse($(el).attr(":product") || "");
          return typeof product.url === "string" &&
            product.url.startsWith("/bikes/")
            ? [this.origin + "/us/en_US" + product.url]
            : [];
        } catch {
          return [];
        }
      });
  }
  protected async document(url: string) {
    return this.enrich(await super.document(url));
  }
  async parse(doc: SourceDocument, _q: BikeQuery) {
    return parseDocument(await this.enrich(doc), this.rows);
  }
  private async enrich(doc: SourceDocument): Promise<SourceDocument> {
    const path = new URL(doc.url).pathname;
    const code =
      path.match(/\/p\/(\d+)(?:\/|$)/)?.[1] ||
      path.match(/\/f\/[^/]+\/[^/]+\/(\d+)(?:\/|$)/)?.[1];
    if (!code || doc.body.includes('data-trek-resolver="2"')) return doc;
    // Legacy server-rendered specs remain usable when the public API is absent.
    try {
      parseDocument(doc, this.rows);
      return doc;
    } catch {
      /* Current PDP/FDP pages only contain a JS shell. */
    }
    const api = `https://api.trekbikes.com/occ/v2/us/products/${code}`;
    const identityDoc = await super.document(api + "/full");
    const product = JSON.parse(identityDoc.body);
    if (
      String(product.code) !== code ||
      typeof product.name !== "string" ||
      !product.url?.includes(`/${code}/`)
    )
      throw new ResolverError(
        "parse_error",
        "Trek API identity mismatch",
        false,
        "identity_mismatch",
      );
    const fields: { name: string; value: string }[] = [];
    let specDoc = identityDoc;
    if (product.useSpecItem) {
      specDoc = await super.document(api + "/specifications");
      const specs = JSON.parse(specDoc.body).specs;
      if (!Array.isArray(specs))
        throw new ResolverError("parse_error", "Missing Trek specifications");
      for (const spec of specs.slice(0, 300)) {
        if (typeof spec.type !== "string") continue;
        for (const variant of (spec.marketingDescWithFrameSizesMap || []).slice(
          0,
          30,
        )) {
          if (typeof variant.key !== "string") continue;
          const sizes = Array.isArray(variant.value)
            ? variant.value
                .filter((s: unknown) => typeof s === "string")
                .join(", ")
                .trim()
            : "";
          fields.push({
            name: spec.type,
            value: variant.key + (sizes ? ` (frame sizes: ${sizes})` : ""),
          });
        }
      }
    } else {
      for (const [key, value] of Object.entries(product.specs || {})) {
        if (!/^spec[A-Z]/.test(key) || typeof value !== "string") continue;
        const name = key.slice(4).replace(/([a-z])([A-Z])/g, "$1 $2");
        if (componentType(name) !== "other" || name === "Weight")
          fields.push({ name, value });
      }
    }
    // A range such as 2026–2027 is not evidence for one model year.
    const year = /^20\d{2}$/.test(product.marketingModelYear || "")
      ? Number(product.marketingModelYear)
      : undefined;
    const json = JSON.stringify({
      "@type": "Product",
      name: product.name,
      productID: code,
      modelYear: year,
      additionalProperty: fields,
    }).replace(/</g, "\\u003c");
    return {
      ...doc,
      body: `<script type="application/ld+json" data-trek-resolver="2">${json}</script>`,
      hash: createHash("sha256")
        .update(doc.hash + identityDoc.hash + specDoc.hash)
        .digest("hex"),
    };
  }
  protected allowSitemap(url: URL) {
    return (
      url.hostname !== "wcpcdn.blob.core.windows.net" ||
      /Trek-en-US-/.test(url.pathname)
    );
  }
  protected rows = {
    row: ".product-specs tr, .specs-table tr",
    label: "th",
    value: "td",
  };
}
