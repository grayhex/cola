import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { defaultCatalog } from "../lib/site-defaults.js";
import {
  rebuildFactoryComponents,
  legacyFactoryPart,
} from "../lib/factory-rebuild.js";
import { createWizardBike, wizardInput } from "../lib/bike-wizard.js";
import { factoryEntries } from "../lib/factory-components.js";
import { saveFactorySpecification } from "../lib/factory-import.js";

test("reviewed rebuild splits factory parts, preserves manual/content references, rolls back stale plans and is idempotent", async () => {
  const db = new PGlite();
  try {
    // Historical #205 content-retention contract; #221 migration and current
    // schema import/rebuild idempotency are covered by component-products.test.js.
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => /^\d.*\.sql$/.test(f) && f < "033")
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await db.query(
      "INSERT INTO site_catalog VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET value=$1",
      [defaultCatalog],
    );
    const owner = randomUUID(),
      bikeId = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Owner','x')",
      [owner, owner + "@example.test"],
    );
    const raw = (type, value) => ({
      type,
      description: value,
      attributes: {},
      raw: { label: type, value },
    });
    const sources = [
      raw(
        "tire",
        "Front Tire: Butcher, GRID TRAIL, 29x2.4: : Rear Tire: Eliminator, GRID TRAIL, 27.5x2.4",
      ),
      raw("front_brake", "Shimano Deore M6100, гидравлический, диск 180мм"),
      raw("rear_brake", "Shimano Deore M6100, гидравлический, диск 160мм"),
      raw(
        "handlebar",
        "Canyon Cockpit CP0039; One-piece carbon cockpit with specialist gravel ergonomics and design",
      ),
      raw(
        "headset",
        "интегрированная, внутренняя проводка, закрытый подшипник",
      ),
      raw("pedals", "Not Available"),
      raw("saddle", "Brooks C17"),
      raw("stem", "Canyon V13; Alloy, 90mm"),
    ];
    const spec = {
      status: "resolved",
      source: { url: "https://example.test/bike" },
      components: sources,
    };
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public,factory_spec) VALUES($1,$1,$2,'Fixture','Canyon','Test',2026,'gravel',true,$3)",
      [bikeId, owner, spec],
    );
    const ids = [];
    for (const [i, source] of sources.entries()) {
      const c = legacyFactoryPart(source),
        id = randomUUID();
      ids.push(id);
      await db.query(
        "INSERT INTO components(id,bike_id,section,category,name,notes,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, bikeId, c.section, c.category, c.name, c.notes, i],
      );
    }
    await db.query(
      "UPDATE components SET notes='User fit preference',price=1234,url='https://example.test/my-purchase',group_id='cockpit' WHERE id=$1",
      [ids[6]],
    );
    // A catalog photo must survive detaching its old factory installation.
    const photo = randomUUID(),
      photoModel = (
        await db.query("SELECT model_id FROM components WHERE id=$1", [ids[1]])
      ).rows[0].model_id;
    await db.query(
      "INSERT INTO component_photos(id,model_id,author_id,filename,width,height,size_bytes) VALUES($1,$2,$3,'existing.webp',800,600,100)",
      [photo, photoModel, owner],
    );
    const commentModel = (
      await db.query("SELECT model_id FROM components WHERE id=$1", [ids[4]])
    ).rows[0].model_id;
    const marketModel = (
      await db.query("SELECT model_id FROM components WHERE id=$1", [ids[5]])
    ).rows[0].model_id;
    const comment = randomUUID(),
      listing = randomUUID();
    await db.query(
      "INSERT INTO component_comments(id,model_id,author_id,body) VALUES($1,$2,$3,'Keep this discussion')",
      [comment, commentModel, owner],
    );
    await db.query(
      "INSERT INTO market_listings(id,share_id,owner_id,title,category,condition,price,currency,component_model_id) VALUES($1,$1,$2,'Linked listing','components','used',100,'RUB',$3)",
      [listing, owner, marketModel],
    );
    const snapshot = async () =>
      (
        await db.query(
          "SELECT id,name,notes,price,url,group_id,model_id FROM components ORDER BY id",
        )
      ).rows;
    const before = await snapshot(),
      manual = before.find((p) => p.id === ids[6]);
    const preview = await db.transaction((q) => rebuildFactoryComponents(q));
    assert.equal(preview.bikes, 1);
    assert.equal(preview.changes.length, 6);
    assert(preview.retainedModels.some((m) => m.id === photoModel));
    assert(preview.retainedModels.some((m) => m.id === marketModel));
    assert(preview.preservedParts.some((p) => p.id === ids[6]));
    assert.deepEqual(await snapshot(), before, "dry-run is read only");
    await assert.rejects(
      db.transaction((q) =>
        rebuildFactoryComponents(q, { apply: true, expect: "0".repeat(64) }),
      ),
      /REBUILD_CHANGED/,
    );
    assert.deepEqual(
      await snapshot(),
      before,
      "failed precondition rolls back",
    );
    await db.query(
      "UPDATE components SET notes='manual edit after preview' WHERE id=$1",
      [ids[7]],
    );
    await assert.rejects(
      db.transaction((q) =>
        rebuildFactoryComponents(q, {
          apply: true,
          expect: preview.fingerprint,
        }),
      ),
      /REBUILD_CHANGED/,
    );
    const fresh = await db.transaction((q) => rebuildFactoryComponents(q));
    const result = await db.transaction((q) =>
      rebuildFactoryComponents(q, { apply: true, expect: fresh.fingerprint }),
    );
    assert.equal(result.applied, true);
    const after = await snapshot();
    assert.deepEqual(
      after.find((p) => p.id === ids[6]),
      manual,
    );
    assert.equal(
      after.find((p) => p.id === ids[7]).notes,
      "manual edit after preview",
    );
    assert.equal(
      after.find((p) => p.id === ids[0]).name,
      "Specialized Butcher",
    );
    assert(after.some((p) => p.name === "Specialized Eliminator"));
    for (const id of [ids[1], ids[2]])
      assert.equal(after.find((p) => p.id === id).name, "Shimano Deore M6100");
    assert.equal(
      after.find((p) => p.id === ids[3]).name,
      "Canyon Cockpit CP0039",
    );
    assert(
      after.some((p) => p.id === ids[4]),
      "generic equipment remains in the specification",
    );
    assert(!after.some((p) => p.id === ids[5]), "absent equipment is omitted");
    for (const m of fresh.removeModels)
      assert.equal(
        (await db.query("SELECT 1 FROM component_models WHERE id=$1", [m.id]))
          .rowCount,
        0,
      );
    assert.equal(
      (
        await db.query("SELECT model_id FROM component_photos WHERE id=$1", [
          photo,
        ])
      ).rows[0].model_id,
      photoModel,
    );
    assert.equal(
      (
        await db.query("SELECT model_id FROM component_comments WHERE id=$1", [
          comment,
        ])
      ).rows[0].model_id,
      commentModel,
    );
    assert.equal(
      (
        await db.query(
          "SELECT component_model_id FROM market_listings WHERE id=$1",
          [listing],
        )
      ).rows[0].component_model_id,
      marketModel,
    );
    assert.equal(
      (
        await db.query("SELECT brand FROM component_models WHERE id=$1", [
          after.find((p) => p.id === ids[0]).model_id,
        ])
      ).rows[0].brand,
      "Specialized",
    );
    const saved = (
      await db.query("SELECT factory_spec,updated_at FROM bikes WHERE id=$1", [
        bikeId,
      ])
    ).rows[0];
    assert.deepEqual(
      saved.factory_spec.components,
      sources,
      "original specification remains intact",
    );
    const second = await db.transaction((q) => rebuildFactoryComponents(q));
    assert.equal(second.changes.length, 0);
    assert.equal(second.removeModels.length, 0);
    await db.transaction((q) =>
      rebuildFactoryComponents(q, { apply: true, expect: second.fingerprint }),
    );
    assert.deepEqual(await snapshot(), after);
    assert.deepEqual(
      (
        await db.query(
          "SELECT factory_spec,updated_at FROM bikes WHERE id=$1",
          [bikeId],
        )
      ).rows[0],
      saved,
    );
    // New manual edits and deliberate removals remain outside subsequent rebuilds.
    await db.query(
      "UPDATE components SET name='My chosen replacement' WHERE id=$1",
      [ids[0]],
    );
    await db.query("DELETE FROM components WHERE id=$1", [ids[2]]);
    const third = await db.transaction((q) => rebuildFactoryComponents(q));
    assert.equal(third.changes.length, 0);
    await db.transaction((q) =>
      rebuildFactoryComponents(q, { apply: true, expect: third.fingerprint }),
    );
    assert.equal(
      (await db.query("SELECT name FROM components WHERE id=$1", [ids[0]]))
        .rows[0].name,
      "My chosen replacement",
    );
    assert.equal(
      (await db.query("SELECT 1 FROM components WHERE id=$1", [ids[2]]))
        .rowCount,
      0,
    );

    // Wizard keeps user edits, marks only unchanged server preview entries.
    const previewId = randomUUID(),
      query = { brand: "Canyon", model: "Test", trim: "", year: 2026 };
    await db.query(
      "INSERT INTO resolver_previews(id,owner_id,response) VALUES($1,$2,$3)",
      [previewId, owner, { ...spec, query }],
    );
    const parts = factoryEntries(spec).map((e) => e.value);
    parts[0] = { ...parts[0], name: "User wizard edit" };
    const input = wizardInput.parse({
      requestId: randomUUID(),
      previewId,
      bike: {
        ...query,
        name: "Wizard",
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
      components: parts,
    });
    const wizard = await db.transaction((q) =>
      createWizardBike(q, owner, input),
    );
    assert.equal(
      (await db.transaction((q) => createWizardBike(q, owner, input))).id,
      wizard.id,
    );
    const wizardBike = (
      await db.query("SELECT * FROM bikes WHERE id=$1", [wizard.id])
    ).rows[0];
    assert.equal(
      wizardBike.factory_spec.colaImport.parts.length,
      parts.length - 1,
    );
    assert(
      !wizardBike.factory_spec.colaImport.parts.some(
        (p) => p.snapshot.name === "User wizard edit",
      ),
    );
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(
            q,
            wizardBike,
            owner,
            { ...spec, query },
            true,
          ),
        )
      ).importedCount,
      0,
    );
    assert.deepEqual(
      (
        await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [
          wizard.id,
        ])
      ).rows[0].factory_spec.colaImport,
      wizardBike.factory_spec.colaImport,
    );
  } finally {
    await db.close();
  }
});
