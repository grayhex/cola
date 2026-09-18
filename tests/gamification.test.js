import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  records,
  awardShelf,
  reactToBike,
  excludeBike,
  gameShelf,
  accountAchievements,
  leaderboardSQL,
} from "../lib/gamification.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { gameSettingsInput } from "../lib/gamification-validation.js";
import { defaultGamification } from "../lib/gamification-definitions.js";
async function setup() {
  const q = new PGlite();
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await q.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await q.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    defaultSettings,
  ]);
  await q.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    defaultCatalog,
  ]);
  return q;
}
async function rider(q, name) {
  const id = randomUUID();
  await q.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$3)",
    [id, name + "@example.test", name],
  );
  return id;
}
async function bike(
  q,
  owner,
  {
    price = 10000,
    weight = 10,
    category = "road",
    visible = true,
    publicBike = true,
  } = {},
) {
  const id = randomUUID();
  await q.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,price,weight,show_bike_price,is_public) VALUES($1,$2,$3,'Build','Cube','Travel',2020,$4,$5,$6,$7,$8)",
    [id, owner, randomUUID(), category, price, weight, visible, publicBike],
  );
  await q.query("INSERT INTO photos(id,bike_id,filename) VALUES($1,$2,$3)", [
    randomUUID(),
    id,
    randomUUID() + ".webp",
  ]);
  return id;
}
const holder = (r, key) => r.records.find((r) => r.key === key)?.holder;
test("game settings validate explicit thresholds, records and single currency", () => {
  assert(gameSettingsInput.safeParse(defaultGamification).success);
  for (const input of [
    { currency: "USD" },
    { weightMinimum: 60 },
    { budgetMinimum: 0 },
    { enabledRecords: ["surprise"] },
  ])
    assert(
      !gameSettingsInput.safeParse({ ...defaultGamification, ...input })
        .success,
    );
});
test("milestones award once at the event, survive crossed thresholds; private scopes remain private", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "owner"),
      b = await bike(q, a);
    assert.equal(
      (await awardShelf(q, { userId: a })).filter(
        (x) => x.key === "first_public",
      ).length,
      1,
    );
    for (let i = 0; i < 10; i++) {
      const voter = await rider(q, "voter" + i);
      await q.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
        b,
        voter,
      ]);
    }
    assert(
      (await awardShelf(q, { bikeId: b })).some(
        (x) => x.key === "bike_likes_10",
      ),
    );
    await q.query("DELETE FROM bike_likes WHERE bike_id=$1", [b]);
    await q.query("UPDATE bikes SET name=name WHERE id=$1", [b]);
    assert.equal(
      (await awardShelf(q, { bikeId: b })).filter(
        (x) => x.key === "bike_likes_10",
      ).length,
      1,
    );
    for (let i = 0; i < 21; i++)
      await q.query(
        "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Part',$3)",
        [randomUUID(), b, "Item " + i],
      );
    assert(
      (await awardShelf(q, { bikeId: b })).some((x) => x.key === "full_build"),
    );
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [b]);
    assert.equal((await awardShelf(q, { bikeId: b })).length, 0);
    assert(
      (await accountAchievements(q, a)).awards.some(
        (x) => x.key === "full_build",
      ),
    );
    const shelf = await gameShelf(q, { userId: a });
    assert.equal(shelf.awards.length, 1);
    assert(!JSON.stringify(shelf).includes(b));
    assert(!JSON.stringify(shelf).includes("price"));
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [a]);
    assert.equal(
      (await awardShelf(q, { userId: a, privateView: true })).length,
      0,
    );
  } finally {
    await q.close();
  }
});
test("dynamic holders, category lightest, price privacy, budget anti gaming and audit exclusion", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "alpha"),
      b = await rider(q, "bravo");
    const road = await bike(q, a, { price: 90000, weight: 8 }),
      mtb = await bike(q, b, { price: 15000, weight: 11, category: "mtb" }),
      gravel = await bike(q, b, {
        price: 10000,
        weight: 9,
        category: "gravel",
      });
    let r = await records(q);
    assert.equal(holder(r, "expensive").id, road);
    assert.equal(holder(r, "budget").id, gravel);
    assert.equal(holder(r, "lightest_mtb").id, mtb);
    assert.equal(holder(r, "lightest_road").id, road);
    const hidden = await bike(q, b, {
      price: 987654321,
      visible: false,
      weight: 0,
    });
    await bike(q, b, { price: 1, weight: 0 });
    const privateId = await bike(q, b, { price: 999999999, publicBike: false });
    r = await records(q);
    assert.equal(holder(r, "expensive").id, road);
    assert.equal(holder(r, "budget").id, gravel);
    assert(!JSON.stringify(r).includes("987654321"));
    assert(!JSON.stringify(r).includes(privateId));
    await q.query("UPDATE bikes SET price=100000 WHERE id=$1", [mtb]);
    assert.equal(holder(await records(q), "expensive").id, mtb);
    await excludeBike(q, a, mtb, { excluded: true, reason: "Invalid build" });
    assert.equal(holder(await records(q), "expensive").id, road);
    assert.equal(
      (
        await q.query(
          "SELECT count(*) FROM admin_audit WHERE action='leaderboard.exclude'",
        )
      ).rows[0].count,
      1,
    );
    await excludeBike(q, a, mtb, { excluded: false, reason: "Verified" });
    assert.equal(holder(await records(q), "expensive").id, mtb);
    await q.query("UPDATE bikes SET show_bike_price=false WHERE id=$1", [mtb]);
    assert.equal(holder(await records(q), "expensive").id, road);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [a]);
    assert.equal(holder(await records(q), "lightest_road"), null);
    const raw = (await q.query(leaderboardSQL)).rows.find(
      (x) => x.id === hidden,
    );
    assert.equal(raw.price, null);
  } finally {
    await q.close();
  }
});
test("self reactions rejected, duplicates idempotent, valid community leaders and live revocation", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "alpha"),
      b = await rider(q, "bravo"),
      c = await rider(q, "charlie"),
      id = await bike(q, a);
    await assert.rejects(
      () => reactToBike(q, id, a, "wild", true),
      (e) => e.status === 403,
    );
    await reactToBike(q, id, b, "wild", true);
    await reactToBike(q, id, b, "wild", true);
    await reactToBike(q, id, b, "dream", true);
    let r = await records(q);
    assert.equal(holder(r, "wild").value, 1);
    assert.equal(holder(r, "community").value, 1);
    await reactToBike(q, id, c, "clean", true);
    assert.equal(holder(await records(q), "community").value, 2);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [c]);
    assert.equal(holder(await records(q), "community").value, 1);
    await assert.rejects(
      () => reactToBike(q, id, c, "wild", true),
      (e) => e.status === 401,
    );
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    assert.equal(holder(await records(q), "community"), null);
    await assert.rejects(
      () => reactToBike(q, id, b, "clean", true),
      (e) => e.status === 404,
    );
  } finally {
    await q.close();
  }
});
test("migration backfills existing public milestones; blocked votes never earn a new milestone", async () => {
  const q = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && !f.startsWith("011"))
      .sort())
      await q.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = await rider(q, "legacy"),
      id = await bike(q, owner);
    await q.exec(
      await readFile(
        new URL("../db/011_gamification.sql", import.meta.url),
        "utf8",
      ),
    );
    assert(
      (await awardShelf(q, { userId: owner })).some(
        (a) => a.key === "first_public",
      ),
    );
    for (let i = 0; i < 10; i++) {
      const voter = await rider(q, "legacyvoter" + i);
      if (i === 0)
        await q.query("UPDATE users SET blocked=true WHERE id=$1", [voter]);
      await q.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
        id,
        voter,
      ]);
    }
    assert(
      !(await awardShelf(q, { bikeId: id })).some(
        (a) => a.key === "bike_likes_10",
      ),
    );
  } finally {
    await q.close();
  }
});
