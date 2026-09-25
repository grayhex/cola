import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { parseBikeSearch } from "../lib/bike-search-input.js";
import {
  classificationInput,
  classificationQueryInput,
} from "../lib/classification-validation.js";
import {
  classificationOf,
  classificationLabels,
  compatibilityCategory,
  matchesClassification,
} from "../lib/bike-classification.js";
import { bikeInput } from "../lib/validation.js";
import { publicBike } from "../lib/public-dto.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { insertBike } from "../lib/repository.js";
import { showcase } from "../lib/showcase.js";
import { discoveryInput, discoverySearch } from "../lib/discovery.js";
import { searchInput, searchExperience } from "../lib/search.js";
import { prepareSvg } from "../lib/svg-asset.js";
import { backgroundCss, backgroundDefaults } from "../lib/theme.js";
import { illustrationSlots, filterGraphicSlots } from "../lib/design-graphics.js";
import { settingsInput } from "../lib/admin-validation.js";
import { siteAssetIds, siteAssetUsage } from "../lib/site-assets.js";
const baseBike = {
  name: "Fixture",
  brand: "Cube",
  model: "Travel",
  year: 2021,
  category: "road",
  description: "",
  color: "",
  size: "L",
  weight: 14,
  is_public: true,
};
const classification = (extra) =>
  classificationInput.parse({
    category: "urban_touring",
    subtype: "commuter",
    ...extra,
  });

test("independent taxonomy validates facets and uses without turning features into categories", () => {
  const c = classification({
    construction: "folding",
    electric: true,
    uses: ["commuting", "touring"],
  });
  assert.equal(compatibilityCategory(c), "urban_touring");
  assert.deepEqual(classificationLabels({ classification: c }), [
    "Commuter",
    "Folding",
    "E-bike",
  ]);
  assert(
    matchesClassification(
      { classification: c },
      { construction: "folding", electric: "1", use: "touring" },
      ["urban_touring"],
    ),
  );
  assert(!matchesClassification({ classification: c }, { electric: "0" }));
  for (const bad of [
    { category: "folding" },
    { category: "mtb", subtype: "commuter" },
    { category: "mtb", suspension: "air" },
    { category: "mtb", uses: ["xc", "xc"] },
    { category: "mtb", uses: ["xc", "trail", "enduro", "racing"] },
    { category: "mtb", electric: "true" },
    { category: "mtb", futureSecret: "hidden" },
  ])
    assert.equal(classificationInput.safeParse(bad).success, false);
  assert.equal(
    classificationQueryInput.safeParse({ suspension: "' OR true --" }).success,
    false,
  );
  const gravel = bikeInput.parse({ ...baseBike, category: "gravel" });
  assert.equal(gravel.classification.category, "road_gravel");
  assert.equal(gravel.classification.subtype, "gravel");
  assert.equal(gravel.category, "gravel");
  assert.equal(
    classificationOf({
      ...baseBike,
      classification: { ...c, secret: "hidden" },
    }).secret,
    undefined,
  );
  assert(
    !JSON.stringify(
      publicBike({ ...baseBike, classification: { ...c, secret: "hidden" } }),
    ).includes("hidden"),
  );
  assert.equal(
    classificationLabels({
      classification: classificationInput.parse({
        category: "mtb",
        subtype: "enduro",
        suspension: "full_suspension",
      }),
    })[0],
    "MTB · Enduro",
  );
});

test("free model entry extracts only stated facts and retains unknown trims", () => {
  const models = {
    gravel: { Canyon: ["Grail"] },
    mtb: { "Santa Cruz": ["Hightower"] },
  };
  assert.deepEqual(parseBikeSearch("Canyon Grail CF SLX 8 AXS 2026", models), {
    brand: "Canyon",
    model: "Grail",
    trim: "CF SLX 8 AXS",
    year: 2026,
  });
  assert.deepEqual(parseBikeSearch("2020 Santa Cruz Hightower C S", models), {
    brand: "Santa Cruz",
    model: "Hightower",
    trim: "C S",
    year: 2020,
  });
  assert.deepEqual(parseBikeSearch("Unknown Trail Runner", models), {
    brand: "Unknown",
    model: "Trail Runner",
    trim: null,
    year: null,
  });
  assert.equal(parseBikeSearch("Canyon", models), null);
  assert.equal(parseBikeSearch("Canyon Grail 2020 2022", models), null);
  assert.equal(parseBikeSearch("Canyon Grail", models).year, null);
});

test("theme backgrounds are bounded safe CSS and protected asset references", () => {
  const id = randomUUID();
  const s = settingsInput.parse({
    ...defaultSettings,
    backgroundLightId: id,
    backgroundDarkId: id,
    backgroundLightOpacity: 35,
    backgroundDarkOpacity: 0,
    backgroundDarkMode: "tile",
  });
  assert.deepEqual(siteAssetIds(s), [id]);
  assert(siteAssetUsage(s)[id].length);
  assert.match(backgroundCss(s), /opacity:0\.35/);
  assert.match(backgroundCss(s), /background-repeat:repeat;opacity:0}/);
  assert(
    !backgroundCss({
      ...s,
      backgroundLightId: '"</style><script>',
      backgroundDarkId: null,
    }).includes("script"),
  );
  assert.equal(
    settingsInput.safeParse({ ...s, backgroundLightOpacity: 101 }).success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({ ...s, backgroundDarkMode: "url(x)" }).success,
    false,
  );
  assert.equal(backgroundDefaults.backgroundDarkId, null);
});

