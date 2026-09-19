import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { migrateHagsyDemo, demoHash } from "../db/013_hagsy_demo.js";
import { getOriginal } from "../lib/ride-storage.js";
import { rideDetail } from "../lib/rides.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
test("demo migration imports original, preserves privacy, runs once and does not resurrect deleted data", async () => {
  const dir = await mkdtemp("/tmp/cola-demo-");
  process.env.RIDES_DIR = dir;
  const db = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await db.exec("CREATE TABLE schema_migrations(version text PRIMARY KEY)");
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      defaultSettings,
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      defaultCatalog,
    ]);
    const restricted = {
      enabled: false,
      maxGpxBytes: 1024,
      maxPoints: 2,
      privacyRadii: [300],
      defaultRadius: 300,
    };
    await db.query("UPDATE ride_settings SET value=$1 WHERE id=1", [
      restricted,
    ]);
    const result = await db.transaction((q) => migrateHagsyDemo(q));
    assert.deepEqual(
      (await db.query("SELECT value FROM ride_settings WHERE id=1")).rows[0]
        .value,
      restricted,
    );
    const raw = (await db.query("SELECT * FROM rides WHERE id=$1", [result.id]))
      .rows[0];
    assert.equal(raw.privacy_enabled, true);
    assert.equal(raw.privacy_radius_m, 500);
    assert.equal(
      createHash("sha256")
        .update(await getOriginal(raw.id))
        .digest("hex"),
      demoHash,
    );
    const ride = await rideDetail(db, result.shareId, null);
    assert.equal(ride.metrics.distanceM, 26460);
    assert.equal(ride.author.username, "hagsy_test");
    assert.equal(ride.bike.name, "Giant Tourer GTS");
    assert.equal(ride.geometry.length, 2);
    assert.ok(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM components WHERE bike_id=$1",
          [raw.bike_id],
        )
      ).rows[0].n > 5,
    );
    assert.equal(await db.transaction((q) => migrateHagsyDemo(q)), null);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM rides")).rows[0].n,
      1,
    );
    await db.query("DELETE FROM users WHERE id=$1", [raw.owner_id]);
    assert.equal(await db.transaction((q) => migrateHagsyDemo(q)), null);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM rides")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
