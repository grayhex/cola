import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Queryable } from "../../lib/db.ts";
import type { MarketRow } from "../../lib/database-rows.ts";
import { listingInput } from "../../lib/market.ts";
import type { ListingInput } from "../../lib/market.ts";
import { given, insertRow, type Columns } from "./rows.ts";

/**
 * A valid, published sale listing of used components, as the services take it
 * (already through `listingInput`). `extra` is what the test is about.
 */
export function listingDraft(
  extra: Partial<z.input<typeof listingInput>> = {},
): ListingInput {
  return listingInput.parse({
    title: "Wheelset",
    description: "Synthetic listing",
    category: "components",
    listingType: "sale",
    condition: "used",
    price: 1000,
    location: "Test city",
    contact: "+7 900 000-00-00",
    status: "active",
    ...extra,
  });
}

export type ListingRowOverrides = Columns<Omit<MarketRow, "price">> & {
  /** In rubles; `null` for a listing without a price. */
  price?: number | null;
};

/**
 * A stored listing of `ownerId`. By default it is on the market: published
 * now, with a term that ends far away; a draft has neither. `overrides` are
 * columns of `market_listings`.
 */
export function listingRow(
  q: Queryable,
  ownerId: string,
  overrides: ListingRowOverrides = {},
): Promise<MarketRow> {
  const id = overrides.id ?? randomUUID();
  const status = overrides.status ?? "active";
  const { price, ...columns } = overrides;
  return insertRow<MarketRow>(q, "market_listings", {
    id,
    share_id: randomUUID(),
    owner_id: ownerId,
    title: "Лот " + id.slice(0, 6),
    description: "Описание",
    category: "components",
    condition: "used",
    price: price === undefined ? "1000" : price === null ? null : String(price),
    currency: "RUB",
    location: "Москва",
    contact: "tg: @seller_" + id.slice(0, 4),
    status,
    listing_type: "sale",
    published_at: status === "draft" ? null : new Date(),
    expires_at: status === "active" ? new Date("2099-01-01T00:00:00Z") : null,
    ...given(columns),
  });
}
