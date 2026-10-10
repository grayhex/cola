import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  loadCatalogSeedBundle,
  defaultSeedDirectory,
} from "../scripts/component-catalog-seed.ts";
import {
  validateCatalogSeed,
  seedAccessoryCategories,
} from "../lib/component-catalog-seed.ts";
import {
  planCatalogSeed,
  applyCatalogSeed,
  verifyCatalogSeed,
} from "../lib/component-seed-import.ts";
import { testDatabase, seedSiteDefaults } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { componentPhotoRow } from "./support/components.ts";
import { seedBatch, seedEntry } from "./support/component-seed.ts";
import { defaultCatalog } from "../lib/site-defaults.ts";
import {
  productCategories,
  pairedCategories,
} from "../lib/component-products.ts";
import type { SiteCatalog } from "../lib/contracts.ts";

const directory = fileURLToPath(
  new URL("../data/component-catalog/accessories-v1/", import.meta.url),
);
const bundle = await loadCatalogSeedBundle(directory);
const backup = {
  file: "test.dump",
  sha256: "b".repeat(64),
  bytes: 1,
  createdAt: "2026-10-10T00:00:00Z",
};

test("accessory package is complete, text-only and does not change the published mechanical package", async () => {
  assert.equal(bundle.counts.approved, 301);
  assert.equal(bundle.counts.photos, 0);
  assert.equal(bundle.counts.bytes, 0);
  assert.ok(
    bundle.batch.entries.every(
      (e) => e.description && e.photo.status === "not_requested",
    ),
  );
  assert.deepEqual(
    new Set(bundle.batch.entries.map((e) => e.category)),
    new Set(seedAccessoryCategories),
  );
  assert.equal(
    (await loadCatalogSeedBundle(defaultSeedDirectory)).sha256,
    "91a76b9ec197fdcadff85f75268fe93897b8a501f656753186c3c1f5722f934f",
  );
});

test("retailer fallback needs a documented gap and independent shops, only for accessories", async () => {
  const entry = structuredClone(
    bundle.batch.entries.find((e) => e.brand === "Apidura")!,
  );
  const single = { ...bundle.batch, entries: [entry] };
  validateCatalogSeed(single, bundle.scope);
  delete entry.identity.primarySourceGap;
  assert.throws(
    () => validateCatalogSeed(single, bundle.scope),
    /primary source/,
  );
  entry.identity.primarySourceGap =
    "Первичный источник недоступен; два независимых продавца проверены редактором.";
  const second = entry.sources[1].url;
  entry.sources[1].url = entry.sources[0].url + "?other=page";
  assert.throws(
    () => validateCatalogSeed(single, bundle.scope),
    /primary source/,
  );
  entry.sources[1].url = entry.sources[0].url.replace("www.", "shop.");
  assert.throws(
    () => validateCatalogSeed(single, bundle.scope),
    /primary source/,
  );
  entry.sources[1].url = second;
  entry.identity.sourceIds = [entry.sources[0].id];
  assert.throws(
    () => validateCatalogSeed(single, bundle.scope),
    /primary source/,
  );
  const mechanical = seedEntry();
  mechanical.identity.primarySourceGap = entry.identity.primarySourceGap;
  mechanical.sources = structuredClone(
    bundle.batch.entries.find((e) => e.brand === "Apidura")!.sources,
  );
  mechanical.identity.sourceIds = mechanical.sources.map((s) => s.id);
  const old = await loadCatalogSeedBundle(defaultSeedDirectory);
  assert.throws(
    () => validateCatalogSeed(seedBatch([mechanical]), old.scope),
    /primary source/,
  );
});

