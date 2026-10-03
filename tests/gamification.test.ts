import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../lib/db.ts";
import type { JournalRow } from "../lib/database-rows.ts";
import {
  records,
  awardCatalog,
  awardShelf,
  reactToBike,
  excludeBike,
  gameShelf,
  accountAchievements,
  leaderboardSQL,
} from "../lib/gamification.ts";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.ts";
import { gameSettingsInput } from "../lib/gamification-validation.ts";
import { defaultGamification } from "../lib/gamification-definitions.ts";
import {
  seedSiteDefaults,
  testDatabase,
  migrateOnly,
  type TestDatabase,
} from "./support/database.ts";
import { bikeRow, photoRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";
import { present } from "./support/assertions.ts";
import { one } from "./support/rows.ts";
import { journalEntryRow } from "./support/notifications.ts";
import { rideRow } from "./support/rides.ts";
import {
  loadRules,
  saveRules,
  recalculateAwards,
  rulesInput,
} from "../lib/game-rules.ts";
async function setup() {
  const q = await testDatabase();
  await seedSiteDefaults(q);
  return q;
}
async function rider(q: Queryable, name: string) {
  return (
    await userRow(q, { email: name + "@example.test", name, username: name })
  ).id;
}
interface BikeOptions {
  price?: number;
  weight?: number;
  category?: string;
  visible?: boolean;
  publicBike?: boolean;
}
async function bike(
  q: Queryable,
  owner: string,
  {
    price = 10000,
    weight = 10,
    category = "road",
    visible = true,
    publicBike = true,
  }: BikeOptions = {},
) {
  const row = await bikeRow(q, owner, {
    name: "Build",
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category,
    price,
    weight,
    show_bike_price: visible,
    is_public: publicBike,
  });
  await photoRow(q, row.id);
  return row.id;
}
const holder = (r: Awaited<ReturnType<typeof records>>, key: string) =>
  r.records.find((record) => record.key === key)?.holder;
// The holder of a record that has one.
const held = (r: Awaited<ReturnType<typeof records>>, key: string) =>
  present(holder(r, key));
test("Hall of Fame selects the latest visible recipient by timestamp then ID, with public context and distinct counts", async () => {
  const q = await setup();
  try {
    const first = await rider(q, "first"),
      second = await rider(q, "second");
    const firstBike = await bike(q, first),
      secondBike = await bike(q, second);
    const anotherBike = await bike(q, second);
    const stamp = "2026-09-01T12:34:56.789Z";
    const next = "2026-09-02T00:00:00.000Z";
    // Fixtures target existing rules without changing calculation or triggers.
    for (const [userId, bikeId] of [
      [first, firstBike],
      [second, secondBike],
      [second, anotherBike],
    ]) {
      await q.query(
        "INSERT INTO achievement_awards(achievement_key,user_id,bike_id,awarded_at) VALUES('wireless',$1,$2,$3)",
        [userId, bikeId, stamp],
      );
    }
    await q.query(
      "UPDATE achievement_awards SET awarded_at=$1 WHERE achievement_key='first_public'",
      [stamp],
    );
    const find = async (key: string) =>
      (await awardCatalog(q)).find((a) => a.key === key);
    const item = async (key: string) => present(await find(key));
    const latest = async (key: string) =>
      present((await item(key)).latestRecipient);
    let award = await item("wireless");
    const recipient = present(award.latestRecipient);
    assert.equal(award.earners, 2); // Two bikes of one person count only once.
    assert.equal(present(recipient.bike).id, anotherBike); // Equal timestamps: greater ID wins.
    assert.equal(recipient.author.id, second);
    assert.equal(new Date(recipient.awardedAt).toISOString(), stamp);
    assert.deepEqual(Object.keys(recipient.author).sort(), [
      "avatar",
      "id",
      "name",
      "username",
    ]);
    assert.equal((await latest("first_public")).author.id, second);
    assert.equal((await latest("first_public")).bike, null);
    assert.equal((await item("century")).latestRecipient, null);
    assert.equal((await item("century")).earners, 0);
    await q.query(
      "UPDATE achievement_awards SET awarded_at=$1 WHERE bike_id=$2",
      [next, firstBike],
    );
    assert.equal(present((await latest("wireless")).bike).id, firstBike); // Timestamp precedes ID.
    await q.query(
      "UPDATE bikes SET name='Renamed public bike',is_public=false WHERE id=$1",
      [firstBike],
    );
    award = await item("wireless");
    assert.equal(award.earners, 1);
    assert.equal(present(present(award.latestRecipient).bike).id, anotherBike);
    assert.ok(!JSON.stringify(award).includes(firstBike));
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [second]);
    assert.equal((await item("wireless")).latestRecipient, null);
    assert.equal((await item("wireless")).earners, 0);
    assert.equal((await latest("first_public")).author.id, first);
    await q.query("UPDATE bikes SET is_public=true WHERE id=$1", [firstBike]);
    assert.equal(
      present((await latest("wireless")).bike).name,
      "Renamed public bike",
    );
    await q.query("DELETE FROM bikes WHERE id=$1", [firstBike]);
    assert.equal((await item("wireless")).latestRecipient, null);
    await q.query(
      "UPDATE game_rules SET enabled=false WHERE key='first_public'",
    );
    assert.equal(await find("first_public"), undefined);
    const snapshot = await records(q);
    assert.ok(Number.isFinite(Date.parse(snapshot.asOf)));
    assert.ok(
      snapshot.records.every(
        (r) =>
          !Object.hasOwn(r, "awardedAt") && !Object.hasOwn(r, "held_since"),
      ),
    );
  } finally {
    await q.close();
  }
});
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
    assert.equal(held(r, "expensive").id, road);
    assert.equal(held(r, "budget").id, gravel);
    assert.equal(held(r, "lightest_mtb").id, mtb);
    assert.equal(held(r, "lightest_road").id, road);
    const hidden = await bike(q, b, {
      price: 987654321,
      visible: false,
      weight: 0,
    });
    await bike(q, b, { price: 1, weight: 0 });
    const privateId = await bike(q, b, { price: 999999999, publicBike: false });
    r = await records(q);
    assert.equal(held(r, "expensive").id, road);
    assert.equal(held(r, "budget").id, gravel);
    assert(!JSON.stringify(r).includes("987654321"));
    assert(!JSON.stringify(r).includes(privateId));
    await q.query("UPDATE bikes SET price=100000 WHERE id=$1", [mtb]);
    assert.equal(held(await records(q), "expensive").id, mtb);
    await excludeBike(q, a, mtb, { excluded: true, reason: "Invalid build" });
    assert.equal(held(await records(q), "expensive").id, road);
    assert.equal(
      (
        await q.query(
          "SELECT count(*) FROM admin_audit WHERE action='leaderboard.exclude'",
        )
      ).rows[0].count,
      1,
    );
    await excludeBike(q, a, mtb, { excluded: false, reason: "Verified" });
    assert.equal(held(await records(q), "expensive").id, mtb);
    await q.query("UPDATE bikes SET show_bike_price=false WHERE id=$1", [mtb]);
    assert.equal(held(await records(q), "expensive").id, road);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [a]);
    assert.equal(holder(await records(q), "lightest_road"), null);
    const raw = present(
      (
        await q.query<{ id: string; price: string | null }>(leaderboardSQL)
      ).rows.find((x) => x.id === hidden),
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
    await assert.rejects(() => reactToBike(q, id, a, "wild", true), {
      status: 403,
    });
    await reactToBike(q, id, b, "wild", true);
    await reactToBike(q, id, b, "wild", true);
    await reactToBike(q, id, b, "dream", true);
    const r = await records(q);
    assert.equal(held(r, "wild").value, 1);
    assert.equal(held(r, "community").value, 1);
    await reactToBike(q, id, c, "clean", true);
    assert.equal(held(await records(q), "community").value, 2);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [c]);
    assert.equal(held(await records(q), "community").value, 1);
    await assert.rejects(() => reactToBike(q, id, c, "wild", true), {
      status: 401,
    });
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
    assert.equal(holder(await records(q), "community"), null);
    await assert.rejects(() => reactToBike(q, id, b, "clean", true), {
      status: 404,
    });
  } finally {
    await q.close();
  }
});
// Rides and journal entries for the rules of #106.
interface GameRideOptions {
  km?: number;
  gain?: number;
  kmh?: number;
  maxKmh?: number | null;
  showMax?: boolean;
  visible?: boolean;
  startedAt?: Date;
  status?: string;
}
async function ride(
  q: Queryable,
  owner: string,
  bikeId: string,
  {
    km = 20,
    gain = 100,
    kmh = 20,
    maxKmh = null,
    showMax = true,
    visible = true,
    startedAt = new Date(),
    status = "completed",
  }: GameRideOptions = {},
) {
  return (
    await rideRow(q, owner, bikeId, {
      title: "Покатушка",
      started_at: startedAt,
      distance_m: Math.round(km * 1000),
      avg_speed_mps: kmh / 3.6,
      elevation_gain_m: gain,
      is_public: visible,
      status,
      import_metrics: maxKmh === null ? {} : { maxSpeedMps: maxKmh / 3.6 },
      visible_metrics: showMax
        ? ["distanceM", "avgSpeedMps", "maxSpeedMps"]
        : null,
    })
  ).id;
}
async function entry(
  q: Queryable,
  owner: string,
  bikeId: string,
  {
    kind = "story",
    visible = true,
    status = "published",
  }: {
    kind?: JournalRow["kind"];
    visible?: boolean;
    status?: JournalRow["status"];
  } = {},
) {
  await journalEntryRow(q, owner, bikeId, {
    kind,
    title: "Запись",
    body: "Текст",
    status,
    is_public: visible,
    published_at: new Date(),
    event_date: null,
    mileage: null,
  });
}
const has = async (q: Queryable, userId: string, key: string) =>
  (
    await one<{ n: number }>(
      q,
      "SELECT count(*)::int AS n FROM achievement_awards WHERE user_id=$1 AND achievement_key=$2",
      [userId, key],
    )
  ).n;
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
const asInput = (rule: Record<string, unknown>) =>
  Object.fromEntries(inputFields.map((field) => [field, rule[field]]));
