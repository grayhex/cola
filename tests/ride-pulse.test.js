import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { ridePulse, ridePulsePeople } from "../lib/ride-pulse.ts";
const now = new Date("2026-10-01T20:30:00Z"); // 23:30 Moscow, Thursday
async function setup() {
  const q = new PGlite();
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await q.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  return q;
}
async function user(q, blocked = false) {
  const id = randomUUID();
  await q.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,'Pulse rider','hash',$3,$4)",
    [
      id,
      id + "@example.test",
      "p" + id.replaceAll("-", "").slice(0, 20),
      blocked,
    ],
  );
  return id;
}
async function intent(
  q,
  owner,
  start,
  {
    visibility = "community",
    status = "active",
    readiness = "ready",
    end,
  } = {},
) {
  const id = randomUUID();
  await q.query(
    "INSERT INTO ride_intents(id,owner_id,readiness,time_zone,visibility,status,request_hash,passport) VALUES($1,$2,$3,'Europe/Moscow',$4,$5,'hash','{\"area\":{\"center\":[37,55]}}')",
    [id, owner, readiness, visibility, status],
  );
  await q.query("INSERT INTO ride_intent_windows VALUES($1,$2,$3)", [
    id,
    start,
    end || new Date(new Date(start).getTime() + 3600000),
  ]);
  return id;
}
test("pulse counts unique people by nearest Moscow window, keeps identity behind authenticated reads and immediately removes hidden/expired plans", async () => {
  const q = await setup();
  try {
    assert.equal((await ridePulse(q, now)).total, 0);
    const owners = await Promise.all(Array.from({ length: 7 }, () => user(q)));
    const first = await intent(q, owners[0], "2026-10-01T20:00:00Z"); // ongoing
    await intent(q, owners[0], "2026-10-03T10:00:00Z"); // same person, not another count
    await intent(q, owners[1], "2026-10-01T21:00:00Z", {
      readiness: "considering",
    }); // tomorrow in Moscow
    await intent(q, owners[2], "2026-10-03T10:00:00Z");
    await intent(q, owners[3], "2026-10-09T10:00:00Z"); // later
    await intent(q, owners[4], "2026-10-10T10:00:00Z"); // later weekend
    await intent(q, owners[5], "2026-10-01T21:00:00Z", {
      visibility: "private",
    });
    await intent(q, owners[6], "2026-10-01T21:00:00Z", { status: "cancelled" });
    await intent(q, owners[6], "2026-10-01T19:30:00Z"); // ends exactly now
    await intent(q, owners[6], "2026-10-01T21:00:00Z", { status: "deleted" });
    await intent(q, await user(q, true), "2026-10-01T21:00:00Z");
    const queries = [];
    const measured = {
      query: async (sql, args) => {
        const result = await q.query(sql, args);
        queries.push(result.rows);
        return result;
      },
    };
    const pulse = await ridePulse(measured, now);
    assert.equal(pulse.total, 5);
    assert.equal(pulse.ready, 4);
    assert.equal(pulse.considering, 1);
    assert.deepEqual(
      pulse.buckets.map((b) => b.count),
      [1, 1, 1, 2],
    );
    assert.equal(queries.length, 1);
    assert.equal(queries[0].length, 1);
    assert(!JSON.stringify(pulse).includes(owners[0]));
    assert(!JSON.stringify(pulse).includes("Pulse rider"));
    const people = await ridePulsePeople(q, owners[0], now);
    assert.equal(people.people.length, 4);
    assert.equal(people.people[0].author.id, owners[0]);
    assert(!JSON.stringify(people).includes("center"));
    assert(!JSON.stringify(people).includes("example.test"));
    assert.deepEqual((await ridePulsePeople(q, randomUUID(), now)).people, []);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [owners[0]]);
    assert.deepEqual((await ridePulsePeople(q, owners[0], now)).people, []);
    assert.equal((await ridePulse(q, now)).total, 4);
    await q.query("UPDATE users SET blocked=false WHERE id=$1", [owners[0]]);
    await q.query("UPDATE ride_intents SET visibility='private' WHERE id=$1", [
      first,
    ]);
    assert.deepEqual(
      (await ridePulse(q, now)).buckets.map((b) => b.count),
      [0, 1, 2, 2],
    );
    // On Saturday the same person cannot occupy both today and weekend.
    assert.deepEqual(
      (await ridePulse(q, new Date("2026-10-03T09:30:00Z"))).buckets.map(
        (b) => b.count,
      ),
      [2, 0, 0, 2],
    );
  } finally {
    await q.close();
  }
});
test("home migration selects approved raster only and preserves explicit admin settings", async () => {
  const q = await setup();
  try {
    const approved = randomUUID(),
      other = randomUUID();
    await q.query(
      "INSERT INTO site_assets(id,name,filename) VALUES($1,'new_hero1.png',$2),($3,'another.png',$4)",
      [approved, approved + ".webp", other, other + ".webp"],
    );
    const migration = await readFile(
      new URL("../db/046_home_redesign.sql", import.meta.url),
      "utf8",
    );
    await q.query("INSERT INTO site_settings(id,value) VALUES(1,'{}')");
    await q.exec(migration);
    assert.equal(
      (await q.query("SELECT value FROM site_settings")).rows[0].value
        .heroBackgroundImageId,
      approved,
    );
    await q.query("UPDATE site_settings SET value=$1", [
      {
        heroBackgroundImageId: other,
        heroHeadline: "Custom",
        heroDescription: "Custom description",
      },
    ]);
    await q.exec(migration);
    assert.deepEqual(
      (await q.query("SELECT value FROM site_settings")).rows[0].value,
      {
        heroBackgroundImageId: other,
        heroHeadline: "Custom",
        heroDescription: "Custom description",
      },
    );
    await q.query(
      "UPDATE site_settings SET value='{\"heroBackgroundImageId\":null}'",
    );
    await q.exec(migration);
    assert.equal(
      (await q.query("SELECT value FROM site_settings")).rows[0].value
        .heroBackgroundImageId,
      null,
    );
    await q.query("DELETE FROM site_assets");
    await q.query("UPDATE site_settings SET value='{}'");
    await q.exec(migration);
    assert.equal(
      (await q.query("SELECT value FROM site_settings")).rows[0].value
        .heroBackgroundImageId,
      undefined,
    );
  } finally {
    await q.close();
  }
});
