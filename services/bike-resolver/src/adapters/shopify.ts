import { z } from "zod";
import { CatalogueAdapter } from "./base.js";
import { checkAbort } from "../context.js";
import { normalize } from "../normalize.js";
import {
  ResolverError,
  type BikeCandidate,
  type BikeQuery,
} from "../domain.js";

// The predictive search of a Shopify storefront: the public endpoint behind the
// shop's own search box. It needs no key and answers with titles, product
// types and the product description.
const suggestions = z.object({
  resources: z.object({
    results: z.object({
      products: z.array(
        z.object({
          id: z.union([z.number(), z.string()]).optional(),
          title: z.string(),
          handle: z.string(),
          type: z.string().default(""),
          body: z.string().default(""),
        }),
      ),
    }),
  }),
});
export type ShopifyHit = z.infer<
  typeof suggestions
>["resources"]["results"]["products"][number];

export abstract class ShopifyAdapter extends CatalogueAdapter {
  productPath = /^\/products\/[^/]+$/;
  // The shop's own product type tells a ready bike from a frameset, a part,
  // an accessory or a used bike.
  protected abstract isBike(hit: ShopifyHit): boolean;
  // The model as a rider names it, without the shop's marketing words.
  protected abstract nameOf(hit: ShopifyHit): string;
  protected yearOf(_hit: ShopifyHit): number | null {
    return null;
  }
  protected async suggest(terms: string): Promise<ShopifyHit[]> {
    checkAbort();
    const url =
      `${this.origin}/search/suggest.json?q=${encodeURIComponent(terms)}` +
      "&resources%5Btype%5D=product&resources%5Blimit%5D=10";
    const doc = await this.http.get(url, this.allowedDomains);
    let json: unknown;
    try {
      json = JSON.parse(doc.body);
    } catch {
      json = undefined;
    }
    const parsed = suggestions.safeParse(json);
    if (!parsed.success)
      throw new ResolverError(
        "parse_error",
        "Storefront search answered in an unknown format",
        false,
        "selector_profile_failed",
      );
    return parsed.data.resources.results.products;
  }
  // The shop's search is fuzzy; a hit counts when it carries the whole model
  // or, for a model of three words or more, most of it ("Cyclone 3rd EVO" is
  // offered the Cyclone 3rd builds: the person sees the real names and chooses).
  private close(name: string, q: BikeQuery) {
    if (this.matchesModel(name, q)) return true;
    const model = normalize(q.model).split(" ").filter(Boolean),
      words = new Set(normalize(name).split(" "));
    return (
      model.length > 2 &&
      model.filter((w) => words.has(w)).length / model.length > 0.5
    );
  }
  private matching(hits: ShopifyHit[], q: BikeQuery) {
    return hits.filter(
      (hit) => this.isBike(hit) && this.close(this.nameOf(hit), q),
    );
  }
  // One candidate per page by default; a shop that sells several builds on one
  // page offers each build separately.
  protected candidatesOf(hit: ShopifyHit): BikeCandidate[] {
    return [
      {
        brand: this.brand,
        url: `${this.origin}/products/${hit.handle}`,
        canonicalName: this.nameOf(hit),
        year: this.yearOf(hit),
        ...(hit.id === undefined
          ? {}
          : { manufacturerProductId: String(hit.id) }),
      },
    ];
  }
  async discover(q: BikeQuery): Promise<BikeCandidate[]> {
    const terms = [q.model, q.trim].filter(Boolean).join(" ");
    if (!normalize(terms)) return [];
    let hits = this.matching(await this.suggest(terms), q);
    if (!hits.length && q.trim)
      hits = this.matching(await this.suggest(q.model), q);
    return hits.flatMap((hit) => this.candidatesOf(hit));
  }
}
