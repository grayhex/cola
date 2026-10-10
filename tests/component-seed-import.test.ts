import { test } from "node:test";
import type { Resolved } from "../services/bike-resolver/src/domain.ts";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDatabase, seedSiteDefaults } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { seedBatch, seedEntry } from "./support/component-seed.ts";
import {
  findSeedActor,
  planCatalogSeed,
  applyCatalogSeed,
  rollbackCatalogSeed,
  seedPhotoId,
  verifyCatalogSeed,
} from "../lib/component-seed-import.ts";
import {
  loadCatalogSeedBundle,
  defaultSeedDirectory,
} from "../scripts/component-catalog-seed.ts";
import type { PreparedComponentPhoto } from "../lib/component-photos.ts";

const sha = "a".repeat(64);
const backup = {
  file: "test.dump",
  sha256: "b".repeat(64),
  bytes: 1,
  createdAt: "2026-10-09T00:00:00Z",
};
async function setup() {
  const db = await testDatabase();
  await seedSiteDefaults(db);
  const admin = await userRow(db, {
    role: "admin",
    email_verified_at: new Date(),
  });
  return { db, admin };
}
async function snapshot(db: Awaited<ReturnType<typeof testDatabase>>) {
  const tables = [
    "component_models",
    "component_model_names",
    "component_model_urls",
    "component_photos",
    "component_seed_batches",
    "component_seed_entries",
    "components",
    "journal_entries",
  ];
  return Promise.all(
    tables.map(
      async (t) =>
        (
          await db.query(
            `SELECT to_jsonb(t) row FROM ${t} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
    ),
  );
}
test("full offline catalog: 399 independent models, 4 attributed photos, exact aliases, repeat has no diff", async () => {
  const { db, admin } = await setup();
  const dir = await mkdtemp(path.join(tmpdir(), "cola-seed-"));
  const old = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const bundle = await loadCatalogSeedBundle(defaultSeedDirectory);
    const media = new Map<string, PreparedComponentPhoto>();
    for (const e of bundle.batch.entries)
      if (e.photo.status === "ready") {
        const id = seedPhotoId(bundle.batch.batch, e.seedKey, e.photo.sha256);
        media.set(e.seedKey, {
          id,
          filename: `component-${id}.webp`,
          bytes: await readFile(path.join(bundle.root, e.photo.file)),
          width: e.photo.width,
          height: e.photo.height,
          source: e.photo.source,
        });
      }
    const before = await snapshot(db);
    const files = await readdir(dir);
    const plan = await planCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.deepEqual(await snapshot(db), before);
    assert.deepEqual(await readdir(dir), files);
    assert.equal(plan.entries.filter((e) => e.action === "new").length, 399);
    const applied = await applyCatalogSeed(
      db.transaction,
      bundle.batch,
      plan,
      backup,
      media,
    );
    assert.equal(applied.filter((e) => e.state === "created").length, 399);
    const { verifySeedFiles } =
      await import("../scripts/component-catalog-import.ts");
    const verified = await verifyCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.ok(
      verified.entries.every(
        (e) => e.public && e.descriptionMatches && !e.edited,
      ),
    );
    await verifySeedFiles(verified, bundle);

    assert.equal((await db.query("SELECT * FROM components")).rows.length, 0);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM component_photos WHERE source IS NOT NULL AND author_id=$1",
          [admin.id],
        )
      ).rows.length,
      4,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM component_models WHERE first_public_at IS NOT NULL AND description<>''",
        )
      ).rows.length,
      399,
    );
    for (const e of bundle.batch.entries)
      for (const name of [e.name, ...e.aliases]) {
        const match = (
          await db.query<{ id: string }>(
            "SELECT component_model_assign($1,$2) id",
            [e.category, name],
          )
        ).rows[0];
        assert.equal(
          match.id,
          applied.find((p) => p.seedKey === e.seedKey)?.modelId,
        );
      }
    const after = await snapshot(db);
    const afterFiles = await readdir(dir);
    const repeat = await planCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.ok(repeat.entries.every((e) => e.action === "already"));
    await applyCatalogSeed(db.transaction, bundle.batch, repeat, backup, media);
    assert.deepEqual(await snapshot(db), after);
    assert.deepEqual(await readdir(dir), afterFiles);
    // A populated legacy catalog has no seed journal. Every identity and photo
    // is reused, and an owner's changed description remains untouched.
    await db.query("DELETE FROM component_seed_entries");
    await db.query("DELETE FROM component_seed_batches");
    await db.query(
      "UPDATE component_models SET description='Редакция владельца',version=version+1 WHERE id=$1",
      [applied[0].modelId],
    );
    const populated = await snapshot(db);
    const existing = await planCatalogSeed(
      db,
      bundle.batch,
      bundle.sha256,
      admin.id,
    );
    assert.ok(existing.entries.every((e) => e.action === "reuse"));
    const reused = await applyCatalogSeed(
      db.transaction,
      bundle.batch,
      existing,
      backup,
      media,
    );
    assert.ok(reused.every((e) => e.state === "reused"));
    assert.deepEqual((await snapshot(db)).slice(0, 4), populated.slice(0, 4));
    assert.deepEqual(await readdir(dir), afterFiles);
  } finally {
    if (old === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = old;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("preserve private/archived identities, user descriptions, URLs, and edits between plan and apply", async () => {
  const { db, admin } = await setup();
  try {
    const batch = seedBatch([
      seedEntry(),
      seedEntry("RD-M7100-SGS"),
      seedEntry("RD-M8100-SGS"),
    ]);
    const ids: string[] = [];
    for (const e of batch.entries)
      ids.push(
        (
          await db.query<{ id: string }>(
            "SELECT component_model_assign($1,$2) id",
            [e.category, e.name],
          )
        ).rows[0].id,
      );
    await db.query(
      "UPDATE component_models SET first_public_at=now(),description='Авторский текст' WHERE id=$1",
      [ids[0]],
    );
    await db.query("UPDATE component_models SET archived=true WHERE id=$1", [
      ids[2],
    ]);
    const plan = await planCatalogSeed(db, batch, sha, admin.id);
    assert.equal(plan.entries[0].action, "fill-empty");
    assert.ok(plan.entries[0].preserved.includes("description"));
    assert.equal(plan.entries[1].action, "conflict");
    assert.equal(plan.entries[2].action, "conflict");
    await db.query(
      "UPDATE component_models SET description='Новая редакция',version=version+1 WHERE id=$1",
      [ids[0]],
    );
    const before = (
      await db.query("SELECT * FROM component_models ORDER BY id")
    ).rows;
    const result = await applyCatalogSeed(
      db.transaction,
      batch,
      plan,
      backup,
      new Map(),
    );
    assert.ok(result.every((e) => e.state === "conflict"));
    assert.deepEqual(
      (await db.query("SELECT * FROM component_models ORDER BY id")).rows,
      before,
    );
  } finally {
    await db.close();
  }
});
test("partial commit resumes, old batch preserves later edits, rollback only archives untouched creations", async () => {
  const { db, admin } = await setup();
  try {
    const batch = seedBatch([seedEntry(), seedEntry("RD-M7100-SGS")]);
    const plan = await planCatalogSeed(db, batch, sha, admin.id);
    let calls = 0;
    const uncertain: typeof db.transaction = async (fn) => {
      const result = await db.transaction(fn);
      if (++calls === 2)
        throw Object.assign(new Error("Lost commit reply"), {
          commitUncertain: true,
        });
      return result;
    };
    await assert.rejects(
      applyCatalogSeed(uncertain, batch, plan, backup, new Map()),
      /Lost commit/,
    );
    assert.equal(
      (await db.query("SELECT * FROM component_seed_entries")).rows.length,
      1,
    );
    const resumed = await applyCatalogSeed(
      db.transaction,
      batch,
      await planCatalogSeed(db, batch, sha, admin.id),
      backup,
      new Map(),
    );
    assert.deepEqual(
      resumed.map((e) => e.state),
      ["already", "created"],
    );
    await db.query(
      "UPDATE component_models SET description='',version=version+1 WHERE id=$1",
      [resumed[0].modelId],
    );
    const old = (await db.query("SELECT * FROM component_models ORDER BY id"))
      .rows;
    const next = { ...batch, batch: "mechanical-v2" };
    await applyCatalogSeed(
      db.transaction,
      next,
      await planCatalogSeed(db, next, sha, admin.id),
      backup,
      new Map(),
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM component_models ORDER BY id")).rows,
      old,
    );
    await assert.rejects(
      planCatalogSeed(db, batch, "c".repeat(64), admin.id),
      /SHA-256/,
    );
    const rollback = await rollbackCatalogSeed(
      db.transaction,
      batch.batch,
      sha,
      admin.id,
    );
    assert.deepEqual(rollback.archived, [resumed[1].modelId]);
    await assert.rejects(
      applyCatalogSeed(db.transaction, batch, plan, backup, new Map()),
      /rolled back/,
    );
  } finally {
    await db.close();
  }
});
test("only an existing active verified admin can plan and apply; role rechecked after dry run", async () => {
  const { db, admin } = await setup();
  try {
    assert.equal((await findSeedActor(db)).id, admin.id);
    const ordinary = await userRow(db);
    const batch = seedBatch();
    await assert.rejects(
      planCatalogSeed(db, batch, sha, ordinary.id),
      /administrator/,
    );
    const plan = await planCatalogSeed(db, batch, sha, admin.id);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [admin.id]);
    await assert.rejects(
      applyCatalogSeed(db.transaction, batch, plan, backup, new Map()),
    );
    assert.equal(
      (await db.query("SELECT * FROM component_seed_batches")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("populated catalog: renamed alias, merge review, original gallery and quotas", async () => {
  const { db, admin } = await setup();
  try {
    const {
      editComponentModel,
      mergeComponentModels,
      componentCatalog,
      componentCatalogInput,
    } = await import("../lib/component-catalog.ts");
    const { getPublicSite } = await import("../lib/public-site.ts");
    const { componentHits } = await import("../lib/discovery.ts");
    const { componentPhotoRow } = await import("./support/components.ts");
    const { bikeRow, componentRow } = await import("./support/bikes.ts");
    const { componentPhotoCapacity } =
      await import("../lib/component-photos.ts");
    const batch = seedBatch([
      seedEntry(),
      seedEntry("RD-M7100-SGS"),
      seedEntry("RD-M8100-SGS"),
    ]);
    const ids: string[] = [];
    for (const e of batch.entries)
      ids.push(
        (
          await db.query<{ id: string }>(
            "SELECT component_model_assign($1,$2) id",
            [e.category, e.name],
          )
        ).rows[0].id,
      );
    await db.query("UPDATE component_models SET first_public_at=now()");
    await db.transaction((q) =>
      editComponentModel(q, admin.id, ids[0], {
        category: batch.entries[0].category,
        brand: "Shimano",
        name: "Shimano DEORE RD-M6100-SGS editorial",
        archived: false,
        version: 1,
        description: "Проверено владельцем",
      }),
    );
    const photo = await componentPhotoRow(db, ids[0], admin.id, {
      hidden: true,
    });
    await db.query(
      "UPDATE component_models SET cover_photo_id=$2 WHERE id=$1",
      [ids[0], photo.id],
    );
    await db.transaction((q) =>
      mergeComponentModels(q, admin.id, ids[1], {
        targetId: ids[2],
        version: 1,
        targetVersion: 1,
      }),
    );
    const ordinaryOptions = await getPublicSite(db);
    assert.ok(
      !ordinaryOptions.catalog.parts[batch.entries[0].category].includes(
        "Shimano DEORE RD-M6100-SGS editorial",
      ),
    );
    assert.deepEqual(await componentHits(db, "RD-M6100-SGS", 10), []);
    const plan = await planCatalogSeed(db, batch, sha, admin.id);
    assert.equal(plan.entries[0].name, "Shimano DEORE RD-M6100-SGS editorial");
    assert.equal(plan.entries[1].action, "conflict");
    const photos = (await db.query("SELECT * FROM component_photos")).rows;
    await applyCatalogSeed(db.transaction, batch, plan, backup, new Map());
    assert.deepEqual(
      (await db.query("SELECT * FROM component_photos")).rows,
      photos,
    );
    const site = await getPublicSite(db);
    assert.ok(
      site.catalog.parts[batch.entries[0].category].includes(
        plan.entries[0].name,
      ),
    );
    assert.ok(
      !site.catalog.parts[batch.entries[0].category].includes(
        batch.entries[1].name,
      ),
    );
    const catalog = await componentCatalog(
      db,
      componentCatalogInput.parse({ q: "RD-M6100-SGS" }),
    );
    assert.equal(catalog.total, 1);
    assert.equal(catalog.items[0].builds, 0);
    const hits = await componentHits(db, "RD-M6100-SGS", 10);
    assert.deepEqual(hits, [{ name: plan.entries[0].name, bikes: 0 }]);
    const bike = await bikeRow(db, admin.id);
    const installed = await componentRow(db, bike.id, {
      category: batch.entries[0].category,
      name: batch.entries[0].aliases[0],
    });
    assert.equal(installed.model_id, ids[0]);
    const { saveFactorySpecification } =
      await import("../lib/factory-import.ts");
    const importedBike = await bikeRow(db, admin.id, {
      brand: "Cube",
      model: "Travel",
      year: 2024,
      trim: "",
    });
    const identity = { brand: "Cube", model: "Travel", year: 2024, trim: null };
    const result: Resolved = {
      status: "resolved",
      query: identity,
      bike: {
        ...identity,
        canonicalName: "Cube Travel",
        sourceUrl: "https://example.test/bike",
      },
      confidence: 1,
      cached: false,
      source: {
        manufacturer: "Cube",
        url: "https://example.test/bike",
        fetchedAt: new Date().toISOString(),
        adapter: "test",
        adapterVersion: 1,
      },
      rawSpecification: {},
      components: [
        {
          type: "rear_derailleur",
          brand: "Shimano",
          model: "RD-M6100-SGS",
          description: "Shimano RD-M6100-SGS",
          attributes: {},
          raw: { label: "Rear derailleur", value: "Shimano RD-M6100-SGS" },
        },
      ],
    };
    await db.transaction((q) =>
      saveFactorySpecification(q, importedBike, admin.id, result, true),
    );
    await db.transaction((q) =>
      saveFactorySpecification(q, importedBike, admin.id, result, true),
    );
    const imported = (
      await db.query<{ model_id: string }>(
        "SELECT model_id FROM components WHERE bike_id=$1",
        [importedBike.id],
      )
    ).rows;
    assert.deepEqual(imported, [{ model_id: ids[0] }]);

    assert.equal(
      (await componentHits(db, "RD-M6100-SGS", 10)).find(
        (h) => h.name === plan.entries[0].name,
      )?.bikes,
      2,
    );
    // Aggregate quota is not the 12-photos-per-model quota, but actual writes are.
    await componentPhotoCapacity(db, null, admin.id, 20, 20000);
    await assert.rejects(
      componentPhotoCapacity(db, ids[0], admin.id, 12, 12000),
      /Максимум/,
    );
    await assert.rejects(
      componentPhotoCapacity(db, null, admin.id, 240, 240000),
      /Максимум/,
    );
    await assert.rejects(
      componentPhotoCapacity(db, null, admin.id, 1, 600 * 1024 * 1024),
      /Лимит/,
    );
  } finally {
    await db.close();
  }
});

test("prepared photo failure cleans only own writes; uncertain commit and exact orphan resume retain media", async () => {
  const { db, admin } = await setup();
  const dir = await mkdtemp(path.join(tmpdir(), "cola-seed-fault-"));
  const old = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const { preparedSeedMedia } =
      await import("../scripts/component-catalog-import.ts");
    const { writeFile } = await import("node:fs/promises");
    const bundle = await loadCatalogSeedBundle(defaultSeedDirectory);
    const entry = bundle.batch.entries.find((e) => e.photo.status === "ready");
    assert.ok(entry);
    const batch = seedBatch([entry]);
    const media = await preparedSeedMedia({ ...bundle, batch });
    const photo = media.get(entry.seedKey);
    assert.ok(photo);
    const plan = await planCatalogSeed(db, batch, sha, admin.id);
    await writeFile(path.join(dir, photo.filename), "foreign bytes");
    await assert.rejects(
      applyCatalogSeed(db.transaction, batch, plan, backup, media),
      /different bytes/,
    );
    assert.equal(
      await readFile(path.join(dir, photo.filename), "utf8"),
      "foreign bytes",
    );
    assert.equal(
      (await db.query("SELECT * FROM component_models")).rows.length,
      0,
    );
    await rm(path.join(dir, photo.filename));
    let calls = 0;
    const failed: typeof db.transaction = (fn) =>
      db.transaction(async (q) => {
        const value = await fn(q);
        if (++calls === 2) throw new Error("Abort before commit");
        return value;
      });
    await assert.rejects(
      applyCatalogSeed(failed, batch, plan, backup, media),
      /Abort/,
    );
    assert.deepEqual(await readdir(dir), []);
    // A verified matching orphan from an uncertain previous attempt is reusable.
    await writeFile(path.join(dir, photo.filename), photo.bytes);
    calls = 0;
    const uncertain: typeof db.transaction = async (fn) => {
      const value = await db.transaction(fn);
      if (++calls === 2)
        throw Object.assign(new Error("Unknown commit"), {
          commitUncertain: true,
        });
      return value;
    };
    await assert.rejects(
      applyCatalogSeed(uncertain, batch, plan, backup, media),
      /Unknown/,
    );
    assert.deepEqual(
      await readFile(path.join(dir, photo.filename)),
      photo.bytes,
    );
    await applyCatalogSeed(
      db.transaction,
      batch,
      await planCatalogSeed(db, batch, sha, admin.id),
      backup,
      media,
    );
    assert.equal(
      (await db.query("SELECT * FROM component_photos")).rows.length,
      1,
    );
  } finally {
    if (old === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = old;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
