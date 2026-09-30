export const commitUncertain = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  "commitUncertain" in error &&
  error.commitUncertain === true;
import pg from "pg";
import type { QueryResult } from "pg";
export type QueryRows<Row extends object> = Pick<
  QueryResult<Row>,
  "rows" | "rowCount"
>;
export interface Queryable {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryRows<Row>>;
}
export type TransactionClient = Queryable & Pick<pg.PoolClient, "release">;
declare global {
  var colaPool: pg.Pool | undefined;
}
const globalDb = globalThis;
const pool =
  globalDb.colaPool ||
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
  });
export const db: Queryable & Pick<pg.Pool, "connect" | "end"> = pool;
if (process.env.NODE_ENV !== "production") globalDb.colaPool = pool;
export async function transaction<T>(
  fn: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const client: TransactionClient = await pool.connect();
  let committing = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (e) {
    if (committing && typeof e === "object" && e !== null)
      Object.assign(e, { commitUncertain: true });
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
