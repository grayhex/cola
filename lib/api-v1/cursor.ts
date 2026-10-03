import type { MarketCursor, MarketSort } from "../market.ts";
import type { BikeCursor } from "../showcase.ts";
import { z } from "zod";
import { ApiError } from "./errors.ts";

// The opaque page cursor of GET /api/v1/bikes (#134). It only says where the
// next page starts; the visibility rule applies to every page, so a forged
// cursor can move the position and nothing else.

// PostgreSQL's own text for created_at: microseconds, UTC (lib/showcase.ts).
const microsecondTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const position = z.strictObject({
  t: z.string().regex(microsecondTimestamp),
  i: z.uuid(),
});

export function encodeCursor(cursor: BikeCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt, i: cursor.id }),
  ).toString("base64url");
}

export function decodeCursor(raw: string): BikeCursor {
  try {
    const parsed = position.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    throw new ApiError("invalid_request", "Неверный курсор страницы.", {
      details: [
        {
          path: "cursor",
          message: "Курсор не распознан; начните список с первой страницы.",
        },
      ],
    });
  }
}

// The cursor of a list ordered by a count (#317): the count the last item had
// when the page was made, and its id. A count drifts as the data changes, so a
// walk by it is approximate (an item whose count changes between two pages may
// be seen twice or missed); the contract says so. A different shape from the
// timestamp cursor, so one list's cursor is refused by the other.
const rankPosition = z.strictObject({
  n: z.int().min(0).max(1_000_000_000),
  i: z.uuid(),
});
export interface RankCursor {
  rank: number;
  id: string;
}

export function encodeRankCursor(cursor: RankCursor): string {
  return Buffer.from(JSON.stringify({ n: cursor.rank, i: cursor.id })).toString(
    "base64url",
  );
}

export function decodeRankCursor(raw: string): RankCursor {
  try {
    const parsed = rankPosition.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return { rank: parsed.n, id: parsed.i };
  } catch {
    throw new ApiError("invalid_request", "Неверный курсор страницы.", {
      details: [
        {
          path: "cursor",
          message: "Курсор не распознан; начните список с первой страницы.",
        },
      ],
    });
  }
}

// The cursor of the market in a price order (#319): the price the last listing
// had (as the text the database keeps, null for one without a price), when it
// was published, its id and the order it belongs to. Its own shape, so the
// list in the order of publication refuses it, and the other way round; the
// order is in it because the same position means the opposite page in the
// opposite price order.
const priceText = /^\d{1,10}(\.\d{1,2})?$/;
const pricePosition = z.strictObject({
  p: z.string().regex(priceText).nullable(),
  t: z.string().regex(microsecondTimestamp),
  i: z.uuid(),
  s: z.enum(["price_asc", "price_desc"]),
});

export function encodeMarketCursor(
  cursor: MarketCursor,
  sort: MarketSort,
): string {
  return Buffer.from(
    JSON.stringify(
      sort === "new"
        ? { t: cursor.publishedAt, i: cursor.id }
        : {
            p: cursor.price ?? null,
            t: cursor.publishedAt,
            i: cursor.id,
            s: sort,
          },
    ),
  ).toString("base64url");
}

/** The cursor of the listing order in use; another order's cursor is a 400. */
export function decodeMarketCursor(
  raw: string,
  sort: MarketSort,
): MarketCursor {
  if (sort === "new") {
    const { createdAt, id } = decodeCursor(raw);
    return { publishedAt: createdAt, id };
  }
  try {
    const parsed = pricePosition.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (parsed.s !== sort) throw new Error("another order");
    return { price: parsed.p, publishedAt: parsed.t, id: parsed.i };
  } catch {
    throw new ApiError("invalid_request", "Неверный курсор страницы.", {
      details: [
        {
          path: "cursor",
          message: "Курсор не распознан; начните список с первой страницы.",
        },
      ],
    });
  }
}