const inTransaction = (q: TestDatabase) => q.transaction;

test("migration backfills existing public milestones; blocked votes never earn a new milestone", async () => {
  const q = await testDatabase({ migrated: false });
  try {
    await migrateOnly(q, (f) => f < "011");
    const owner = await rider(q, "legacy"),
      id = await bike(q, owner);
    await migrateOnly(q, (f) => f >= "011");
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
    await assert.rejects(() => reactToBike(q, id, v, "clean", true), {
      status: 409,
    });
    assert.equal(
      (await q.query("SELECT count(*)::int AS n FROM bike_reactions")).rows[0]
        .n,
      1,
    );
    await q.query("UPDATE game_rules SET enabled=true");
    await q.query("UPDATE gamification_settings SET value=$1", [
      defaultGamification,
    ]);
    assert.equal(held(await records(q), "dream").id, id);
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
    assert.equal(
      present(saved.find((r) => r.key === "rule_speedster")).subject,
      "ride",
    );
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
    const award = present(
      (await awardShelf(q, { userId: fast })).find(
        (a) => a.key === "rule_speedster",
      ),
    );
    assert.equal(award.name, "Гонщик");
    assert.equal(award.scope, "user");
    // The record: the slowest ride from 10 km, not the short one.
    let turtle = held(await records(q), "rule_slowpoke");
    assert.ok(turtle.kind === "ride");
    assert.equal(turtle.id, crawl);
    assert.equal(turtle.bike.id, slowBike);
    assert.equal(turtle.author.id, slow);
    assert.equal(turtle.value, 14);
    // A new leader takes the record.
    const slower = await ride(q, fast, fastBike, { km: 11, kmh: 10 });
    turtle = held(await records(q), "rule_slowpoke");
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
    const save = (list: unknown[]) =>
      saveRules(q, admin, rulesInput.parse({ rules: list }));
    await assert.rejects(
      () => save(rules.filter((r) => r.key !== "marathon")),
      { status: 400, message: /нельзя удалить/ },
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
    await assert.rejects(() => save(rules), {
      status: 409,
      message: /«Витрина»/,
    });
    await assert.rejects(
      () =>
        save(
          rules.map((r) =>
            r.key === "turtle"
              ? { ...r, kind: "award", direction: null, threshold: 1 }
              : r,
          ),
        ),
      { status: 400 },
    );
    await assert.rejects(
      () =>
        save([
          ...rules,
          { ...custom, imageId: "00000000-0000-4000-8000-00000000000a" },
        ]),
      { status: 409 },
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
    assert.equal(held(r, "marathon").id, hiddenSpeed);
    assert.equal(held(r, "marathon").value, 30);
    assert.equal(held(r, "climber").value, 200);
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
    assert.equal(held(after, "marathon").author.id, b);
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
    assert.equal(held(r, "marathon").value, 500);
    assert.equal(held(r, "climber").value, 1200);
    const mileage = held(r, "mileage_30d");
    assert.equal(mileage.kind, "profile");
    assert.equal(mileage.id, b);
    assert.equal(mileage.value, 60);
    assert.equal(held(r, "veteran").id, heavy);
    assert.equal(held(r, "veteran").value, 1995);
    assert.equal(held(r, "heavy").id, heavy);
    assert.equal(held(r, "heavy").value, 24);
    // Progress to what is still ahead: the best public ride.
    const c = await rider(q, "beginner"),
      own = await bike(q, c);
    await ride(q, c, own, { km: 60, gain: 350 });
    await ride(q, c, own, { km: 45, gain: 500, visible: false });
    const account = await accountAchievements(q, c);
    const century = present(account.locked.find((x) => x.key === "century"));
    assert.equal(century.progress, 60);
    assert.equal(century.target, 100);
    assert.equal(century.metric, "ride_distance");
    assert.equal(
      present(account.locked.find((x) => x.key === "mountain_goat")).progress,
      350,
    );
    assert(!account.locked.some((x) => x.key === "first_public"));
  } finally {
    await q.close();
  }
});
test("settings migration keeps awards, records, illustrations and descriptions", async () => {
  const q = await testDatabase({ migrated: false });
  try {
    await migrateOnly(q, (f) => f < "027");
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
      await q.query<{ id: string; awarded_at: Date }>(
        "SELECT id,awarded_at FROM achievement_awards ORDER BY id",
      )
    ).rows;
    assert.ok(before.length > 0);
    await migrateOnly(q, (f) => f === "027_game_rules.sql");
    const loaded = new Map((await loadRules(q)).map((r) => [r.key, r]));
    const rules = { get: (key: string) => present(loaded.get(key)) };
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
    const first = present(shelf.find((a) => a.key === "first_public"));
    assert.equal(first.name, "Первый выход");
    assert.equal(first.description, "Дебют");
    assert.equal(first.imageId, art);
  } finally {
    await q.close();
  }
});

test("profile shelves group repeated bicycle awards by rule key after visibility checks", async () => {
  const q = await setup();
  try {
    const owner = await rider(q, "wireless-owner");
    const first = await bike(q, owner),
      second = await bike(q, owner);
    const hidden = await bike(q, owner, { publicBike: false });
    for (const [id, stamp] of [
      [first, "2026-09-01"],
      [second, "2026-09-02"],
      [hidden, "2026-09-03"],
    ])
      await q.query(
        "INSERT INTO achievement_awards(achievement_key,user_id,bike_id,awarded_at) VALUES('wireless',$1,$2,$3)",
        [owner, id, stamp],
      );
    // Distinct rules may share a title: only stable keys define identity.
    await q.query(
      "UPDATE game_rules SET name='Без проводов' WHERE key='first_public'",
    );
    const raw = await awardShelf(q, { userId: owner });
    assert.equal(raw.filter((a) => a.key === "wireless").length, 2);
    const profile = await gameShelf(q, { userId: owner });
    const wireless = profile.awards.filter((a) => a.key === "wireless");
    assert.equal(wireless.length, 1);
    assert.equal(wireless[0].bikeId, second); // latest visible award, never hidden context
    assert.equal(
      profile.awards.filter((a) => a.name === "Без проводов").length,
      2,
    );
    const account = await accountAchievements(q, owner);
    assert.equal(account.awards.filter((a) => a.key === "wireless").length, 1);
    assert.equal(
      present(account.awards.find((a) => a.key === "wireless")).bikeId,
      hidden,
    );
    for (const bikeId of [first, second]) {
      const shelf = await gameShelf(q, { bikeId });
      assert.equal(
        present(shelf.awards.find((a) => a.key === "wireless")).bikeId,
        bikeId,
      );
    }
    assert.equal(
      (
        await q.query(
          "SELECT count(*)::int AS n FROM achievement_awards WHERE achievement_key='wireless' AND user_id=$1",
          [owner],
        )
      ).rows[0].n,
      3,
    );
    await q.query("UPDATE bikes SET is_public=false WHERE owner_id=$1", [
      owner,
    ]);
    assert.equal(
      (await gameShelf(q, { userId: owner })).awards.some(
        (a) => a.key === "wireless",
      ),
      false,
    );
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.deepEqual((await accountAchievements(q, owner)).awards, []);
  } finally {
    await q.close();
  }
});

test("compact record features preserve configured scoring and Unicode completeness without component/gallery payloads", async () => {
  const q = await setup();
  try {
    const owner = await rider(q, "feature-score"),
      id = await bike(q, owner);
    const parts = [
      ["build", "Переключатель", "  SHIMANO—Di2  ", "drivetrain"],
      ["build", "переключатель", "shimano di2", "drivetrain"],
      ["build", "Руль", "Ｃａｒｂｏｎ bar", "invalid"],
      ["build", "Рама", "\u00a0\t\n", "frame"],
      ["accessories", "Фонарь", "Shimano Di2", "other"],
    ];
    for (const [section, category, name, group] of parts)
      await q.query(
        "INSERT INTO components(id,bike_id,section,category,name,group_id) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), id, section, category, name, group],
      );
    const scoring = {
      ...defaultSettings.scoring,
      componentTarget: 3,
      photoPoints: 40,
      rules: [
        {
          groupId: "drivetrain",
          category: "",
          match: "shimano di2",
          points: 7,
        },
        { groupId: "cockpit", category: "Руль", match: "carbon", points: 9 },
        { groupId: "other", category: "", match: "shimano", points: 20 },
        { groupId: "", category: "", match: "!!!", points: 50 },
      ],
    };
    await q.query(
      "UPDATE site_settings SET value=jsonb_set(value,'{scoring}',$1)",
      [scoring],
    );
    await q.query(
      "UPDATE gamification_settings SET value=jsonb_set(value,'{minimumCompleteness}','0')",
    );
    const { scoreBike } = await import("../lib/bike-score.ts");
    const expected = scoreBike(
      {
        category: "road",
        weight: 10,
        price: 10000,
        show_bike_price: true,
        components: parts.map(([section, category, name, group_id]) => ({
          section,
          category,
          name,
          group_id,
        })),
        photos: [{}],
      },
      scoring,
      defaultCatalog.componentGroups,
    );
    const queries: string[] = [];
    const measured: Queryable = {
      query: async <Row extends object>(sql: string, params?: unknown[]) => {
        queries.push(sql);
        return q.query<Row>(sql, params);
      },
    };
    const hall = await records(measured);
    assert.equal(held(hall, "upgrade").value, expected.upgrade);
    assert.equal(held(hall, "complete").value, expected.completeness);
    const raw = (await q.query(leaderboardSQL)).rows[0];
    assert(!Object.hasOwn(raw, "components"));
    assert(!Object.hasOwn(raw, "photos"));
    assert.equal(
      queries.filter((sql) => sql.includes("FROM site_settings")).length,
      1,
    );
    const originalQueries = queries.length;
    queries.length = 0;
    await q.query(
      "INSERT INTO game_rules(key,kind,subject,metric,direction,name) SELECT 'duplicate_'||n,'record','user','total_distance',CASE WHEN n%2=0 THEN 'min' ELSE 'max' END,'Duplicate '||n FROM generate_series(1,30) n",
    );
    await records(measured);
    assert(
      queries.length <= originalQueries + 1,
      "rules with the same scope share one metric query across min/max",
    );
    await q.query("UPDATE bikes SET show_bike_price=false WHERE id=$1", [id]);
    assert.equal(holder(await records(q), "expensive"), null);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert((await records(q)).records.every((r) => !r.holder));
  } finally {
    await q.close();
  }
});
