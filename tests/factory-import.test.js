import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { saveFactorySpecification } from "../lib/factory-import.js";
import { insertBike } from "../lib/repository.js";
import { parseBikeName } from "../lib/bike-name.js";
test("full bicycle names retain significant trim and extract trailing year", () => {
  assert.deepEqual(
    parseBikeName("Canyon Grail CF SLX 8 AXS 2026", ["Cube", "Canyon"]),
    { brand: "Canyon", model: "Grail CF SLX 8 AXS", trim: "", year: 2026 },
  );
  assert.equal(parseBikeName("Мой любимый байк", ["Cube"]), null);
});
test("factory import seeds empty configuration once, preserves user parts and rejects stale identity", async () => {
  const db = new PGlite();
  try {
    for (const f of ["001_initial", "003_factory_spec"])
      await db.exec(
        await readFile(new URL("../db/" + f + ".sql", import.meta.url), "utf8"),
      );
    const owner = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
      [owner, "factory@example.test", "Test", "unused"],
    );
    const values = {
      name: "Test",
      brand: "Giant",
      model: "Contend",
      trim: "AR 1",
      year: 2024,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: null,
    };
    const id = await insertBike(db, owner, values);
    const bike = (await db.query("SELECT * FROM bikes WHERE id=$1", [id]))
      .rows[0];
    const component = {
      type: "rear_hub",
      description: "Shimano Alfine",
      raw: { label: "REAR HUB", value: "Shimano Alfine" },
      attributes: {},
    };
    const result = {
      status: "resolved",
      bike: { canonicalName: "Giant Contend AR 1 2024" },
      source: { url: "https://www.giant-bicycles.com/gb/contend-ar-1-2024" },
      components: [component],
      rawSpecification: { "REAR HUB": "Shimano Alfine" },
    };
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(q, bike, owner, result, true),
        )
      ).importedCount,
      1,
    );
    await db.query(
      "UPDATE components SET name='Custom wheel',price=1234 WHERE bike_id=$1",
      [id],
    );
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(q, bike, owner, result, true),
        )
      ).importedCount,
      0,
    );
    assert.equal(
      (await db.query("SELECT name FROM components WHERE bike_id=$1", [id]))
        .rows[0].name,
      "Custom wheel",
    );
    assert.deepEqual(
      (await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [id]))
        .rows[0].factory_spec,
      result,
    );
    await db.query("UPDATE bikes SET year=2025 WHERE id=$1", [id]);
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(q, bike, owner, result, true),
        )
      ).conflict,
      true,
    );
  } finally {
    await db.close();
  }
});
