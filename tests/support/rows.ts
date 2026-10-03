// Rows built from the production row types. A builder gives sensible defaults,
// the test names only what it is about, and the result is the row the database
// stored (`RETURNING *`), typed like the rows the services read. A column the
// row type does not have is a compile error, so a renamed column is found by
// the compiler before the first runtime failure.
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";

/**
 * The columns of a row a builder may set. A timestamp may also be given as the
 * text PostgreSQL reads (microseconds survive in text, not in a `Date`).
 */
export type Columns<Row extends object> = Partial<{
  [Key in keyof Row]: Row[Key] extends Date | null
    ? Row[Key] | string
    : Row[Key];
}>;

function parameter(value: unknown, asJson: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value === "object" && (asJson || !Array.isArray(value)))
    return JSON.stringify(value);
  return value;
}

/**
 * `INSERT … RETURNING *` for the columns that are given. Plain objects are
 * written as JSON; an array is a SQL array unless its column is named in
 * `jsonArrays` (a JSON array in a `jsonb` column).
 */
export async function insertRow<Row extends object>(
  q: Queryable,
  table: string,
  values: Columns<Row>,
  jsonArrays: readonly (keyof Row & string)[] = [],
): Promise<Row> {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined,
  );
  const result = await q.query<Row>(
    `INSERT INTO ${table}(${entries.map(([key]) => key).join(",")}) VALUES(${entries.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
    entries.map(([key, value]) =>
      parameter(value, (jsonArrays as readonly string[]).includes(key)),
    ),
  );
  const row = result.rows[0];
  if (!row) throw new Error(`INSERT INTO ${table} returned no row`);
  return row;
}

/** A short unique token for names, usernames and slugs. */
export const unique = () => randomUUID().replaceAll("-", "").slice(0, 12);

/** An instant given as a Date, an ISO string or milliseconds. */
export const instant = (value: Date | string | number) => new Date(value);

/** The only row of a query that must return exactly one. */
export async function one<Row extends object>(
  q: Queryable,
  sql: string,
  values?: unknown[],
): Promise<Row> {
  const { rows } = await q.query<Row>(sql, values);
  if (rows.length !== 1)
    throw new Error(`expected one row, got ${rows.length}: ${sql}`);
  return rows[0] as Row;
}

/**
 * `values` without the keys that are `undefined`, so that a test can pass an
 * optional value through (`{ price: options.price }`) and the default stays.
 */
export function given<Values extends object>(values: Values): Values {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Values;
}
