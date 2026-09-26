import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.js";
import {
  landingSlug,
  mergeCatalog,
  modelLandingPath,
  partLandingPath,
} from "../lib/experience-catalog.js";
import {
  landingMinimum,
  landingSitemap,
  modelLanding,
  partLanding,
} from "../lib/experience-landing.js";
import { plural } from "../lib/plural.js";
import { classificationLabels } from "../lib/bike-classification.js";

test("landing addresses keep whole names in Latin and Cyrillic", () => {
  assert.equal(landingSlug("Stumpjumper EVO Comp"), "stumpjumper-evo-comp");
  assert.equal(landingSlug("  Ёлка 2.0 — «лайт» "), "ёлка-2-0-лайт");
  assert.equal(landingSlug("—"), "");
  assert.equal(landingSlug(null), "");
  const long = "Shimano Deore XT M8100 ".repeat(6).trim();
  assert.equal(landingSlug(long).length, long.length);
  assert.equal(modelLandingPath("Cube", "Travel EXC"), "/experience/cube/travel-exc");
  assert.equal(
    modelLandingPath("Куб", "Тревел"),
    "/experience/" + encodeURIComponent("куб") + "/" + encodeURIComponent("тревел"),
  );
  assert.equal(
    partLandingPath("Седло", "Brooks C17"),
    "/experience/parts/" + encodeURIComponent("седло") + "/brooks-c17",
  );
});

