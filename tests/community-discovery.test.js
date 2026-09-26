import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import sharp from "sharp";
import {
  discoveryInput,
  discoverySearch,
  communityActivity,
  communityHome,
} from "../lib/discovery.js";
import { showcase } from "../lib/showcase.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { settingsInput } from "../lib/admin-validation.js";
import { themeBootstrap, resolveTheme } from "../lib/theme.js";
import { siteAssetIds } from "../lib/site-assets.js";
import { prepareThumbnail } from "../lib/images.js";

test("theme bootstrap chooses system, persisted preference and storage failure without unsafe injection", () => {
  for (const [saved, defaultTheme, dark, expected] of [
    [null, "system", true, "dark"],
    [null, "system", false, "light"],
    ["light", "dark", true, "light"],
    ["dark", "light", false, "dark"],
    ["system", "light", true, "dark"],
    ["</script>", "light", true, "light"],
  ]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(themeBootstrap(defaultTheme), {
      document,
      localStorage: { getItem: () => saved },
      matchMedia: () => ({ matches: dark }),
    });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(themeBootstrap(), {
    document,
    localStorage: {
      getItem: () => {
        throw Error();
      },
    },
    matchMedia: () => ({ matches: true }),
  });
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert(!themeBootstrap("</script><script>alert(1)").includes("</script>"));
  assert(
    !settingsInput.safeParse({
      ...defaultSettings,
      appearance: { theme: "dark", accent: "red; color:red" },
    }).success,
  );
  const id = randomUUID();
  assert(siteAssetIds({ ...defaultSettings, heroImageId: id }).includes(id));
});
test("compact photo derivatives preserve aspect ratio and bound work", async () => {
  const source = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 4,
      background: { r: 150, g: 170, b: 190, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const out = await prepareThumbnail(source, 160),
    metadata = await sharp(out).metadata();
  assert.equal(metadata.width, 160);
  assert.equal(metadata.height, 107);
  assert(metadata.hasAlpha);
  await assert.rejects(() => prepareThumbnail(source, 4000));
});
test("unified discovery enforces privacy, literal search, grouping, useful links and existing popularity", async () => {
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
      "017_rides_market",
      "018_articles_rsvp",
      "020_bike_classification",
      "021_former_bikes_market_types",
      "026_market_expiry",
      "027_game_rules",
    ])
      await db.exec(
        await readFile(new URL(`../db/${m}.sql`, import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const owner = randomUUID(),
      viewer = randomUUID(),
      blocked = randomUUID();
    for (const [id, name] of [
      [owner, "Сергей"],
      [viewer, "Зритель"],
      [blocked, "Blocked"],
    ])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,$3,'hash',$4,$5)",
        [id, id + "@example.test", name, "u" + id.slice(0, 8), id === blocked],
      );
    const bikes = [];
    for (const [name, pub, user] of [
      ["Canyon Grail", true, owner],
      ["Cube Travel", true, owner],
      ["Secret Bike", false, owner],
      ["Blocked Bike", true, blocked],
      ["100%_literal", true, owner],
    ]) {
      const id = randomUUID(),
        share = randomUUID();
      bikes.push({ id, share, name });
      await db.query(
        "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$3,$4,2026,'gravel',$5)",
        [id, user, share, name, pub],
      );
      await db.query(
        "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Групсет',$3)",
        [
          randomUUID(),
          id,
          pub && user !== blocked ? "SRAM Force AXS" : "SECRET SRAM Force",
        ],
      );
    }
    await db.query("INSERT INTO bike_likes(bike_id,user_id) VALUES($1,$2)", [
      bikes[1].id,
      viewer,
    ]);
    const rides = [];
    for (const [bike, title, pub] of [
      [bikes[0], "Москва — Истра", true],
      [bikes[0], "Secret Ride", false],
      [bikes[2], "Secret Parent Ride", true],
      [bikes[3], "Blocked Ride", true],
    ]) {
      const id = randomUUID(),
        share = randomUUID();
      rides.push({ id, share });
      await db.query(
        "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash) VALUES($1,$2,$3,$4,$5,82000,2,2,'[]',$6,500,$7)",
        [
          id,
          share,
          bike === bikes[3] ? blocked : owner,
          bike.id,
          title,
          pub,
          id,
        ],
      );
    }
    const journal = randomUUID(),
      journalShare = randomUUID();
    await db.query(
      "INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public) VALUES($1,$2,$3,$4,'story','История Grail','Первый маршрут на новом велосипеде','published',true)",
      [journal, journalShare, owner, bikes[0].id],
    );
    const search = async (input) =>
      discoverySearch(db, discoveryInput.parse(input));
    assert.equal(
      (await search({ q: "grail" })).groups.find((g) => g.type === "bikes")
        .items[0].href,
      "/b/" + bikes[0].share,
    );
    const components = (await search({ q: "SRAM" })).groups.find(
      (g) => g.type === "components",
    );
    assert.equal(components.items.length, 1);
    assert.equal(components.items[0].metadata.bikes, 3);
    const target = new URL(components.items[0].href, "https://example.test");
    assert.equal(target.searchParams.get("component"), "SRAM Force AXS");
    assert.equal(
      (await search(Object.fromEntries(target.searchParams))).total,
      3,
    );
    assert.equal(
      (await search({ q: "Истра" })).groups[0].items[0].href,
      "/r/" + rides[0].share,
    );
    assert.equal((await search({ q: "Сергей", type: "rides" })).total, 1);
    for (const q of ["SECRET", "Blocked", "<script>", "' OR 1=1 --"])
      assert.equal((await search({ q })).total, 0);
    for (const q of ["%", "_"])
      assert.equal((await search({ q, type: "bikes" })).total, 1);
    assert.equal((await search({ q: "" })).total, 0);
    assert(!discoveryInput.safeParse({ q: "a".repeat(151) }).success);
    assert(!discoveryInput.safeParse({ q: "\0" }).success);
    const activity = await communityActivity(db);
    assert.deepEqual(
      new Set(activity.events.map((e) => e.type)),
      new Set(["bike", "ride", "journal", "achievement"]),
    );
    assert(activity.events.some((e) => e.href === "/j/" + journalShare));
    assert(activity.content.some((item) => item.type === "journal"));
    assert(!JSON.stringify(activity).match(/Secret|Blocked/));
    const popular = await showcase(db, viewer, { sort: "popular" }),
      home = await communityHome(db, viewer);
    assert.deepEqual(
      home.popular.map((b) => b.id),
      popular.bikes.slice(0, 9).map((b) => b.id),
    );
    assert.equal(home.popular[0].id, bikes[1].id);
    assert.equal(home.popular[0].liked, true);
    assert(!JSON.stringify(home).includes("public_geometry"));
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [
      bikes[0].id,
    ]);
    assert.equal((await search({ q: "Истра" })).total, 0);
    assert(
      !(await communityActivity(db)).events.some(
        (e) =>
          e.href === "/j/" + journalShare || e.href === "/r/" + rides[0].share,
      ),
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal((await search({ q: "SRAM" })).total, 0);
    const empty = await communityHome(db);
    assert.equal(empty.events.length, 0);
    assert.equal(empty.popular.length, 0);
  } finally {
    await db.close();
  }
});
