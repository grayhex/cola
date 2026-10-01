// Run only inside the disposable PostgreSQL HTTP harness.
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { selectBikeWeek } from "../lib/bike-week.ts";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});
const a = await pool.connect(),
  b = await pool.connect();
const owner = randomUUID(),
  bike = randomUUID(),
  now = new Date("2040-01-02T12:00:00Z"),
  week = "2040-01-02";
const original = (
  await a.query("SELECT value FROM bike_week_settings WHERE id=1")
).rows[0].value;
let second;
try {
  await a.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Concurrency','hash',$3)",
    [owner, owner + "@example.test", "week-" + owner.slice(0, 8)],
  );
  await a.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,is_public) VALUES($1,$2,$3,'Concurrent bike','Cube','Travel',2026,'road',true)",
    [bike, owner, randomUUID()],
  );
  await a.query("INSERT INTO photos(id,bike_id,filename) VALUES($1,$2,$3)", [
    randomUUID(),
    bike,
    bike + ".webp",
  ]);
  for (let n = 0; n < 5; n++)
    await a.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build',$3,'Part')",
      [randomUUID(), bike, "Category " + n],
    );
  await a.query(
    "INSERT INTO bike_week_decisions VALUES($1,'override',$2,$3,'Concurrency fixture')",
    [week, bike, owner],
  );
  await a.query("UPDATE bike_week_settings SET value='{}'");
  await a.query("BEGIN");
  await b.query("BEGIN");
  const first = await selectBikeWeek(a, now);
  const pid = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid;
  second = selectBikeWeek(b, now);
  let blocked = false;
  for (let n = 0; n < 50; n++) {
    blocked = (
      await pool.query("SELECT cardinality(pg_blocking_pids($1))>0 blocked", [
        pid,
      ])
    ).rows[0].blocked;
    if (blocked) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(blocked, "second worker waits for first week's transaction");
  await a.query("COMMIT");
  const repeated = await second;
  await b.query("COMMIT");
  assert.equal(repeated.bike_id, first.bike_id);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM bike_week_history WHERE week_start=$1 AND event='selected'",
          [week],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM notifications WHERE type='bike_week' AND bike_id=$1",
          [bike],
        )
      ).rows[0].n,
    ),
    1,
  );
  console.log("Bike week: overlapping workers choose once and notify once.");
} finally {
  await a.query("ROLLBACK").catch(() => {});
  await b.query("ROLLBACK").catch(() => {});
  await second?.catch(() => {});
  await a.query("DELETE FROM bike_week_decisions WHERE week_start=$1", [week]);
  await a.query("DELETE FROM bike_weeks WHERE week_start=$1", [week]);
  await a.query("DELETE FROM bike_week_history WHERE week_start=$1", [week]);
  await a.query("DELETE FROM users WHERE id=$1", [owner]);
  await a.query("UPDATE bike_week_settings SET value=$1 WHERE id=1", [
    original,
  ]);
  a.release();
  b.release();
  await pool.end();
}
