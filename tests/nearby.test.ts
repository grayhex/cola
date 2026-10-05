import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  NearbyError,
  forgetNearby,
  isCellCenter,
  nearbyGrid,
  nearbyState,
  pruneNearbyAreas,
  removeNearbyArea,
  saveNearbyArea,
  saveNearbySettings,
  snapToCell,
} from "../lib/nearby.ts";
import { exportAccount } from "../lib/account-data.ts";
import { testDatabase } from "./support/database.ts";
import { labelledUser } from "./support/people.ts";
import { present } from "./support/assertions.ts";

// The private area of "rides near me" (#343): the grid, who may write which
// source, the term of a phone's area, versions, the kill switch and what the
// row never holds.

const db = await testDatabase();
after(() => db.close());

const person = async (label: string) => (await labelledUser(db, label)).id;
const at = (hours: number, from = new Date()) =>
  new Date(from.getTime() + hours * 3600_000);
// A phone sends the cell, not the place it stands in.
const device = (lng = 37.62, lat = 55.75, radiusM = 10000) => {
  const [cellLng, cellLat] = snapToCell(lng, lat);
  return { source: "device" as const, center: [cellLng, cellLat], radiusM };
};
const manual = (overrides: object = {}) => ({
  source: "manual" as const,
  center: [37.62, 55.75],
  radiusM: 15000,
  label: "Центр",
  ...overrides,
});

test("the grid: a point lands in a cell of about 3 by 2–3 km, and only its centre is kept", () => {
  const [lng, lat] = snapToCell(37.6173, 55.7558);
  assert.ok(isCellCenter(lng, lat));
  assert.ok(Math.abs(lng - 37.6173) <= nearbyGrid.lngStep / 2 + 1e-9);
  assert.ok(Math.abs(lat - 55.7558) <= nearbyGrid.latStep / 2 + 1e-9);
  assert.deepEqual(snapToCell(lng, lat), [lng, lat], "stable");
  assert.deepEqual(snapToCell(lng + 0.01, lat - 0.01), [lng, lat]);
  assert.notDeepEqual(snapToCell(lng + 0.03, lat), [lng, lat]);
  assert.equal(isCellCenter(37.6173, 55.7558), false, "a precise point");
  assert.equal(
    isCellCenter(0, 0),
    false,
    "the origin is a corner, not a centre",
  );
  // A cell is a few kilometres: 0.03° of latitude is 3.3 km.
  assert.ok(nearbyGrid.latStep * 111 > 2 && nearbyGrid.latStep * 111 < 5);
  // Negative coordinates snap the same way.
  const [wLng, wLat] = snapToCell(-70.123, -33.456);
  assert.ok(isCellCenter(wLng, wLat));
});

test("nothing is on by default; saving an area does not turn the feature on", async () => {
  const user = await person("default");
  const none = await nearbyState(db, user);
  assert.equal(none.enabled, false);
  assert.equal(none.area, null);
  assert.equal(none.version, "none");
  assert.equal(none.available, true);
  assert.equal(none.limits.maxRadiusM, 50000);

  const saved = await saveNearbyArea(db, user, manual());
  assert.equal(saved.enabled, false, "an area is not a consent");
  assert.equal(saved.source, "manual");
  assert.equal(saved.area?.label, "Центр");
  assert.equal(saved.expiresAt, null, "a hand-picked area lasts");
  assert.notEqual(saved.version, "none");

  const on = await saveNearbySettings(db, user, { enabled: true });
  assert.equal(on.enabled, true);
  assert.equal(on.area?.radiusM, 15000, "settings leave the area alone");
  assert.equal(
    (await saveNearbySettings(db, user, { enabled: false })).enabled,
    false,
  );
});

