import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  catalogSeedScope,
  validateCatalogSeed,
} from "../lib/component-catalog-seed.ts";
import {
  seedBatch,
  seedEntry,
  readySeedPhoto,
} from "./support/component-seed.ts";
import {
  hash,
  loadCatalogSeedBundle,
  defaultSeedDirectory,
} from "../scripts/component-catalog-seed.ts";
import { seedSiteDefaults, testDatabase } from "./support/database.ts";
import { componentIdentity } from "../services/bike-resolver/src/component-identity.ts";

const scope = catalogSeedScope.parse(
  JSON.parse(
    await readFile(
      new URL("../data/component-catalog/v1/scope.json", import.meta.url),
      "utf8",
    ),
  ),
);

test("the shipped package passes media validation and the real SQL catalog admission policy", async () => {
  const bundle = await loadCatalogSeedBundle(defaultSeedDirectory);
  const db = await testDatabase();
  try {
    await seedSiteDefaults(db);
    const approved = bundle.batch.entries.filter(
      (entry) => entry.status === "approved",
    );
    assert.ok(approved.length >= 300);
    for (const category of scope.categories.filter(
      (category) => category.included,
    ))
      assert.ok(
        approved.some((entry) => entry.category === category.category),
        category.category,
      );
    const { rows } = await db.query<{ seed_key: string }>(
      `SELECT value->>'seedKey' seed_key FROM jsonb_array_elements($1::jsonb) value
       WHERE NOT component_catalog_name(value->>'name')
       OR component_catalog_brand(value->>'name') IS DISTINCT FROM value->>'brand'
       OR component_catalog_category(value->>'category') IS DISTINCT FROM value->>'category'`,
      [JSON.stringify(approved)],
    );
    assert.deepEqual(rows, []);
    for (const name of [
      "Manitou Mattoc Expert",
      "Hayes Dominion A4",
      "Crankbrothers Eggbeater 3",
    ])
      assert.equal(componentIdentity({ description: name })?.name, name);
  } finally {
    await db.close();
  }
});

test("the complete taxonomy is classified and text can be approved without photo rights", () => {
  const result = validateCatalogSeed(seedBatch(), scope);
  assert.deepEqual(result.counts, {
    approved: 1,
    photos: 0,
    bytes: 0,
    excluded: 0,
  });
  for (const category of [
    "Передний свет",
    "Каретка",
    "Передняя покрышка",
    "Рама",
    "Мотор",
  ]) {
    const entry = seedEntry();
    entry.category = category;
    assert.throws(
      () => validateCatalogSeed(seedBatch([entry]), scope),
      /out-of-scope/,
    );
  }
  const altered = structuredClone(scope);
  altered.categories.find((c) => c.category === "Передний свет")!.included =
    true;
  assert.throws(
    () => validateCatalogSeed(seedBatch(), altered),
    /mechanical v1 boundary/,
  );
  assert.throws(
    () =>
      validateCatalogSeed(seedBatch(), {
        ...scope,
        categories: scope.categories.slice(1),
      }),
    /exactly once/,
  );
});

test("identities are normalized by the existing helper, with exact aliases and source codes", () => {
  const unknownBrand = seedEntry();
  unknownBrand.brand = "Unverified maker";
  assert.throws(
    () => validateCatalogSeed(seedBatch([unknownBrand]), scope),
    /shared vocabulary/,
  );
  for (const code of [
    "CS-M7100",
    "CN-M8100",
    "SM-RT66",
    "BL-MT200",
    "FS-UPK-CH3-A1",
  ])
    assert.throws(
      () => validateCatalogSeed(seedBatch([seedEntry(code)]), scope),
      /spec-only/,
    );
  for (const model of [
    "N/A",
    "Unknown",
    "RD-M6100-SGS 170 mm",
    "<b>RD-M6100-SGS</b>",
  ]) {
    const entry = seedEntry();
    entry.model = model;
    assert.throws(() => validateCatalogSeed(seedBatch([entry]), scope));
  }
  const first = seedEntry(),
    second = seedEntry("RD-M5100-SGS");
  second.aliases.push(first.name.toUpperCase());
  assert.throws(
    () => validateCatalogSeed(seedBatch([first, second]), scope),
    /duplicate name\/alias/,
  );
  second.aliases.pop();
  assert.equal(
    validateCatalogSeed(seedBatch([first, second]), scope).counts.approved,
    2,
  );
  second.sources[0].facts[0].value = "RD-M6100-SGS";
  assert.throws(
    () => validateCatalogSeed(seedBatch([second]), scope),
    /no matching source fact/,
  );
});

