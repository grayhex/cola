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
import {
  loadRules,
  saveRules,
  recalculateAwards,
  rulesInput,
} from "../lib/game-rules.js";
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
// Rides and journal entries for the rules of #106.
async function ride(
  q,
  owner,
  bikeId,
  {
    km = 20,
    gain = 100,
    kmh = 20,
    maxKmh = null,
    showMax = true,
    visible = true,
    startedAt = new Date(),
    status = "completed",
  } = {},
) {
  const id = randomUUID();
  await q.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,started_at,distance_m,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash,status,import_metrics,visible_metrics)
     VALUES($1,$2,$3,$4,'Покатушка',$5,$6,$7,$8,2,2,'{"type":"LineString","coordinates":[]}',$9,500,$10,$11,$12,$13)`,
    [
      id,
      randomUUID(),
      owner,
      bikeId,
      startedAt,
      Math.round(km * 1000),
      kmh / 3.6,
      gain,
      visible,
      randomUUID(),
      status,
      maxKmh === null ? {} : { maxSpeedMps: maxKmh / 3.6 },
      showMax
        ? JSON.stringify(["distanceM", "avgSpeedMps", "maxSpeedMps"])
        : null,
    ],
  );
  return id;
}
async function entry(
  q,
  owner,
  bikeId,
  { kind = "story", visible = true, status = "published" } = {},
) {
  await q.query(
    "INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,published_at) VALUES($1,$2,$3,$4,$5,'Запись','Текст',$6,$7,now())",
    [randomUUID(), randomUUID(), owner, bikeId, kind, status, visible],
  );
}
const has = async (q, userId, key) =>
  (
    await q.query(
      "SELECT count(*)::int AS n FROM achievement_awards WHERE user_id=$1 AND achievement_key=$2",
      [userId, key],
    )
  ).rows[0].n;
// What the admin editor sends: a rule without its service fields.
const inputFields = [
  "key",
  "kind",
  "metric",
  "comparison",
  "threshold",
  "direction",
  "category",
  "minDistanceKm",
  "keywords",
  "name",
  "description",
  "imageId",
  "enabled",
];
const asInput = (rule) =>
  Object.fromEntries(inputFields.map((field) => [field, rule[field]]));
const inTransaction = (q) => (fn) => q.transaction(fn);

test("migration backfills existing public milestones; blocked votes never earn a new milestone", async () => {
  const q = new PGlite();
  try {
    const files = (await readdir(new URL("../db", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files.filter((f) => f < "011"))
      await q.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = await rider(q, "legacy"),
      id = await bike(q, owner);
    for (const f of files.filter((f) => f >= "011"))
      await q.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
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
test("switched-off records and the reaction switch remove titles without deleting votes; identity/threshold gates are explicit", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "toggleowner"),
      v = await rider(q, "togglevoter"),
      id = await bike(q, a);
    await reactToBike(q, id, v, "dream", true);
    assert(holder(await records(q), "dream"));
    await q.query(
      "UPDATE game_rules SET enabled=key IN ('budget','dream') WHERE kind='record'",
    );
    await q.query("UPDATE gamification_settings SET value=$1", [
      { ...defaultGamification, reactionsEnabled: false },
    ]);
    assert.deepEqual(
      (await records(q)).records.map((r) => r.key),
      ["budget"],
    );
    await assert.rejects(
      () => reactToBike(q, id, v, "clean", true),
      (e) => e.status === 409,
    );
    assert.equal(
      (await q.query("SELECT count(*)::int AS n FROM bike_reactions")).rows[0]
        .n,
      1,
    );
    await q.query("UPDATE game_rules SET enabled=true");
    await q.query("UPDATE gamification_settings SET value=$1", [
      defaultGamification,
    ]);
    assert.equal(holder(await records(q), "dream").id, id);
    await q.query("UPDATE bikes SET brand='' WHERE id=$1", [id]);
    assert.equal(holder(await records(q), "budget"), null);
    await q.query("UPDATE gamification_settings SET value=$1", [
      { ...defaultGamification, minimumCompleteness: 100 },
    ]);
    assert(
      (await records(q)).records
        .filter((r) => r.subject === "bike")
        .every((r) => r.holder === null),
    );
  } finally {
    await q.close();
  }
});

// #106 acceptance: without code, an administrator creates «Гонщик» and
// «Черепаха»; recalculation issues the award, the award stays when the
// condition stops, the record moves to a new leader.
test("rules from the catalog: an admin creates «Гонщик» and «Черепаха», awards stay, records move", async () => {
  const q = await setup();
  try {
    const admin = await rider(q, "gameadmin"),
      fast = await rider(q, "fast"),
      slow = await rider(q, "slow");
    const fastBike = await bike(q, fast),
      slowBike = await bike(q, slow);
    const sprint = await ride(q, fast, fastBike, {
      km: 40,
      kmh: 30,
      maxKmh: 62,
    });
    const crawl = await ride(q, slow, slowBike, {
      km: 12,
      kmh: 14,
      maxKmh: 38,
    });
    await ride(q, slow, slowBike, { km: 5, kmh: 6 });
    const rules = await loadRules(q);
    const saved = await saveRules(
      q,
      admin,
      rulesInput.parse({
        rules: [
          ...rules.map(asInput),
          {
            key: "rule_speedster",
            kind: "award",
            metric: "ride_max_speed",
            comparison: "gte",
            threshold: 55,
            name: "Гонщик",
            description: "Разогнаться до 55 км/ч",
            enabled: true,
          },
          {
            key: "rule_slowpoke",
            kind: "record",
            metric: "ride_avg_speed",
            direction: "min",
            minDistanceKm: 10,
            name: "Черепаха",
            enabled: true,
          },
        ],
      }),
    );
    assert.equal(saved.find((r) => r.key === "rule_speedster").subject, "ride");
    assert.equal(
      (
        await q.query(
          "SELECT count(*)::int AS n FROM admin_audit WHERE action='gamification.rules'",
        )
      ).rows[0].n,
      1,
    );
    // Saved, not issued yet: rides happened before the rule.
    assert.equal(await has(q, fast, "rule_speedster"), 0);
    const { awarded } = await recalculateAwards(inTransaction(q), admin, 2);
    assert.ok(awarded >= 1);
    assert.equal(await has(q, fast, "rule_speedster"), 1);
    assert.equal(await has(q, slow, "rule_speedster"), 0);
    assert.equal((await recalculateAwards(inTransaction(q), admin)).awarded, 0);
    const award = (await awardShelf(q, { userId: fast })).find(
      (a) => a.key === "rule_speedster",
    );
    assert.equal(award.name, "Гонщик");
    assert.equal(award.scope, "user");
    // The record: the slowest ride from 10 km, not the short one.
    let turtle = holder(await records(q), "rule_slowpoke");
    assert.equal(turtle.kind, "ride");
    assert.equal(turtle.id, crawl);
    assert.equal(turtle.bike.id, slowBike);
    assert.equal(turtle.author.id, slow);
    assert.equal(turtle.value, 14);
    // A new leader takes the record.
    const slower = await ride(q, fast, fastBike, { km: 11, kmh: 10 });
    turtle = holder(await records(q), "rule_slowpoke");
    assert.equal(turtle.id, slower);
    assert.equal(turtle.author.id, fast);
    // The award stays when its condition no longer holds.
    await q.query("UPDATE rides SET visible_metrics=NULL WHERE id=$1", [
      sprint,
    ]);
    await q.query("DELETE FROM rides WHERE id=$1", [sprint]);
    await recalculateAwards(inTransaction(q), admin);
    assert.equal(await has(q, fast, "rule_speedster"), 1);
    // A switched-off award leaves shelves but not the history.
    await q.query(
      "UPDATE game_rules SET enabled=false WHERE key='rule_speedster'",
    );
    assert(
      !(await awardShelf(q, { userId: fast })).some(
        (a) => a.key === "rule_speedster",
      ),
    );
    assert.equal(await has(q, fast, "rule_speedster"), 1);
  } finally {
    await q.close();
  }
});
test("saving rules keeps built-ins and history: no deletion of awarded or built-in rules, no kind change, no missing art", async () => {
  const q = await setup();
  try {
    const admin = await rider(q, "gameadmin"),
      owner = await rider(q, "owner");
    await bike(q, owner);
    const rules = (await loadRules(q)).map(asInput);
    const save = (list) =>
      saveRules(q, admin, rulesInput.parse({ rules: list }));
    await assert.rejects(
      () => save(rules.filter((r) => r.key !== "marathon")),
      (e) => e.status === 400 && /нельзя удалить/.test(e.message),
    );
    const custom = {
      key: "rule_first",
      kind: "award",
      metric: "public_bikes",
      comparison: "gte",
      threshold: 1,
      name: "Витрина",
      enabled: true,
    };
    await save([...rules, custom]);
    await recalculateAwards(inTransaction(q), admin);
    assert.equal(await has(q, owner, "rule_first"), 1);
    await assert.rejects(
      () => save(rules),
      (e) => e.status === 409 && /«Витрина»/.test(e.message),
    );
    await assert.rejects(
      () =>
        save(
          rules.map((r) =>
            r.key === "turtle"
              ? { ...r, kind: "award", direction: null, threshold: 1 }
              : r,
          ),
        ),
      (e) => e.status === 400,
    );
    await assert.rejects(
      () =>
        save([
          ...rules,
          { ...custom, imageId: "00000000-0000-4000-8000-00000000000a" },
        ]),
      (e) => e.status === 409,
    );
    // A rule nobody earned can go.
    const unused = { ...custom, key: "rule_unused", threshold: 50 };
    await save([...rules, custom, unused]);
    assert.deepEqual(
      (await save([...rules, custom]))
        .filter((r) => !r.builtin)
        .map((r) => r.key),
      ["rule_first"],
    );
  } finally {
    await q.close();
  }
});
test("hidden data never counts: a private ride, a private bike, a blocked owner, a hidden maximum speed", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "private"),
      b = await rider(q, "public");
    const open = await bike(q, a),
      closed = await bike(q, a, { publicBike: false });
    await ride(q, a, open, { km: 300, gain: 5000, maxKmh: 90, visible: false });
    await ride(q, a, closed, { km: 250, gain: 4000, maxKmh: 85 });
    const hiddenSpeed = await ride(q, a, open, {
      km: 30,
      gain: 200,
      maxKmh: 80,
      showMax: false,
    });
    await ride(q, a, open, { km: 150, gain: 1500, status: "planned" });
    for (const key of ["century", "mountain_goat", "racer"])
      assert.equal(await has(q, a, key), 0, key);
    const r = await records(q);
    assert.equal(holder(r, "marathon").id, hiddenSpeed);
    assert.equal(holder(r, "marathon").value, 30);
    assert.equal(holder(r, "climber").value, 200);
    const serialized = JSON.stringify(r);
    for (const secret of ["300", "250", "5000", "4000"])
      assert(!serialized.includes('"value":' + secret), secret);
    // The owner shows the maximum speed: now it counts.
    await q.query(
      "UPDATE rides SET visible_metrics='[\"maxSpeedMps\"]' WHERE id=$1",
      [hiddenSpeed],
    );
    assert.equal(await has(q, a, "racer"), 1);
    // A blocked owner leaves the records.
    const other = await bike(q, b);
    await ride(q, b, other, { km: 10 });
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [a]);
    const after = await records(q);
    assert.equal(holder(after, "marathon").author.id, b);
    assert.equal(
      (await awardShelf(q, { userId: a, privateView: true })).length,
      0,
    );
  } finally {
    await q.close();
  }
});
test("new awards and records: Без проводов, Сотка, Горный козёл, Круглый год, Летописец, Механик; Марафонец, Альпинист, Наматыватель, Ветеран, Тяжеловоз", async () => {
  const q = await setup();
  try {
    const a = await rider(q, "allyear"),
      b = await rider(q, "writer");
    const road = await bike(q, a, { weight: 8 }),
      heavy = await bike(q, b, { weight: 24, category: "mtb" });
    await q.query("UPDATE bikes SET year=1995 WHERE id=$1", [heavy]);
    await q.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Переключатель','Shimano Ultegra Di2 RD-R8150')",
      [randomUUID(), road],
    );
    await q.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Переключатель','SRAM GX Eagle')",
      [randomUUID(), heavy],
    );
    assert.equal(
      (await awardShelf(q, { bikeId: road })).filter(
        (x) => x.key === "wireless",
      ).length,
      1,
    );
    assert.equal(await has(q, b, "wireless"), 0);
    for (let month = 0; month < 11; month++)
      await ride(q, a, road, {
        km: 10,
        startedAt: new Date(Date.UTC(2025, month, 15)),
      });
    assert.equal(await has(q, a, "all_year"), 0);
    await ride(q, a, road, {
      km: 104,
      gain: 1200,
      startedAt: new Date(Date.UTC(2025, 11, 15)),
    });
    for (const key of ["all_year", "century", "mountain_goat"])
      assert.equal(await has(q, a, key), 1, key);
    for (let i = 0; i < 9; i++) await entry(q, b, heavy, { kind: "service" });
    await entry(q, b, heavy, { kind: "service", visible: false });
    await entry(q, b, heavy, { kind: "service", status: "draft" });
    assert.equal(await has(q, b, "mechanic"), 0);
    await entry(q, b, heavy, { kind: "service" });
    assert.equal(await has(q, b, "mechanic"), 1);
    assert.equal(await has(q, b, "chronicler"), 1);
    // Recent kilometres: a ride from 40 days ago does not count.
    await ride(q, b, heavy, {
      km: 60,
      startedAt: new Date(Date.now() - 2 * 86400000),
    });
    await ride(q, b, heavy, {
      km: 500,
      startedAt: new Date(Date.now() - 40 * 86400000),
    });
    const r = await records(q);
    assert.equal(holder(r, "marathon").value, 500);
    assert.equal(holder(r, "climber").value, 1200);
    const mileage = holder(r, "mileage_30d");
    assert.equal(mileage.kind, "profile");
    assert.equal(mileage.id, b);
    assert.equal(mileage.value, 60);
    assert.equal(holder(r, "veteran").id, heavy);
    assert.equal(holder(r, "veteran").value, 1995);
    assert.equal(holder(r, "heavy").id, heavy);
    assert.equal(holder(r, "heavy").value, 24);
    // Progress to what is still ahead: the best public ride.
    const c = await rider(q, "beginner"),
      own = await bike(q, c);
    await ride(q, c, own, { km: 60, gain: 350 });
    await ride(q, c, own, { km: 45, gain: 500, visible: false });
    const account = await accountAchievements(q, c);
    const century = account.locked.find((x) => x.key === "century");
    assert.equal(century.progress, 60);
    assert.equal(century.target, 100);
    assert.equal(century.metric, "ride_distance");
    assert.equal(
      account.locked.find((x) => x.key === "mountain_goat").progress,
      350,
    );
    assert(!account.locked.some((x) => x.key === "first_public"));
  } finally {
    await q.close();
  }
});
test("settings migration keeps awards, records, illustrations and descriptions", async () => {
  const q = new PGlite();
  try {
    const files = (await readdir(new URL("../db", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files.filter((f) => f < "027"))
      await q.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = await rider(q, "legacy");
    await bike(q, owner);
    const art = randomUUID(),
      deleted = randomUUID();
    await q.query(
      "INSERT INTO site_assets(id,name,filename) VALUES($1,'Кубок','cup.webp')",
      [art],
    );
    await q.query("UPDATE gamification_settings SET value=$1", [
      {
        ...defaultGamification,
        enabledRecords: ["expensive", "dream"],
        recordImages: { expensive: art, budget: deleted, nope: art },
        achievementImages: { first_public: art },
        recordDescriptions: { budget: "  Дёшево и сердито  " },
        achievementDescriptions: { first_public: "Дебют" },
      },
    ]);
    const before = (
      await q.query("SELECT id,awarded_at FROM achievement_awards ORDER BY id")
    ).rows;
    assert.ok(before.length > 0);
    await q.exec(
      await readFile(
        new URL("../db/027_game_rules.sql", import.meta.url),
        "utf8",
      ),
    );
    const rules = new Map((await loadRules(q)).map((r) => [r.key, r]));
    assert.equal(rules.get("expensive").imageId, art);
    assert.equal(rules.get("budget").imageId, null);
    assert.equal(rules.get("first_public").imageId, art);
    assert.equal(rules.get("budget").description, "Дёшево и сердито");
    assert.equal(rules.get("first_public").description, "Дебют");
    assert.equal(rules.get("expensive").enabled, true);
    assert.equal(rules.get("dream").enabled, true);
    assert.equal(rules.get("budget").enabled, false);
    // New records were not in the old switch and start switched on.
    assert.equal(rules.get("marathon").enabled, true);
    assert.equal(rules.get("full_build").threshold, 21);
    assert.deepEqual(
      (
        await q.query(
          "SELECT id,awarded_at FROM achievement_awards WHERE id=ANY($1::bigint[]) ORDER BY id",
          [before.map((a) => a.id)],
        )
      ).rows,
      before,
    );
    const shelf = await awardShelf(q, { userId: owner });
    const first = shelf.find((a) => a.key === "first_public");
    assert.equal(first.name, "Первый выход");
    assert.equal(first.description, "Дебют");
    assert.equal(first.imageId, art);
  } finally {
    await q.close();
  }
});
