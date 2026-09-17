import { load } from "cheerio";
import { randomUUID } from "node:crypto";
import { ManufacturerHttpClient, validateUrl } from "./http.js";
import { parseDocument, jsonObjects } from "./extract.js";
import { normalizeSpecification } from "./normalize.js";
import {
  ResolverError,
  type BikeQuery,
  type BikeManufacturerAdapter,
  type SourceDocument,
} from "./domain.js";
import type { SettingsStore } from "./settings.js";

// Public portal data used by info.cube.eu itself. No user credentials or JS execution.
export function parseCubePayload(product: any, features: any[]) {
  const english = (rows: any[]) => rows?.find((x) => x.languageId === 2);
  const raw: Record<string, string> = Object.create(null);
  for (const spec of product.specs || []) {
    const label = english(
      features.find((f) => f.productFeatureId === spec.productSpecTypeId)
        ?.languageData,
    )?.description;
    const value = english(spec.languageData)?.productSpecValueDescription;
    if (typeof label === "string" && typeof value === "string")
      raw[label] = value;
  }
  const components = normalizeSpecification(raw);
  if (components.filter((c) => c.type !== "other").length < 3)
    throw new ResolverError(
      "parse_error",
      "CUBE portal has no recognizable specification",
    );
  return {
    canonicalName: [product.description, product.description2]
      .filter(Boolean)
      .join(" "),
    manufacturerProductId: String(product.mainId),
    year: null,
    rawSpecification: raw,
    components,
  };
}
export function extractImages(doc: SourceDocument) {
  const $ = load(doc.body),
    found: string[] = [];
  const add = (v: any) => {
    if (Array.isArray(v)) {
      v.forEach(add);
      return;
    }
    if (v && typeof v === "object") {
      add(v.url || v.contentUrl);
      return;
    }
    if (typeof v !== "string") return;
    try {
      const u = new URL(v, doc.url);
      if (
        ["http:", "https:"].includes(u.protocol) &&
        !/\.(svg|gif)(?:\?|$)/i.test(u.href)
      )
        found.push(u.href);
    } catch {}
  };
  for (const p of jsonObjects($))
    if (["Product", "ProductGroup", "Bicycle"].includes(p["@type"]))
      add(p.image);
  $('meta[property="og:image"],meta[name="twitter:image"]').each((_, e) => {
    add($(e).attr("content"));
  });
  $(
    '[itemprop="image"], .product-detail img, .product-item-detail-slider-image, .product-gallery img, .product-slider img',
  ).each((_, e) => {
    add($(e).attr("data-src") || $(e).attr("src") || $(e).attr("href"));
  });
  return [...new Set(found)].slice(0, 12);
}
export class ManualSources {
  private photos = new Map<
    string,
    { url: string; page: string; expires: number }
  >();
  constructor(
    private http: ManufacturerHttpClient,
    private adapters: BikeManufacturerAdapter[],
    private settings: SettingsStore,
  ) {}
  domains() {
    return [
      ...new Set([
        ...this.settings.value.manualDomains,
        ...this.adapters.flatMap((a) => a.allowedDomains),
      ]),
    ];
  }
  async document(url: string) {
    if (!this.settings.value.enabled)
      throw new ResolverError("upstream_unavailable", "Resolver disabled");
    return this.http.get(validateUrl(url, this.domains()).href, this.domains());
  }
  async cube(doc: SourceDocument) {
    const id = new URL(doc.url).searchParams.get("a");
    if (!id || !/^\d{1,12}$/.test(id))
      throw new ResolverError("parse_error", "CUBE product id missing");
    const $ = load(doc.body),
      script = $("script[src]")
        .toArray()
        .map((e) => $(e).attr("src"))
        .find((s) => s?.includes("main-"));
    if (!script)
      throw new ResolverError("parse_error", "CUBE public application missing");
    const js = await this.http.get(new URL(script, doc.url).href, [
      "info.cube.eu",
    ]);
    const key = js.body.match(/apiKey:\s*"([^"\s]{10,200})"/)?.[1];
    if (!key)
      throw new ResolverError(
        "parse_error",
        "CUBE public data configuration changed",
      );
    const headers = { "CubeAPI-Key": key, "x-cube-id-language": "2" };
    const base = "https://connect-api.cube.eu/api/manuals/v1";
    const productDoc = await this.http.get(
      base +
        "/Product/basedata/manuals?productMainId=" +
        id +
        "&includeImages=true&imageHeight=600&imageWidth=800&productClassIds=1&productClassIds=2&productClassIds=3&productClassIds=6",
      ["connect-api.cube.eu"],
      headers,
    );
    const featureDoc = await this.http.get(
      base + "/ProductFeature/basedata",
      ["connect-api.cube.eu"],
      headers,
    );
    const product = JSON.parse(productDoc.body)?.[0],
      features = JSON.parse(featureDoc.body);
    if (!product || !Array.isArray(features))
      throw new ResolverError("parse_error", "CUBE public data format changed");
    return { product, parsed: parseCubePayload(product, features) };
  }
  async resolve(query: BikeQuery, url: string) {
    try {
      const doc = await this.document(url);
      const parsed =
        new URL(doc.url).hostname === "info.cube.eu"
          ? (await this.cube(doc)).parsed
          : await (this.adapters
              .find((a) => a.allowedDomains.includes(new URL(doc.url).hostname))
              ?.parse(doc, query) ?? parseDocument(doc));
      // A URL is an explicit user-selected source, never a verified identity match.
      return {
        status: "resolved",
        query,
        bike: {
          ...query,
          canonicalName: parsed.canonicalName,
          manufacturerProductId: parsed.manufacturerProductId,
          sourceUrl: doc.url,
        },
        confidence: 0,
        manualSelection: true,
        sourceYear: parsed.year,
        components: parsed.components,
        rawSpecification: parsed.rawSpecification,
        source: {
          manufacturer: new URL(doc.url).hostname,
          url: doc.url,
          fetchedAt: doc.fetchedAt,
          adapter: "manual-url",
          adapterVersion: 1,
        },
        cached: false,
      };
    } catch (e) {
      return {
        status: e instanceof ResolverError ? e.status : "parse_error",
        query,
        brand: query.brand,
        retryable: e instanceof ResolverError && e.retryable,
        cached: false,
      };
    }
  }
  async search(query: BikeQuery, sourceUrl?: string) {
    if (!this.settings.value.enabled || !this.settings.value.photoSearch)
      throw new ResolverError("upstream_unavailable", "Photo search disabled");
    let doc: SourceDocument;
    if (sourceUrl) doc = await this.document(sourceUrl);
    else {
      const adapter = this.adapters.find((a) =>
        [a.brand, ...a.aliases].some(
          (b) => b.toLowerCase() === query.brand.toLowerCase(),
        ),
      );
      if (!adapter || !this.settings.value.adapters[adapter.id])
        return { photos: [] };
      const candidates = await adapter.discover(query);
      const exact = candidates.find(
        (c) =>
          c.year === query.year &&
          c.canonicalName.toLowerCase().includes(query.model.toLowerCase()) &&
          (!query.trim ||
            c.canonicalName.toLowerCase().includes(query.trim.toLowerCase())),
      );
      if (!exact) return { photos: [] };
      doc = await adapter.fetch(exact);
    }
    let urls = extractImages(doc);
    if (new URL(doc.url).hostname === "info.cube.eu") {
      const { product } = await this.cube(doc);
      if (product.pictureUrl) urls = [product.pictureUrl, ...urls];
    }
    for (const [id, p] of this.photos)
      if (p.expires < Date.now()) this.photos.delete(id);
    return {
      photos: [...new Set(urls)].slice(0, 12).map((url) => {
        // Image hosts come only from the fetched product page. IP checks and redirect allowlists remain mandatory.
        validateUrl(url, [new URL(url).hostname]);
        if (this.photos.size >= 500)
          this.photos.delete(this.photos.keys().next().value!);
        const id = randomUUID();
        this.photos.set(id, {
          url,
          page: doc.url,
          expires: Date.now() + 15 * 60 * 1000,
        });
        return { id, sourceUrl: doc.url };
      }),
    };
  }
  async photo(id: string) {
    const p = this.photos.get(id);
    if (
      !p ||
      p.expires < Date.now() ||
      !this.settings.value.enabled ||
      !this.settings.value.photoSearch
    )
      throw new ResolverError(
        "upstream_unavailable",
        "Search expired; search again",
      );
    const d = await this.http.getBytes(p.url, [new URL(p.url).hostname]);
    if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(d.contentType))
      throw new ResolverError("parse_error", "Unsupported image");
    return {
      data: d.bytes.toString("base64"),
      sourceUrl: p.url,
      sourcePageUrl: p.page,
    };
  }
}