test("unverified, orphaned and retailer-only evidence cannot approve an identity", () => {
  const entry = seedEntry();
  entry.identity.verified = false;
  assert.throws(
    () => validateCatalogSeed(seedBatch([entry]), scope),
    /unverified identity/,
  );
  entry.status = "needs_review";
  assert.equal(
    validateCatalogSeed(seedBatch([entry]), scope).counts.approved,
    0,
  );
  entry.status = "approved";
  entry.identity.verified = true;
  entry.identity.sourceIds = ["missing"];
  assert.throws(
    () => validateCatalogSeed(seedBatch([entry]), scope),
    /evidence/,
  );
  entry.identity.sourceIds = ["official"];
  entry.sources[0].role = "retailer";
  assert.throws(
    () => validateCatalogSeed(seedBatch([entry]), scope),
    /primary source/,
  );
});

test("missing descriptions are explained; approved media has rights, unique bytes and bounded cost", () => {
  const entry = seedEntry();
  entry.description = null;
  assert.throws(
    () => validateCatalogSeed(seedBatch([entry]), scope),
    /description needs a reason/,
  );
  entry.descriptionGap = "Не хватает подтверждённых характеристик.";
  entry.photo = readySeedPhoto();
  const batch = seedBatch([entry]);
  batch.limits.photos = 0;
  assert.throws(() => validateCatalogSeed(batch, scope), /explicit limits/);
  batch.limits.photos = 2;
  entry.photo.source.license = "All rights reserved";
  assert.throws(() => validateCatalogSeed(batch, scope), /license/);
  entry.photo.source.license = "CC BY-SA 4.0";
  const second = seedEntry("RD-M5100-SGS");
  second.photo = { ...readySeedPhoto(), file: "media/another-file.webp" };
  assert.throws(
    () => validateCatalogSeed(seedBatch([entry, second]), scope),
    /photo bytes reused/,
  );
});

test("bundle validation is read-only and rejects missing, substituted and unnormalized media", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cola-seed-validation-"));
  try {
    const entry = seedEntry();
    entry.photo = readySeedPhoto();
    const pixels = {
      create: {
        width: 600,
        height: 400,
        channels: 3 as const,
        background: "#708090",
      },
    };
    const bytes = await sharp(pixels).webp().toBuffer();
    entry.photo.bytes = bytes.length;
    entry.photo.sha256 = hash(bytes);
    const batch = seedBatch([entry]);
    await writeFile(path.join(directory, "scope.json"), JSON.stringify(scope));
    const writeCatalog = () =>
      writeFile(path.join(directory, "catalog.json"), JSON.stringify(batch));
    await writeCatalog();
    assert.deepEqual((await readdir(directory)).sort(), [
      "catalog.json",
      "scope.json",
    ]);
    await assert.rejects(
      loadCatalogSeedBundle(directory, undefined),
      /Media validation failed/,
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      "catalog.json",
      "scope.json",
    ]);
    await mkdir(path.join(directory, "media"));
    await writeFile(path.join(directory, entry.photo.file), bytes);
    const valid = await loadCatalogSeedBundle(directory, undefined);
    assert.equal(valid.counts.photos, 1);
    await loadCatalogSeedBundle(directory, valid.sha256);
    await assert.rejects(
      loadCatalogSeedBundle(directory, "0".repeat(64)),
      /approved release/,
    );
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    await writeFile(path.join(directory, entry.photo.file), changed);
    await assert.rejects(
      loadCatalogSeedBundle(directory, undefined),
      /SHA-256 mismatch/,
    );
    const png = await sharp(pixels).png().toBuffer();
    entry.photo.bytes = png.length;
    entry.photo.sha256 = hash(png);
    await writeCatalog();
    await writeFile(path.join(directory, entry.photo.file), png);
    await assert.rejects(
      loadCatalogSeedBundle(directory, undefined),
      /normalized still WebP/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
