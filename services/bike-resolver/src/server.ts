import pg from "pg";
import pino from "pino";
import { readFile } from "node:fs/promises";
import { PostgresCache } from "./cache.js";
import { ManufacturerHttpClient } from "./http.js";
import { createAdapters } from "./adapters/index.js";
import { Resolver } from "./resolver.js";
import { SettingsStore } from "./settings.js";
import { buildApp } from "./app.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(741205)");
  await client.query("CREATE SCHEMA IF NOT EXISTS bike_resolver");
  await client.query(
    "CREATE TABLE IF NOT EXISTS bike_resolver.schema_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const version of ["001_cache", "002_settings", "003_source_policy"]) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM bike_resolver.schema_migrations WHERE version=$1",
      [version],
    );
    if (!rowCount) {
      await client.query(
        await readFile(
          new URL(`../migrations/${version}.sql`, import.meta.url),
          "utf8",
        ),
      );
      await client.query(
        "INSERT INTO bike_resolver.schema_migrations(version) VALUES($1)",
        [version],
      );
    }
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
}
const settings = new SettingsStore(db);
await settings.load();
const cache = new PostgresCache(db, () => settings.value),
  resolver = new Resolver(
    createAdapters(
      new ManufacturerHttpClient(logger, 700, 10000, () => settings.value),
    ),
    cache,
    logger,
  ),
  app = buildApp(resolver, cache, settings);
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 8080) });
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