test("Russian plural forms", () => {
  const forms = (n) => plural(n, "сборка", "сборки", "сборок");
  assert.deepEqual(
    [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(forms),
    ["сборок", "сборка", "сборки", "сборки", "сборок", "сборок", "сборок", "сборок", "сборка", "сборки", "сборок", "сборка", "сборок", "сборок"],
  );
});

test("model and part pages count public builds under every spelling", async () => {
  const db = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL("../db/" + f, import.meta.url), "utf8"));
    const catalog = mergeCatalog(defaultCatalog, {
      kind: "component",
      scope: "Седло",
      alias: "Брукс С17",
      name: "Brooks C17",
    });
    catalog.aliases.push({ kind: "component", scope: "Седло", alias: "brooks c-17", name: "Brooks C17" });
    catalog.aliases.push({ kind: "model", scope: "Cube", alias: "Тревел", name: "Travel" });
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [JSON.stringify(catalog)]);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [JSON.stringify(defaultSettings)]);
    const owner = randomUUID(),
      banned = randomUUID();
    for (const [id, name, blocked] of [
      [owner, "owner", false],
      [banned, "banned", true],
    ])
      await db.query(
        "INSERT INTO users(id,email,name,username,password_hash,blocked) VALUES($1,$2,$2,$2,'x',$3)",
        [id, name, blocked],
      );
    const bikes = {};
    async function bike(key, brand, model, year, weight, { user = owner, isPublic = true, saddle = "" } = {}) {
      const id = randomUUID();
      bikes[key] = id;
      await db.query(
        "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,weight,is_public) VALUES($1,$1,$2,$3,$4,$5,$6,'road',$7,$8)",
        [id, user, "Build " + key, brand, model, year, weight, isPublic],
      );
      if (saddle)
        await db.query(
          "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло',$3)",
          [randomUUID(), id, saddle],
        );
    }
    await bike("a", "Cube", "Travel", 2019, 12, { saddle: "Brooks C17" });
    await bike("b", "Куб", "Travel", 2021, 13, { saddle: "Брукс С17" });
    await bike("c", "CUBE", "Тревел", 2020, null, { saddle: "brooks c-17" });
    await bike("d", "Cube", "Travel", 2018, 14, { saddle: "Brooks C17" });
    await bike("private", "Cube", "Travel", 2022, 20, { isPublic: false, saddle: "Brooks C17" });
    await bike("blocked", "Cube", "Travel", 2023, 20, { user: banned, saddle: "Brooks C17" });
    await bike("alone", "Trek", "Marlin 7", 2024, 14);
    await bike("nameless", "—", "…", 2024, 14);
    for (const [status, distance] of [
      ["completed", 42000],
      ["planned", 90000],
    ])
      await db.query(
        "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,is_public,status) VALUES($1,$1,$2,$3,'Ride',$4,0,0,'[]',500,$5,true,$6)",
        [randomUUID(), owner, bikes.a, distance, "landing-" + status, status],
      );

    // An installation story on one build, a draft and a service entry.
    const saddlePart = (
      await db.query("SELECT id,name,category,section FROM components WHERE bike_id=$1", [bikes.b])
    ).rows[0];
    for (const [kind, status] of [
      ["build", "published"],
      ["build", "draft"],
      ["service", "published"],
    ])
      await db.query(
        "INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,components,published_at) VALUES($1,$1,$2,$3,$4,'Седло','Поставил седло',$5,true,$6,now())",
        [randomUUID(), owner, bikes.b, kind, status, JSON.stringify([saddlePart])],
      );
    const cube = await modelLanding(db, null, "куб", "тревел");
    assert.equal(cube.builds, 4, "private and blocked builds stay out");
    assert.equal(cube.title, "Cube Travel");
    assert.equal(cube.path, "/experience/cube/travel");
    assert.equal(cube.indexed, true);
    assert.deepEqual(cube.years, [2018, 2021]);
    assert.equal(cube.weight, 13);
    assert.equal(cube.rides, 1, "planned rides are not experience");
    assert.equal(cube.distanceKm, 42);
    assert.deepEqual(
      cube.bikes.map((b) => b.id).sort(),
      [bikes.a, bikes.b, bikes.c, bikes.d].sort(),
    );
    assert.deepEqual(cube.types, [
      { label: classificationLabels({ category: "road" })[0], builds: 4 },
    ]);
    assert.equal(cube.installs.length, 1, "drafts and service entries are not installations");
    assert.equal(cube.installs[0].name, "Брукс С17");
    assert.equal(cube.installs[0].entries, 1);
    assert.match(cube.installs[0].search, /type=journal/);
    assert.equal(cube.entryCount, 2, "published entries only");
    assert.equal(cube.parts.length, 1, "spellings of one saddle are one part");
    assert.equal(cube.parts[0].builds, 4);
    assert.equal(cube.parts[0].path, partLandingPath(cube.parts[0].category, cube.parts[0].name));
    assert.deepEqual(await modelLanding(db, null, "cube", "travel"), cube);

    const trek = await modelLanding(db, null, "trek", "marlin-7");
    assert.equal(trek.builds, 1);
    assert.equal(trek.indexed, false, "a thin page waits for more builds");
    assert.equal(trek.path, "/experience/trek/marlin-7");
    assert.equal(await modelLanding(db, null, "cube", "reaction"), null);
    assert.equal(await modelLanding(db, null, "-", "-"), null, "names without letters");
    assert.equal(await modelLanding(db, null, "cube", "x".repeat(400)), null);

    const saddle = await partLanding(db, null, "седло", "brooks-c17");
    assert.equal(saddle.builds, 4);
    assert.equal(saddle.indexed, true);
    assert.equal(saddle.title, "Brooks C17");
    assert.equal(saddle.path, "/experience/parts/" + encodeURIComponent("седло") + "/brooks-c17");
    assert.deepEqual(saddle.models, [
      { brand: "Cube", model: "Travel", builds: 4, path: "/experience/cube/travel" },
    ]);
    assert.equal(saddle.bikes.length, 4);
    assert.deepEqual(await partLanding(db, null, "Седло", "Брукс С17"), saddle);
    assert.equal(await partLanding(db, null, "рама", "brooks-c17"), null);

    const limit = { model: 10, part: 10 };
    const paths = async () => (await landingSitemap(db, limit)).map((e) => e.path);
    assert.deepEqual((await paths()).sort(), [cube.path, saddle.path].sort());
    assert.ok((await landingSitemap(db, limit)).every((e) => e.updatedAt));
    assert.equal(landingMinimum, 3);

    // Hiding builds takes both pages below the threshold.
    await db.query("UPDATE bikes SET is_public=false WHERE id=ANY($1)", [[bikes.c, bikes.d]]);
    assert.equal((await modelLanding(db, null, "cube", "travel")).indexed, false);
    assert.equal((await partLanding(db, null, "седло", "brooks-c17")).builds, 2);
    assert.deepEqual(await paths(), []);
  } finally {
    await db.close();
  }
});
