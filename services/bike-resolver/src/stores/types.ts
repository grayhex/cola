import type { BikeQuery, ParsedBike, SourceDocument } from "../domain.js";
import type { ManufacturerHttpClient } from "../http.js";

export interface StoreEnv {
  http: ManufacturerHttpClient;
  /** Upper bound of product pages worth verifying for one query. */
  limit: number;
}
// A registered retailer. It owns its domains, recognizes its product pages and
// knows how to read them; a store without `discover` still serves pasted URLs.
export interface RetailStore {
  readonly id: string;
  readonly name: string;
  /** Exact hostnames; redirects leaving this list are refused. */
  readonly allowedDomains: string[];
  readonly storeVersion: number;
  /** True when discovery by the store's own public catalogue is implemented. */
  readonly search: boolean;
  /** True when discovery sees only part of the catalogue (a miss proves nothing). */
  readonly partial?: boolean;
  /** Any page of this store (used to route pasted URLs to its parser). */
  owns(url: URL): boolean;
  /** Stable product id shared by localized pages, or null for other pages. */
  productKey(url: URL): string | null;
  /** The URL to request for a product page (locale canonicalization). */
  fetchUrl(url: string): string;
  /** Product page URLs matching the query, best first, at most `env.limit`. */
  discover?(query: BikeQuery, env: StoreEnv): Promise<string[]>;
  /** Reads a product page; refuses frames, parts and unreadable pages. */
  parse(doc: SourceDocument, query: BikeQuery): ParsedBike;
}
