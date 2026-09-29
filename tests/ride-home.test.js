import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  projectPoint,
  unprojectPoint,
  pointViewport,
  coarsePoint,
  metersPerPixel,
} from "../lib/map-settings.js";
import {
  durationBuckets,
  presetRange,
  readFilters,
  apiFilters,
  filterLabels,
} from "../lib/ride-filters.js";
import { rideList, upcomingRides } from "../lib/rides.js";
import { ridePassportInput } from "../lib/ride-plan.js";

test("area picker geometry: Mercator round trip, coarse 0.01° grid, circle size", () => {
  for (const zoom of [3, 10, 15])
    for (const point of [
      [37.62, 55.75],
      [-122.42, 37.77],
      [179.99, -45],
    ]) {
      const [lon, lat] = unprojectPoint(projectPoint(point, zoom), zoom);
      assert.ok(
        Math.abs(lon - point[0]) < 1e-9 && Math.abs(lat - point[1]) < 1e-9,
      );
    }
  assert.deepEqual(coarsePoint([37.62499, 55.75501]), [37.62, 55.76]);
  assert.deepEqual(coarsePoint([200, 89]), [180, 85]);
  // The picker never produces what the server validator would reject.
  const area = {
    label: "Парк",
    center: coarsePoint([37.6173, 55.7558]),
    radiusM: 5000,
  };
  assert.deepEqual(ridePassportInput.parse({ area }).area, area);
  const view = pointViewport([37.62, 55.75], 10, 640, 320);
  assert.deepEqual(view.point([37.62, 55.75]).map(Math.round), [320, 160]);
  const [lon, lat] = view.coordAt(320, 160);
  assert.ok(Math.abs(lon - 37.62) < 1e-9 && Math.abs(lat - 55.75) < 1e-9);
  assert.ok(view.tiles.length >= 6 && view.tiles.every((t) => t.z === 10));
  assert.equal(Math.round(view.pixels(1000) * metersPerPixel(55.75, 10)), 1000);
});

test("date presets are local and bounded; URL filters accept only public known values", () => {
  const at = (iso) => new Date(iso);
  // Wednesday → Saturday 00:00 … Monday 00:00 local.
  const wed = presetRange("weekend", at("2030-05-01T15:00:00"));
  assert.equal(wed.from.getDay(), 6);
  assert.equal(wed.from.getHours(), 0);
  assert.equal(wed.to.getDay(), 1);
  assert.equal((+wed.to - +wed.from) / 86400000, 2);
  // Saturday afternoon starts now; Sunday ends at Monday midnight.
  const sat = presetRange("weekend", at("2030-05-04T15:00:00"));
  assert.equal(+sat.from, +at("2030-05-04T15:00:00"));
  assert.equal(sat.to.getDay(), 1);
  const sun = presetRange("weekend", at("2030-05-05T15:00:00"));
  assert.equal(sun.to.getDay(), 1);
  assert.ok(+sun.to - +sun.from < 86400000);
  const today = presetRange("today", at("2030-05-01T15:00:00"));
  assert.equal(today.to.getHours(), 0);
  assert.equal(presetRange("never"), null);
  const filters = readFilters(
    new URLSearchParams(
      "when=weekend&pace=fast&purpose=social&surface=gravel&duration=medium&area=%20Сокольники%20&intent=secret&lat=55",
    ),
  );
  assert.deepEqual(filters, {
    when: "weekend",
    purpose: "social",
    surface: "gravel",
    duration: "medium",
    area: "Сокольники",
  });
  const api = apiFilters(filters, at("2030-05-01T15:00:00"));
  assert.equal(api.durationMin, "121");
  assert.equal(api.durationMax, "240");
  assert.ok(api.from && api.to);
  assert.equal("when" in api, false);
  assert.deepEqual(
    filterLabels(filters).map(([k]) => k),
    ["when", "purpose", "surface", "duration", "area"],
  );
});

async function migrated() {
  const db = new PGlite();
  for (const file of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
    );
  return db;
}
const H = 3600000;
const base = Date.now() + 48 * H;
const soon = (hours) => new Date(base + hours * H).toISOString();

