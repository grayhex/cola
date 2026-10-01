import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  selectBikeWeek,
  currentBikeWeek,
  updateBikeWeekStory,
  bikeWeekPreview,
  decideBikeWeek,
  saveBikeWeekSettings,
  getBikeWeekSettings,
  searchBikeWeekChoices,
} from "../lib/bike-week.ts";
import {
  bikeWeekStart,
  bikeWeekSettingsInput,
  bikeWeekStoryInput,
  weekInput,
} from "../lib/bike-week-validation.ts";
import { notificationPage } from "../lib/notifications.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
const now = new Date("2026-10-01T09:00:00Z"),
  week = "2026-09-28",
  stamp = "2026-09-26T12:00:00Z";
async function setup() {
  const q = new PGlite();
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await q.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await q.query("INSERT INTO site_settings VALUES(1,$1,1,now())", [
    defaultSettings,
  ]);
  await q.query("INSERT INTO site_catalog VALUES(1,$1,1,now())", [
    defaultCatalog,
  ]);
  return q;
}
async function user(q) {
  const id = randomUUID();
  await q.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Rider','hash',$3)",
    [id, id + "@example.test", "u" + id.replaceAll("-", "").slice(0, 20)],
  );
  return id;
}
async function bike(q, owner, id = randomUUID()) {
  await q.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,is_public,description) VALUES($1,$2,$3,'Touring','Cube','Travel',2026,'road',true,'Public story')",
    [id, owner, randomUUID()],
  );
  await q.query(
    "INSERT INTO photos(id,bike_id,filename,is_cover) VALUES($1,$2,$3,true)",
    [randomUUID(), id, id + ".webp"],
  );
  for (const category of [
    "Рама",
    "Вилка",
    "Тормоза",
    "Колёса",
    "Руль",
    "Седло",
    "Педали",
    "Цепь",
  ])
    await q.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build',$3,$4)",
      [randomUUID(), id, category, "Shimano " + category],
    );
  return id;
}
async function activity(
  q,
  bikeId,
  actor,
  kinds = ["like", "clean", "dream", "comment", "comment"],
) {
  for (const kind of kinds) {
    if (kind === "like")
      await q.query(
        "INSERT INTO bike_likes VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [bikeId, actor, stamp],
      );
    else if (kind === "comment")
      await q.query(
        "INSERT INTO bike_comments(id,bike_id,author_id,body,created_at) VALUES($1,$2,$3,'Comment',$4)",
        [randomUUID(), bikeId, actor, stamp],
      );
    else
      await q.query(
        "INSERT INTO bike_reactions VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [bikeId, actor, kind, stamp],
      );
  }
}
const tx = (q, fn) => q.transaction(fn);
test("admin search bypasses score and cooldown but excludes private, blocked, opted-out and incomplete bikes", async () => {
  const q = await setup();
  try {
    const owner = await user(q),
      blocked = await user(q);
    const publicBike = await bike(q, owner),
      privateBike = await bike(q, owner),
      excluded = await bike(q, owner),
      declined = await bike(q, owner),
      incomplete = await bike(q, owner);
    await bike(q, blocked);
    await q.query("UPDATE users SET name='Searchable Author' WHERE id=$1", [
      owner,
    ]);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [
      privateBike,
    ]);
    await q.query("UPDATE bikes SET leaderboard_excluded=true WHERE id=$1", [
      excluded,
    ]);
    await q.query("DELETE FROM components WHERE bike_id=$1", [incomplete]);
    await q.query(
      "INSERT INTO bike_week_declines(week_start,bike_id) VALUES($1,$2)",
      [week, declined],
    );
    await q.query(
      "INSERT INTO bike_week_history(week_start,bike_id,owner_id,event) VALUES('2026-09-21',$1,$2,'selected')",
      [publicBike, owner],
    );
    assert.equal(
      (await bikeWeekPreview(q, week)).candidates.length,
      0,
      "automatic thresholds still apply",
    );
    for (const query of ["", "Touring", "SEARCHABLE AUTHOR", publicBike]) {
      const rows = await searchBikeWeekChoices(q, week, query);
      assert.deepEqual(
        rows.map((b) => b.id),
        [publicBike],
      );
      assert(rows[0].photo_id);
      assert.equal(rows[0].owner_name, "Searchable Author");
      assert(!("email" in rows[0]));
    }
    assert.deepEqual(await searchBikeWeekChoices(q, week, "%_"), []);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [publicBike]);
    assert.deepEqual(await searchBikeWeekChoices(q, week, publicBike), []);
  } finally {
    await q.close();
  }
});
test("Moscow calendar, bounded settings and explicit owner publication", () => {
  assert.equal(bikeWeekStart(new Date("2026-09-27T20:59:59Z")), "2026-09-21");
  assert.equal(bikeWeekStart(new Date("2026-09-27T21:00:00Z")), week);
  assert(!weekInput.safeParse("2026-02-30").success);
  assert(!bikeWeekSettingsInput.safeParse({ windowDays: 0 }).success);
  assert(
    !bikeWeekStoryInput.safeParse({ action: "publish", text: "x".repeat(601) })
      .success,
  );
});
test("weekly scoring ignores self, blocked, deleted and outside-window activity; ties, snapshot, cooldown and notices", async () => {
  const q = await setup();
  try {
    const a = await user(q),
      b = await user(q),
      voter = await user(q),
      blocked = await user(q);
    const first = await bike(q, a, "00000000-0000-4000-8000-000000000001"),
      second = await bike(q, b, "00000000-0000-4000-8000-000000000002");
    await activity(q, first, voter);
    await activity(q, second, voter);
    await activity(q, first, a);
    await activity(q, first, blocked);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
    const deleted = await user(q);
    await activity(q, first, deleted, ["comment"]);
    await q.query(
      "UPDATE bike_comments SET body='',deleted_at=now() WHERE author_id=$1",
      [deleted],
    );
    const old = await user(q);
    await activity(q, first, old, ["like"]);
    await q.query(
      "UPDATE bike_likes SET created_at='2026-01-01' WHERE user_id=$1",
      [old],
    );
    let preview = await bikeWeekPreview(q, week);
    assert.equal(preview.candidates.length, 2);
    assert.deepEqual(
      [
        preview.candidates[0].likes,
        preview.candidates[0].reactions,
        preview.candidates[0].participants,
        preview.candidates[0].score,
      ],
      [1, 1, 1, 6],
    );
    assert.equal(preview.candidates[0].id, first);
    const selected = await tx(q, (c) => selectBikeWeek(c, now));
    assert.equal(selected.bike_id, first);
    await activity(q, second, await user(q));
    assert.equal((await tx(q, (c) => selectBikeWeek(c, now))).bike_id, first);
    assert.equal(
      Number(
        (
          await q.query(
            "SELECT count(*) n FROM notifications WHERE type='bike_week'",
          )
        ).rows[0].n,
      ),
      1,
    );
    assert.equal(
      (
        await q.query(
          "SELECT actor_id FROM notifications WHERE type='bike_week'",
        )
      ).rows[0].actor_id,
      null,
    );
    const dto = await currentBikeWeek(q, now);
    assert.equal(dto.bike.id, first);
    assert.equal(dto.components.length, 7);
    assert.equal(dto.text, "Public story");
    assert.equal(dto.textSource, "description");
    for (const key of [
      "score",
      "metrics",
      "history",
      "price",
      "email",
      "factory_spec",
    ])
      assert(!JSON.stringify(dto).includes('"' + key + '"'));
    await assert.rejects(
      () =>
        tx(q, (c) =>
          updateBikeWeekStory(c, b, { action: "publish", text: "stolen" }, now),
        ),
      /недоступно/,
    );
    const published = await tx(q, (c) =>
      updateBikeWeekStory(
        c,
        a,
        { action: "publish", text: "My explicit story" },
        now,
      ),
    );
    assert.equal(published.textSource, "owner");
    assert.equal(published.text, "My explicit story");
    assert.equal(
      (await q.query("SELECT description FROM bikes WHERE id=$1", [first]))
        .rows[0].description,
      "Public story",
    );
    // The following week's window has no activity, so allow zero signals solely
    // to check that cooldown still excludes the previous winner.
    await saveBikeWeekSettings(q, a, {
      ...(await getBikeWeekSettings(q)),
      minimumLikes: 0,
      minimumParticipants: 0,
      minimumScore: 0,
    });
    assert.equal(
      (await tx(q, (c) => selectBikeWeek(c, new Date("2026-10-05T10:00:00Z"))))
        .bike_id,
      second,
    );
    // Explicitly saved thresholds and weights affect the preview immediately.
    await saveBikeWeekSettings(q, a, {
      ...(await getBikeWeekSettings(q)),
      minimumReactions: 99,
    });
    preview = await bikeWeekPreview(q, week);
    assert.equal(preview.candidates.length, 0);
  } finally {
    await q.close();
  }
});
test("private/block/exclusion/deletion invalidation, refusal, override/skip and scheduled decisions", async () => {
  const q = await setup();
  try {
    const owner = await user(q),
      other = await user(q),
      voter = await user(q);
    const a = await bike(q, owner),
      b = await bike(q, other);
    await activity(q, a, voter);
    await activity(q, b, voter);
    await tx(q, (c) =>
      decideBikeWeek(
        c,
        owner,
        { week, action: "override", bikeId: a, reason: "Editorial choice" },
        now,
      ),
    );
    assert.equal((await currentBikeWeek(q, now)).bike.id, a);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [a]);
    assert.equal(await currentBikeWeek(q, now), null);
    await tx(q, (c) => selectBikeWeek(c, now));
    assert.equal((await currentBikeWeek(q, now)).bike.id, b);
    await tx(q, (c) =>
      updateBikeWeekStory(c, other, { action: "decline" }, now),
    );
    assert.equal(await currentBikeWeek(q, now), null);
    await q.query("UPDATE bikes SET is_public=true WHERE id=$1", [a]);
    await tx(q, (c) => selectBikeWeek(c, now));
    assert.equal(await currentBikeWeek(q, now), null);
    await assert.rejects(
      () =>
        tx(q, (c) =>
          decideBikeWeek(
            c,
            owner,
            {
              week,
              action: "override",
              bikeId: b,
              reason: "Must respect decline",
            },
            now,
          ),
        ),
      /недоступен/,
    );
    await tx(q, (c) =>
      decideBikeWeek(
        c,
        owner,
        { week, action: "skip", bikeId: null, reason: "No feature" },
        now,
      ),
    );
    assert.equal(
      (await tx(q, (c) => selectBikeWeek(c, now))).status,
      "skipped",
    );
    const future = "2026-10-05";
    await tx(q, (c) =>
      decideBikeWeek(
        c,
        owner,
        { week: future, action: "override", bikeId: a, reason: "Next week" },
        now,
      ),
    );
    assert.equal(
      (
        await q.query(
          "SELECT count(*)::int n FROM bike_weeks WHERE week_start=$1",
          [future],
        )
      ).rows[0].n,
      0,
    );
    const next = new Date("2026-10-05T10:00:00Z");
    await tx(q, (c) => selectBikeWeek(c, next));
    assert.equal((await currentBikeWeek(q, next)).bike.id, a);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal(await currentBikeWeek(q, next), null);
    await tx(q, (c) => selectBikeWeek(c, next));
    assert.equal(await currentBikeWeek(q, next), null);
    await q.query("UPDATE users SET blocked=false WHERE id=$1", [owner]);
    await tx(q, (c) =>
      decideBikeWeek(
        c,
        owner,
        {
          week: "2026-10-12",
          action: "override",
          bikeId: b,
          reason: "Third week",
        },
        now,
      ),
    );
    const third = new Date("2026-10-12T10:00:00Z");
    await tx(q, (c) => selectBikeWeek(c, third));
    await q.query("UPDATE bikes SET leaderboard_excluded=true WHERE id=$1", [
      b,
    ]);
    assert.equal(await currentBikeWeek(q, third), null);
    await q.query("DELETE FROM bikes WHERE id=$1", [b]);
    assert.equal(await currentBikeWeek(q, third), null);
    assert(
      (await q.query("SELECT count(*)::int n FROM bike_week_history")).rows[0]
        .n >= 8,
    );
    assert(
      (
        await q.query(
          "SELECT count(*)::int n FROM admin_audit WHERE action LIKE 'bike-week.%'",
        )
      ).rows[0].n >= 4,
    );
  } finally {
    await q.close();
  }
});
test("notification uses current ownership and a real service CTA, disabled rubric is hidden", async () => {
  const q = await setup();
  try {
    const owner = await user(q),
      b = await bike(q, owner),
      realNow = new Date();
    const currentWeek = bikeWeekStart(realNow);
    await tx(q, (c) =>
      decideBikeWeek(
        c,
        owner,
        {
          week: currentWeek,
          action: "override",
          bikeId: b,
          reason: "Notice test",
        },
        realNow,
      ),
    );
    let notices = await notificationPage(q, owner);
    const notice = notices.notifications.find((n) => n.type === "bike_week");
    assert(notice);
    assert.equal(notice.actor, null);
    assert.equal(notice.target.href, "/account?tab=spotlight");
    await saveBikeWeekSettings(q, owner, {
      ...(await getBikeWeekSettings(q)),
      enabled: false,
    });
    assert.equal(await currentBikeWeek(q, realNow), null);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [b]);
    notices = await notificationPage(q, owner);
    assert(!notices.notifications.some((n) => n.type === "bike_week"));
  } finally {
    await q.close();
  }
});