test("SQL admits all 301 accessories; separate batch preserves mechanical cards and user text/photos; repeat is a no-op", async () => {
  const db = await testDatabase();
  try {
    await seedSiteDefaults(db);
    const admin = await userRow(db, {
      role: "admin",
      email_verified_at: new Date(),
    });
    const invalid = await db.query<{ name: string }>(
      `SELECT value->>'name' name FROM jsonb_array_elements($1::jsonb) value
       WHERE NOT component_catalog_name(value->>'name')
       OR component_catalog_brand(value->>'name') IS DISTINCT FROM value->>'brand'
       OR component_catalog_category(value->>'category') IS DISTINCT FROM value->>'category'`,
      [JSON.stringify(bundle.batch.entries)],
    );
    assert.deepEqual(invalid.rows, []);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM component_product_policy",
        )
      ).rows[0].n,
      productCategories.length + Object.keys(pairedCategories).length,
    );
    const mechanical = seedBatch();
    const oldPlan = await planCatalogSeed(
      db,
      mechanical,
      "a".repeat(64),
      admin.id,
    );
    const oldApplied = await applyCatalogSeed(
      db.transaction,
      mechanical,
      oldPlan,
      backup,
      new Map(),
    );
    const oldId = oldApplied[0].modelId;
    const oldSnapshot = (
      await db.query(
        "SELECT to_jsonb(m) row FROM component_models m WHERE id=$1",
        [oldId],
      )
    ).rows;
    const existing = bundle.batch.entries[0];
    const {
      rows: [{ id }],
    } = await db.query<{ id: string }>(
      "SELECT component_model_assign($1,$2) id",
      [existing.category, existing.name],
    );
    await db.query(
      "UPDATE component_models SET first_public_at=now(),description='Описание владельца' WHERE id=$1",
      [id],
    );
    await componentPhotoRow(db, id, admin.id);
    const beforePhotos = (
      await db.query("SELECT to_jsonb(p) row FROM component_photos p")
    ).rows;
    const plan = await planCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.equal(plan.entries.filter((e) => e.action === "new").length, 300);
    assert.equal(
      plan.entries.find((e) => e.seedKey === existing.seedKey)?.action,
      "reuse",
    );
    assert.ok(
      plan.entries.every((e) => e.photo === "none" || e.photo === "preserve"),
    );
    await applyCatalogSeed(
      db.transaction,
      bundle.batch,
      plan,
      backup,
      new Map(),
    );
    const verified = await verifyCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.equal(verified.entries.length, 301);
    assert.ok(verified.entries.every((e) => e.public));
    assert.ok(
      verified.entries
        .filter((e) => e.seedKey !== existing.seedKey)
        .every((e) => e.descriptionMatches && !e.edited),
    );
    assert.equal(
      (
        await db.query<{ description: string }>(
          "SELECT description FROM component_models WHERE id=$1",
          [id],
        )
      ).rows[0].description,
      "Описание владельца",
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT to_jsonb(m) row FROM component_models m WHERE id=$1",
          [oldId],
        )
      ).rows,
      oldSnapshot,
    );
    assert.deepEqual(
      (await db.query("SELECT to_jsonb(p) row FROM component_photos p")).rows,
      beforePhotos,
    );
    const snapshot = async () =>
      Promise.all(
        [
          "component_models",
          "component_model_names",
          "component_model_urls",
          "component_seed_batches",
          "component_seed_entries",
          "components",
          "journal_entries",
        ].map(
          async (table) =>
            (
              await db.query(
                `SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
        ),
      );
    const after = await snapshot();
    const repeat = await planCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.ok(repeat.entries.every((e) => e.action === "already"));
    await applyCatalogSeed(
      db.transaction,
      bundle.batch,
      repeat,
      backup,
      new Map(),
    );
    assert.deepEqual(await snapshot(), after);
  } finally {
    await db.close();
  }
});

test("rack-bag migration appends once without replacing customized catalog settings", async () => {
  const db = await testDatabase();
  try {
    await seedSiteDefaults(db);
    const catalog: SiteCatalog = structuredClone(defaultCatalog);
    catalog.partCategories.accessories = ["Замок", "Насос"];
    const equipment = catalog.componentGroups.find(
      (g) => g.id === "equipment",
    )!;
    equipment.name = "Моё оборудование";
    equipment.categories = ["Замок"];
    await db.query("UPDATE site_catalog SET value=$1,version=7 WHERE id=1", [
      JSON.stringify(catalog),
    ]);
    const migration = await readFile(
      new URL("../db/065_accessory_catalog.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    const first = await db.query<{ value: SiteCatalog; version: number }>(
      "SELECT value,version FROM site_catalog",
    );
    catalog.partCategories.accessories.push("Сумка на багажник");
    equipment.categories.push("Сумка на багажник");
    assert.deepEqual(first.rows[0].value, catalog);
    assert.ok(first.rows[0].version > 7);
    await db.exec(migration);
    assert.deepEqual(
      (await db.query("SELECT value,version FROM site_catalog")).rows,
      first.rows,
    );
  } finally {
    await db.close();
  }
});