test("a hand-picked point is snapped; a phone must send the cell itself", async () => {
  const user = await person("snap");
  const byHand = await saveNearbyArea(
    db,
    user,
    manual({ center: [37.6173, 55.7558] }),
  );
  const [lng, lat] = snapToCell(37.6173, 55.7558);
  assert.deepEqual(byHand.area?.center, [lng, lat], "only the cell is kept");
  const stored = await db.query(
    "SELECT area_lng::float8 lng,area_lat::float8 lat FROM nearby_areas WHERE user_id=$1",
    [user],
  );
  assert.deepEqual([stored.rows[0].lng, stored.rows[0].lat], [lng, lat]);

  const phone = await person("phone");
  await assert.rejects(
    () =>
      saveNearbyArea(db, phone, {
        source: "device",
        center: [37.6173, 55.7558],
        radiusM: 10000,
      }),
    (error: unknown) =>
      error instanceof NearbyError &&
      error.status === 400 &&
      /грубо/.test(error.message),
    "a precise point from a phone is refused, not rounded",
  );
  assert.equal(
    (await db.query("SELECT 1 FROM nearby_areas WHERE user_id=$1", [phone]))
      .rowCount,
    0,
    "nothing of it was kept",
  );
  await assert.rejects(
    () => saveNearbyArea(db, phone, { ...device(), label: "Дом" }),
    NearbyError,
    "a phone's area has no name",
  );
});

test("the radius is bounded by the operator and the step", async () => {
  const user = await person("radius");
  for (const radiusM of [4000, 5500, 60000, 120000])
    await assert.rejects(
      () => saveNearbyArea(db, user, manual({ radiusM })),
      (error: unknown) => error instanceof Error,
      String(radiusM),
    );
  assert.equal(
    (await saveNearbyArea(db, user, manual({ radiusM: 50000 }))).area?.radiusM,
    50000,
  );
  await db.query("UPDATE notification_limits SET nearby_max_radius_km=20");
  await assert.rejects(
    () => saveNearbyArea(db, user, manual({ radiusM: 30000 })),
    (error: unknown) =>
      error instanceof NearbyError && /до 20 км/.test(error.message),
  );
  await db.query("UPDATE notification_limits SET nearby_max_radius_km=50");
});

test("a phone's area ends on its own and nothing but the phone extends it", async () => {
  const user = await person("term");
  const start = new Date("2026-10-05T10:00:00Z");
  const saved = await saveNearbyArea(db, user, device(), { now: start });
  assert.equal(saved.source, "device");
  assert.equal(saved.expiresAt?.toISOString(), at(24, start).toISOString());
  assert.equal(saved.observedAt?.toISOString(), start.toISOString());
  assert.equal(saved.area?.label, null);

  assert.equal((await nearbyState(db, user, at(23, start))).expired, false);
  const late = await nearbyState(db, user, at(25, start));
  assert.equal(late.expired, true, "after the term it is not used");

  // Reading it, changing the settings, or being pushed to does not renew it.
  await saveNearbySettings(
    db,
    user,
    { enabled: true, horizonDays: 7 },
    {
      now: at(20, start),
    },
  );
  assert.equal(
    (await nearbyState(db, user, at(21, start))).expiresAt?.toISOString(),
    at(24, start).toISOString(),
  );

  assert.equal(await pruneNearbyAreas(db, at(30, start)), 1);
  const pruned = await nearbyState(db, user, at(30, start));
  assert.equal(pruned.area, null, "the place is gone");
  assert.equal(pruned.source, null);
  assert.equal(pruned.enabled, true, "the person's switch and choices stay");
  assert.equal(pruned.horizonDays, 7);
  assert.equal(await pruneNearbyAreas(db, at(31, start)), 0);

  // The operator's term applies to the next confirmation.
  await db.query("UPDATE notification_limits SET nearby_device_ttl_hours=2");
  const short = await saveNearbyArea(db, user, device(), { now: start });
  assert.equal(short.expiresAt?.toISOString(), at(2, start).toISOString());
  await db.query("UPDATE notification_limits SET nearby_device_ttl_hours=24");
});

