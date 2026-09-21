import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { scoreBike, defaultScoring } from "../lib/bike-score.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { profileInput, scoringInput } from "../lib/social-validation.js";
import { showcase, vote } from "../lib/showcase.js";
import { insertBike } from "../lib/repository.js";
test("scores clamp, apply each literal trigger once, respect groups and price privacy", () => {
  const config = structuredClone(defaultScoring);
  config.rules = [
    { groupId: "frame", category: "Вилка", match: "FOX", points: 20 },
    { groupId: "drivetrain", category: "", match: "deore xt", points: 15 },
    { groupId: "wheels", category: "", match: "Alfine 11", points: 15 },
  ];
  const b = {
    category: "mtb",
    photos: [],
    components: [
      { section: "build", category: "Вилка", name: "Fox 34" },
      { section: "build", category: "Вилка", name: "Fox 36" },
      {
        section: "build",
        category: "Задний переключатель",
        name: "Shimano Deore XT",
      },
      {
        section: "build",
        category: "Втулки",
        name: "Shimano Alfine, 11-Speed",
      },
    ],
  };
  assert.equal(scoreBike(b, config).upgrade, 100);
  config.rules[0].points = -100;
  assert.equal(scoreBike(b, config).upgrade, 0);
  config.rules = [
    { groupId: "brakes", category: "", match: "fox", points: 20 },
  ];
  assert.equal(scoreBike(b, config).upgrade, 50);
  config.rules = [];
  config.weight.pointsPer10Percent = 5;
  config.price.pointsPer10Percent = 2;
  assert.equal(
    scoreBike(
      { ...b, weight: 12.6, price: 200000, show_bike_price: false },
      config,
    ).upgrade,
    55,
  );
  assert.equal(
    scoreBike(
      { ...b, weight: 12.6, price: 200000, show_bike_price: true },
      config,
    ).upgrade,
    75,
  );
});
test("completion needs actual photo and distinct components; input cannot inject site settings", () => {
  const b = {
    category: "road",
    photos: [],
    components: Array.from({ length: 21 }, (_, i) => ({
      section: "build",
      category: "Part " + i,
      name: "A",
    })),
  };
  assert(scoreBike(b).completeness < 100);
  b.photos = [{ id: "photo" }];
  assert.equal(scoreBike(b).completeness, 100);
  b.components = Array(30).fill({
    section: "build",
    category: "Вилка",
    name: "Fox",
  });
  assert(scoreBike(b).completeness < 100);
  assert(
    profileInput.safeParse({
      name: "Nick",
      preferences: { bikeLayout: "dense" },
    }).success,
  );
  assert(
    !profileInput.safeParse({
      name: "Nick",
      preferences: { registrationOpen: false },
    }).success,
  );
  assert(
    !scoringInput.safeParse({
      ...defaultScoring,
      weight: { reference: 0, pointsPer10Percent: 1 },
    }).success,
  );
  assert(
    !scoringInput.safeParse({
      ...defaultScoring,
      rules: [{ groupId: "", category: "", match: "***", points: 1 }],
    }).success,
  );
});
test("showcase privacy, owner/voter permissions, duplicate votes, revocation, blocking and cascade", async () => {
  const db = new PGlite();
  try {
    for (const m of [
      "001_initial",
      "002_admin",
      "003_factory_spec",
      "004_garage_layout",
      "005_bike_wizard",
      "007_showcase",
      "008_beta_limits",
      "009_social_core",
      "010_community",
      "011_gamification",
      "012_rides",
      "014_journal",
      "015_discovery",
      "016_product_ui",
    ])
      await db.exec(
        await readFile(new URL("../db/" + m + ".sql", import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const owner = randomUUID(),
      viewer = randomUUID();
    for (const id of [owner, viewer])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'hash')",
        [id, id + "@example.test", id === owner ? "Author" : "Voter"],
      );
    const base = {
      name: "Public Cube",
      brand: "Cube",
      model: "Travel",
      trim: "",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      price: 123456,
    };
    const id = await insertBike(db, owner, { ...base, is_public: true }),
      secret = await insertBike(db, owner, {
        ...base,
        name: "SECRET",
        is_public: false,
      });
    let feed = await showcase(db, viewer);
    assert.equal(feed.total, 1);
    assert.equal(feed.bikes[0].author.name, "Author");
    assert.equal(feed.bikes[0].owner_id, undefined);
    assert.equal(feed.bikes[0].price, undefined);
    assert.equal((await vote(db, id, owner, true)).status, 403);
    assert.equal((await vote(db, secret, viewer, true)).status, 404);
    assert.equal((await vote(db, id, viewer, true)).likes, 1);
    assert.equal((await vote(db, id, viewer, true)).likes, 1);
    assert.equal((await showcase(db, viewer)).bikes[0].liked, true);
    assert.equal((await vote(db, id, viewer, false)).likes, 0);
    assert.equal((await showcase(db, null, { search: "Author" })).total, 1);
    assert.equal((await showcase(db, null, { category: "mtb" })).total, 0);
    assert.equal((await showcase(db, null, { category: "mtb,road" })).total, 1);
    assert.equal(
      (await showcase(db, null, { category: "mtb,gravel" })).total,
      0,
    );
    await vote(db, id, viewer, true);
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    assert.equal((await showcase(db, null)).total, 0);
    assert.equal((await vote(db, id, viewer, true)).status, 404);
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal((await showcase(db, null)).total, 0);
    assert.equal((await vote(db, id, viewer, true)).status, 404);
    await db.query("DELETE FROM bikes WHERE id=$1", [id]);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM bike_likes")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