test("upcoming rides: organizer, accepted, maybe, pending invitation, cancellations and access", async () => {
  const db = await migrated();
  try {
    let n = 0;
    const user = async (blocked = false) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,'Rider','hash',$3,$4)",
        [id, id + "@test.invalid", "home" + n++, blocked],
      );
      return id;
    };
    const bike = async (owner, isPublic = true) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Bike',2026,'gravel',$3)",
        [id, owner, isPublic],
      );
      return id;
    };
    const plan = async (owner, b, start, o = {}) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO rides(id,owner_id,bike_id,share_id,title,source_hash,status,source_kind,has_track,meeting_point,started_at,is_public,
          distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,plan_passport,meeting_visibility)
         VALUES($1::uuid,$2,$3,$1::uuid,$4,'p:'||$1::text,$5,'planned',false,'Gate 7',$6,$7,0,0,0,'[]',500,$8,'participants')`,
        [
          id,
          owner,
          b,
          o.title || "Plan",
          o.status || "planned",
          start,
          o.isPublic ?? true,
          JSON.stringify(o.passport || {}),
        ],
      );
      return id;
    };
    const rsvp = (ride, u, at, response) =>
      db.query(
        "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response) VALUES($1,$2,$3,$4)",
        [ride, u, at, response],
      );
    const me = await user(),
      org = await user(),
      blocked = await user(true);
    const myBike = await bike(me),
      orgBike = await bike(org),
      hidden = await bike(org, false),
      blockedBike = await bike(blocked);
    await plan(me, myBike, soon(1), { title: "Own" });
    const accepted = await plan(org, orgBike, soon(2), { title: "Accepted" });
    const maybe = await plan(org, orgBike, soon(3), { title: "Maybe" });
    const invited = await plan(org, orgBike, soon(4), {
      title: "Invited",
      isPublic: false,
    });
    const declined = await plan(org, orgBike, soon(5), { title: "Declined" });
    const cancelled = await plan(org, orgBike, soon(6), { title: "Cancelled" });
    const hiddenNow = await plan(org, hidden, soon(7), { title: "Hidden" });
    const blockedAuthor = await plan(blocked, blockedBike, soon(8), {
      title: "Blocked",
    });
    const far = await plan(org, orgBike, soon(24 * 70), { title: "Far" });
    const strangerInvite = await plan(org, orgBike, soon(9), {
      title: "Other invite",
      isPublic: false,
    });
    await rsvp(accepted, me, soon(2), "accepted");
    await rsvp(maybe, me, soon(3), "maybe");
    await db.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
      [invited, me],
    );
    await rsvp(declined, me, soon(5), "declined");
    await rsvp(cancelled, me, soon(6), "accepted");
    await db.query(
      "UPDATE rides SET status='cancelled',updated_at=now() WHERE id=$1",
      [cancelled],
    );
    await rsvp(hiddenNow, me, soon(7), "accepted");
    await rsvp(blockedAuthor, me, soon(8), "accepted");
    await rsvp(far, me, soon(24 * 70), "accepted");
    void strangerInvite;
    // An edit after the answer is flagged.
    await db.query("UPDATE rides SET updated_at=now() WHERE id=$1", [accepted]);
    const list = await upcomingRides(db, me);
    assert.deepEqual(
      list.map((r) => [r.title, r.role]),
      [
        ["Own", "organizer"],
        ["Accepted", "accepted"],
        ["Maybe", "maybe"],
        ["Invited", "invited"],
        ["Cancelled", "cancelled"],
      ],
    );
    const byTitle = Object.fromEntries(list.map((r) => [r.title, r]));
    assert.equal(
      byTitle.Accepted.meetingPoint,
      "Gate 7",
      "accepted sees the meeting point",
    );
    assert.equal(byTitle.Maybe.meetingHidden, true, "maybe does not");
    assert.equal(byTitle.Invited.meetingHidden, true);
    assert.equal(byTitle.Cancelled.meetingPoint, "");
    assert.equal(byTitle.Accepted.changedAfterAnswer, true);
    assert.equal(byTitle.Maybe.changedAfterAnswer, false);
    assert.doesNotMatch(JSON.stringify(list), /@test\.invalid/);
    // Nobody else sees these commitments; a blocked viewer gets nothing.
    // Accepted, maybe, invited, declined, hidden and the other invitation;
    // the cancelled plan and the one 70 days away are not listed.
    const organizer = await upcomingRides(db, org);
    assert.equal(organizer.length, 6);
    assert.ok(organizer.every((r) => r.role === "organizer"));
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [me]);
    assert.deepEqual(await upcomingRides(db, me), []);
  } finally {
    await db.close();
  }
});

test("public upcoming filters: future only, passport choices, duration buckets and escaped area text", async () => {
  const db = await migrated();
  try {
    const owner = randomUUID(),
      b = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'R','h','filters')",
      [owner, owner + "@test.invalid"],
    );
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'B',2026,'gravel',true)",
      [b, owner],
    );
    const add = (title, start, passport, end = null, isPublic = true) =>
      db.query(
        `INSERT INTO rides(id,owner_id,bike_id,share_id,title,source_hash,status,source_kind,has_track,started_at,plan_ends_at,is_public,
          distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,plan_passport)
         VALUES(gen_random_uuid(),$1,$2,gen_random_uuid(),$3,'s'||$3,'planned','planned',false,$4,$5,$6,0,0,0,'[]',500,$7)`,
        [owner, b, title, start, end, isPublic, JSON.stringify(passport)],
      );
    await add("Past", new Date(Date.now() - 48 * H).toISOString(), {
      pace: "relaxed",
    });
    await add(
      "Short relaxed",
      soon(1),
      { pace: "relaxed", purpose: "social", area: { label: "Сокольники" } },
      soon(2.5),
    );
    await add("Long sporty", soon(3), {
      pace: "sporty",
      surface: "gravel",
      durationMinutes: { min: 200, max: 300 },
    });
    await add("Unknown", soon(4), { area: { label: "100%_парк" } });
    await add("Private", soon(5), { pace: "relaxed" }, null, false);
    const titles = async (plan) =>
      (await rideList(db, null, { status: "planned", plan })).rides.map(
        (r) => r.title,
      );
    assert.deepEqual(await titles({}), [
      "Short relaxed",
      "Long sporty",
      "Unknown",
    ]);
    assert.deepEqual(await titles({ pace: "relaxed" }), ["Short relaxed"]);
    assert.deepEqual(await titles({ surface: "gravel" }), ["Long sporty"]);
    assert.deepEqual(await titles({ durationMax: 120 }), ["Short relaxed"]);
    assert.deepEqual(await titles({ durationMin: 240 }), ["Long sporty"]);
    // Buckets never overlap: exactly 120 min is short, exactly 240 is medium.
    await add("Exactly two hours", soon(6), {}, soon(8));
    await add("Exactly four hours", soon(7), {}, soon(11));
    const bucket = async (key) =>
      titles(
        Object.fromEntries(
          Object.entries(durationBuckets[key][1]).map(([k, v]) => [k, v]),
        ),
      );
    const short = await bucket("short"),
      medium = await bucket("medium"),
      long = await bucket("long");
    assert.ok(short.includes("Exactly two hours"));
    assert.ok(!medium.includes("Exactly two hours"));
    assert.ok(medium.includes("Exactly four hours"));
    assert.ok(!long.includes("Exactly four hours"));
    for (const t of short) assert.ok(!medium.includes(t) && !long.includes(t));
    assert.deepEqual(await titles({ area: "сокол" }), ["Short relaxed"]);
    assert.deepEqual(
      await titles({ area: "%" }),
      ["Unknown"],
      "% is literal, not a wildcard",
    );
    assert.deepEqual(await titles({ area: "0%_п" }), ["Unknown"]);
    assert.deepEqual(await titles({ to: soon(2) }), ["Short relaxed"]);
    // Own lists and past rides are unaffected by the public filters.
    assert.equal(
      (
        await rideList(db, owner, {
          own: true,
          status: "planned",
          plan: { pace: "sporty" },
        })
      ).total,
      7,
    );
  } finally {
    await db.close();
  }
});
