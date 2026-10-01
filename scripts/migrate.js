import { logError } from "../lib/observability.ts";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(741204)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  // Retired migration numbers stay reserved. Existing history rows are not
  // reconciled against this list: upgrades never delete or rewrite history.
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
    "010_community",
    "011_gamification",
    "012_rides",
    "014_journal",
    "015_discovery",
    "016_product_ui",
    "017_rides_market",
    "018_articles_rsvp",
    "019_legal_documents",
    "020_bike_classification",
    "021_former_bikes_market_types",
    "022_auth_tokens",
    "023_public_urls",
    "024_username_history",
    "025_account_sessions",
    "026_market_expiry",
    "027_game_rules",
    "028_component_models",
    "029_component_community",
    "030_market_catalog_links",
    "031_chat_lifecycle",
    "032_component_photo_search",
    "033_component_products",
    "034_activity_sync",
    "035_ride_analysis",
    "036_ride_passport",
    "037_ride_intents",
    "038_ride_matching",
    "039_ride_file_maintenance",
    "040_ride_interest_proposals",
    "041_component_descriptions",
    "042_ride_agreements",
    "043_notification_email",
    "044_bike_week",
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
