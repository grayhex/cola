import pg from "pg";
const globalDb = globalThis;
export const db =
  globalDb.colaPool ||
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
  });
if (process.env.NODE_ENV !== "production") globalDb.colaPool = db;
export async function transaction(fn) {
  const client = await db.connect();
  let committing = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (e) {
    if (committing) e.commitUncertain = true;
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