test("local animated SVG accepts embedded real rasters but rejects spoofing, external resources and active content", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const image = sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ff0000" },
    });
    const bytes = await image[format]().toBuffer();
    const uri = `data:image/${format};base64,${bytes.toString("base64")}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 8 8"><image xlink:href="${uri}" width="8" height="8"><animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite"/></image></svg>`;
    assert.equal((await prepareSvg(Buffer.from(svg))).toString(), svg);
    for (const href of [
      uri.replace(format, "svg+xml"),
      "https://example.test/image.png",
      "/api/assets/x",
      "data:image/png;base64," + Buffer.from("<svg/>").toString("base64"),
      "data:image/png;base64,abcd-_",
    ])
      await assert.rejects(
        prepareSvg(Buffer.from(`<svg><image href="${href}"/></svg>`)),
      );
    await assert.rejects(
      prepareSvg(Buffer.from(`<svg><use href="${uri}"/></svg>`)),
    );
    await assert.rejects(
      prepareSvg(
        Buffer.from(`<svg><image href="${uri}" onload="alert(1)"/></svg>`),
      ),
    );
    await assert.rejects(
      prepareSvg(
        Buffer.from(
          `<svg><image href="${uri}"><set attributeName="href" to="https://example.test/a"/></image></svg>`,
        ),
      ),
    );
  }
});

test("additive taxonomy migration preserves old bikes and independent queries respect visibility", async () => {
  const db = new PGlite();
  try {
    const files = (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const name of files.filter((f) => f < "020"))
      await db.exec(
        await readFile(new URL("../db/" + name, import.meta.url), "utf8"),
      );
    const owner = randomUUID(),
      blocked = randomUUID(),
      old = randomUUID();
    for (const id of [owner, blocked])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Rider','hash')",
        [id, id + "@test.example"],
      );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,year,category,purposes,is_public) VALUES($1,$1,$2,'Legacy',2020,'gravel',$3,true)",
      [old, owner, ["travel", "winter", "custom"]],
    );
    await db.exec(
      await readFile(
        new URL("../db/020_bike_classification.sql", import.meta.url),
        "utf8",
      ),
    );
    // The queries below run on the current schema.
    for (const name of files.filter((f) => f >= "021"))
      await db.exec(
        await readFile(new URL("../db/" + name, import.meta.url), "utf8"),
      );
    const legacy = (await db.query("SELECT * FROM bikes WHERE id=$1", [old]))
      .rows[0];
    assert.equal(legacy.category, "gravel");
    assert.deepEqual(legacy.purposes, ["travel", "winter", "custom"]);
    assert.deepEqual(legacy.classification.uses, ["touring"]);
    assert.equal(legacy.classification.suspension, null);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      defaultSettings,
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      defaultCatalog,
    ]);
    const c = classification({
      construction: "folding",
      electric: true,
      uses: ["commuting"],
    });
    const data = bikeInput.parse({
      ...baseBike,
      name: "Folding commuter",
      classification: c,
    });
    const bike = await insertBike(db, owner, data);
    await insertBike(db, owner, { ...data, name: "Private", is_public: false });
    // Insert blocked owner through SQL: API explicitly forbids their mutations.
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,year,category,classification,is_public) VALUES($1,$1,$2,'Blocked',2021,'urban_touring',$3,true)",
      [randomUUID(), blocked, c],
    );
    const input = {
      category: "urban_touring",
      construction: "folding",
      electric: "1",
      use: "commuting",
    };
    const shelf = await showcase(db, null, {
      category: input.category,
      classification: input,
    });
    assert.deepEqual(
      shelf.bikes.map((b) => b.id),
      [bike],
    );
    const found = await discoverySearch(
      db,
      discoveryInput.parse({ ...input, type: "bikes" }),
    );
    assert.equal(found.total, 1);
    assert.equal(found.groups[0].items[0].id, bike);
    const experience = await searchExperience(
      db,
      null,
      searchInput.parse(input),
    );
    assert.equal(experience.total, 1);
    assert.equal(
      (await showcase(db, null, { category: "gravel" })).bikes[0].id,
      old,
    );
    assert.equal(
      (await showcase(db, null, { category: "road_gravel" })).total,
      1,
    );
    assert.equal(
      (
        await showcase(db, null, {
          category: "urban_touring",
          classification: { electric: "0" },
        })
      ).total,
      0,
    );
    await db.query("UPDATE bikes SET category='mtb' WHERE id=$1", [bike]);
    const changed = (await db.query("SELECT * FROM bikes WHERE id=$1", [bike]))
      .rows[0];
    assert.equal(changed.classification.category, "mtb");
    assert.equal(changed.classification.subtype, null);
    assert.equal(changed.classification.electric, true);
    assert.equal(changed.classification.construction, "folding");
    assert.deepEqual(changed.classification.uses, ["commuting"]);
    assert.equal(
      (
        await showcase(db, null, {
          category: "mtb",
          classification: { electric: "1" },
        })
      ).total,
      1,
    );
    assert.equal(
      (
        await discoverySearch(
          db,
          discoveryInput.parse({ category: "urban_touring", type: "bikes" }),
        )
      ).total,
      0,
    );
  } finally {
    await db.close();
  }
});


test("graphics groups expose independent background slots and compose with text search", () => {
  const backgrounds = filterGraphicSlots(illustrationSlots, "", "Фон сайта");
  assert.deepEqual(backgrounds.map((slot) => slot.key), ["backgroundLightId", "backgroundDarkId"]);
  assert.deepEqual(filterGraphicSlots(illustrationSlots, "светлая", "Фон сайта").map((slot) => slot.key), ["backgroundLightId"]);
  assert.deepEqual(filterGraphicSlots(illustrationSlots, "фон", "Брендинг"), []);
  assert.equal(filterGraphicSlots(illustrationSlots, "", "all").length, illustrationSlots.length);
});