test("two sources do not overwrite each other behind the owner's back", async () => {
  const user = await person("sources");
  await saveNearbyArea(db, user, manual());
  await assert.rejects(
    () => saveNearbyArea(db, user, device()),
    (error: unknown) =>
      error instanceof NearbyError &&
      error.status === 409 &&
      /вручную/.test(error.message),
  );
  assert.equal((await nearbyState(db, user)).source, "manual");
  const replaced = await saveNearbyArea(db, user, {
    ...device(),
    replaceSource: true,
  });
  assert.equal(replaced.source, "device");
  assert.ok(replaced.expiresAt);
  await assert.rejects(
    () => saveNearbyArea(db, user, manual()),
    (error: unknown) => error instanceof NearbyError && error.status === 409,
  );
  const back = await saveNearbyArea(db, user, {
    ...manual({ label: "Парк" }),
    replaceSource: true,
  });
  assert.equal(back.source, "manual");
  assert.equal(back.expiresAt, null, "the term goes with the phone's area");
  // The same source updates freely.
  assert.equal(
    (await saveNearbyArea(db, user, manual({ label: "Район" }))).area?.label,
    "Район",
  );
});

test("a change is made on the version that was read", async () => {
  const user = await person("versions");
  const first = await saveNearbyArea(db, user, manual());
  const check = (seen: string) => (version: string) => {
    if (version !== seen) throw new NearbyError("stale", 412);
  };
  await assert.rejects(
    () =>
      saveNearbyArea(db, user, manual({ radiusM: 20000 }), {
        precondition: check("none"),
      }),
    /stale/,
  );
  assert.equal((await nearbyState(db, user)).area?.radiusM, 15000);
  const second = await saveNearbyArea(db, user, manual({ radiusM: 20000 }), {
    precondition: check(first.version),
  });
  assert.notEqual(second.version, first.version);
  await assert.rejects(
    () =>
      saveNearbySettings(
        db,
        user,
        { enabled: true },
        {
          precondition: check(first.version),
        },
      ),
    /stale/,
  );
  await assert.rejects(
    () => removeNearbyArea(db, user, { precondition: check(first.version) }),
    /stale/,
  );
  assert.ok((await nearbyState(db, user)).area, "nothing was removed");
});

test("settings: the horizon, the preferences, and what is refused", async () => {
  const user = await person("settings");
  const saved = await saveNearbySettings(db, user, {
    horizonDays: 3,
    filters: { purposes: ["social", "training"], paces: ["relaxed"] },
  });
  assert.equal(saved.horizonDays, 3);
  assert.deepEqual(saved.filters, {
    purposes: ["social", "training"],
    paces: ["relaxed"],
    surfaces: [],
  });
  const partial = await saveNearbySettings(db, user, {
    filters: { surfaces: ["gravel"] },
  });
  assert.deepEqual(partial.filters.purposes, ["social", "training"]);
  assert.deepEqual(partial.filters.surfaces, ["gravel"]);
  for (const bad of [
    {},
    { horizonDays: 0 },
    { horizonDays: 31 },
    { filters: { purposes: ["nope"] } },
    { filters: { paces: ["relaxed", "relaxed"] } },
    { userId: user },
  ])
    await assert.rejects(
      () => saveNearbySettings(db, user, bad),
      (error: unknown) => error instanceof Error,
      JSON.stringify(bad),
    );
});

test("the operator's switch: nothing is saved or turned on, turning off still works", async () => {
  const user = await person("switch");
  await saveNearbyArea(db, user, manual());
  await saveNearbySettings(db, user, { enabled: true });
  await db.query("UPDATE notification_limits SET nearby_enabled=false");
  try {
    const state = await nearbyState(db, user);
    assert.equal(state.available, false);
    await assert.rejects(
      () => saveNearbyArea(db, user, manual({ radiusM: 20000 })),
      (error: unknown) => error instanceof NearbyError && error.status === 503,
    );
    await assert.rejects(
      () => saveNearbySettings(db, user, { enabled: true }),
      (error: unknown) => error instanceof NearbyError && error.status === 503,
    );
    assert.equal(
      (await saveNearbySettings(db, user, { enabled: false })).enabled,
      false,
      "a person can always switch it off",
    );
    assert.equal((await removeNearbyArea(db, user)).area, null);
  } finally {
    await db.query("UPDATE notification_limits SET nearby_enabled=true");
  }
});

