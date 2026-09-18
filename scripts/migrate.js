import { logError } from "../lib/observability.js";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(741204)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const version of [
    "001_initial",
    "002_admin",
    "003_factory_spec",
    "004_garage_layout",
    "005_bike_wizard",
    "006_compact_defaults",
    "007_showcase",
    "008_beta_limits",
    "009_social_core",
  ]) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version=$1",
      [version],
    );
    if (!rowCount) {
      await client.query(
        await readFile(
          new URL(`../db/${version}.sql`, import.meta.url),
          "utf8",
        ),
      );
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        version,
      ]);
      console.log(`Applied ${version}`);
    }
  }
  await client.query(
    "INSERT INTO site_settings(id,value) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(defaultSettings)],
  );
  await client.query(
    "INSERT INTO site_catalog(id,value) VALUES(1,$1) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(defaultCatalog)],
  );
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  logError("migration_failed", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
