import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { visibleBike } from "../lib/showcase.ts";
import { rideList } from "../lib/rides.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
import { getSite } from "../lib/site.ts";

test("bike detail read: constant queries, owner/public prices, visible ride total, hidden/deleted parent and stored layout", async () => {
  const db = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = randomUUID(),
      other = randomUUID();
    for (const id of [owner, other])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Reader','hash',$3)",
        [id, id + "@test.invalid", id.slice(0, 20)],
      );
    const id = await insertBike(
      db,
      owner,
      bikeInput.parse({
        name: "Read contract",
        description: "",
        color: "",
        size: "",
        weight: null,
        brand: "Cube",
        model: "Travel",
        category: "urban_touring",
        year: 2021,
        is_public: true,
        price: 987654,
        show_bike_price: false,
        show_component_prices: false,
      }),
    );
    const { share_id: share } = (
      await db.query("SELECT share_id FROM bikes WHERE id=$1", [id])
    ).rows[0];
    const site = { settings: defaultSettings, catalog: defaultCatalog };
    let queries = 0;
    const q = {
      query: (...args) => {
        queries++;
        return db.query(...args);
      },
    };
    await visibleBike(q, share, null, site);
    const emptyQueries = queries;
    for (let i = 0; i < 30; i++)
      await db.query(
        "INSERT INTO components(id,bike_id,section,category,name,price) VALUES($1,$2,'build','Рама',$3,765432)",
        [randomUUID(), id, "Frame " + i],
      );
    for (let i = 0; i < 26; i++)
      await db.query(
        "INSERT INTO rides(id,share_id,owner_id,bike_id,title,is_public,source_hash,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m) VALUES($1,$1,$2,$3,$4,$5,$6,12000,0,0,'[]',500)",
        [randomUUID(), owner, id, "Ride " + i, i < 25, "synthetic-" + i],
      );
    for (const viewer of [null, other, owner]) {
      queries = 0;
      const bike = await visibleBike(q, share, viewer, site);
      assert.equal(queries, emptyQueries);
      assert.equal(bike.components.length, 30);
      assert.equal(bike.is_owner, viewer === owner);
      if (viewer === owner) assert.equal(Number(bike.price), 987654);
      else {
        assert.equal(bike.price, undefined);
        assert(bike.components.every((c) => c.price === undefined));
      }
      queries = 0;
      const rides = await rideList(q, viewer, { bikeId: id });
      assert.equal(queries, 2);
      assert.equal(rides.total, 25);
      assert.equal(rides.rides.length, 24);
      assert.equal(
        (await rideList(db, viewer, { bikeId: id, page: 2 })).rides.length,
        1,
      );
    }
    console.log(
      "BIKE_DETAIL_SQL",
      JSON.stringify({
        detail: emptyQueries,
        rides: 2,
        components: 30,
        visibleRides: 25,
      }),
    );
    await db.query("UPDATE bikes SET is_former=true WHERE id=$1", [id]);
    assert.equal((await visibleBike(db, share, null, site)).is_former, true);
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    assert.equal(await visibleBike(db, share, other, site), null);
    assert.equal((await rideList(db, null, { bikeId: id })).total, 0);
    assert.equal((await visibleBike(db, share, owner, site)).is_owner, true);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal(await visibleBike(db, share, owner, site), null);
    await db.query("DELETE FROM rides WHERE bike_id=$1", [id]);
    await db.query("DELETE FROM bikes WHERE id=$1", [id]);
    assert.equal(await visibleBike(db, share, null, site), null);
    const stored = {
      detailBlocks: defaultSettings.detailBlocks.map((b) => ({
        ...b,
        enabled: false,
        open: false,
        variant: "plain",
      })),
      summaryFields: {
        description: false,
        metadata: false,
        manufacturer: false,
        price: false,
      },
    };
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(stored),
    ]);
    const loaded = await getSite(db);
    assert.deepEqual(loaded.settings.detailBlocks, stored.detailBlocks);
    assert.deepEqual(loaded.settings.summaryFields, stored.summaryFields);
  } finally {
    await db.close();
  }
});