test("removing the area, forgetting everything, and the account going away", async () => {
  const user = await person("forget");
  await saveNearbyArea(db, user, manual());
  await saveNearbySettings(db, user, { enabled: true, horizonDays: 5 });
  const removed = await removeNearbyArea(db, user);
  assert.equal(removed.area, null);
  assert.equal(removed.enabled, true, "the switch is the person's");
  assert.equal(removed.horizonDays, 5);
  assert.equal(
    (await removeNearbyArea(db, user)).area,
    null,
    "a repeat is fine",
  );
  await saveNearbyArea(db, user, device());
  await forgetNearby(db, user);
  assert.equal(
    (await db.query("SELECT 1 FROM nearby_areas WHERE user_id=$1", [user]))
      .rowCount,
    0,
    "all of it",
  );
  await forgetNearby(db, user);
  assert.equal((await nearbyState(db, user)).version, "none");

  const leaving = await person("leaving");
  await saveNearbyArea(db, leaving, manual());
  await db.query("DELETE FROM users WHERE id=$1", [leaving]);
  assert.equal(
    (await db.query("SELECT 1 FROM nearby_areas WHERE user_id=$1", [leaving]))
      .rowCount,
    0,
    "the area goes with the account",
  );
});

test("a blocked account cannot keep or change an area", async () => {
  const user = await person("blocked-nearby");
  await saveNearbyArea(db, user, manual());
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [user]);
  await assert.rejects(
    () => saveNearbyArea(db, user, manual({ radiusM: 20000 })),
    (error: unknown) => error instanceof NearbyError && error.status === 401,
  );
});

test("the row holds a cell, a radius and times: no history, no raw point", async () => {
  const user = await person("shape");
  await saveNearbyArea(db, user, manual({ center: [37.6173, 55.7558] }));
  await saveNearbyArea(db, user, {
    ...device(30.3141, 59.9386),
    replaceSource: true,
  });
  const columns = await db.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name='nearby_areas' ORDER BY ordinal_position",
  );
  assert.deepEqual(
    columns.rows.map((c) => c.column_name),
    [
      "user_id",
      "enabled",
      "source",
      "label",
      "area_lng",
      "area_lat",
      "radius_m",
      "observed_at",
      "expires_at",
      "horizon_days",
      "filters",
      "created_at",
      "updated_at",
    ],
  );
  const rows = await db.query("SELECT * FROM nearby_areas WHERE user_id=$1", [
    user,
  ]);
  assert.equal(rows.rowCount, 1, "one row, the last area only");
  const row = present(rows.rows[0], "row");
  assert.ok(isCellCenter(Number(row.area_lng), Number(row.area_lat)));
  assert.ok(!JSON.stringify(row).includes("37.6173"), "the first area is gone");
});

test("the account export carries the area as it is kept, and nothing the account did not give", async () => {
  const user = await person("export");
  const none = await exportAccount(db, user, "https://test.invalid");
  assert.deepEqual(none.nearby.area, null);
  assert.equal(none.nearby.enabled, false);
  await saveNearbyArea(db, user, manual({ center: [37.6173, 55.7558] }));
  await saveNearbySettings(db, user, { enabled: true, horizonDays: 9 });
  const exported = await exportAccount(db, user, "https://test.invalid");
  const [lng, lat] = snapToCell(37.6173, 55.7558);
  assert.deepEqual(exported.nearby.area, {
    label: "Центр",
    center: [lng, lat],
    radiusM: 15000,
  });
  assert.equal(exported.nearby.enabled, true);
  assert.equal(exported.nearby.horizonDays, 9);
  assert.ok(
    !JSON.stringify(exported.nearby).includes("37.6173"),
    "the point that was named is not in it",
  );
  await forgetNearby(db, user);
  assert.equal(
    (await exportAccount(db, user, "https://test.invalid")).nearby.area,
    null,
  );
});
