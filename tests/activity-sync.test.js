import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import {
  sealActivityToken,
  openActivityToken,
} from "../lib/activity-credentials.js";
import { rwgpsConfig, verifyRwgpsWebhook, rwgpsRequest } from "../lib/rwgps.js";
import {
  beginActivityOAuth,
  finishActivityOAuth,
  receiveActivityNotifications,
  requestActivitySync,
  disconnectActivity,
  activityStatus,
  chooseActivityBike,
  twelveMonthsAgo,
} from "../lib/activity-sync.js";
import {
  runActivityBatch,
  processActivityJob,
} from "../lib/activity-worker.js";
import {
  rideDetail,
  saveRide,
  rideDefaults,
  deleteRide,
} from "../lib/rides.js";
import { getOriginal } from "../lib/ride-storage.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { fit, loop } from "./ride-fixtures.js";

const env = {
  RWGPS_ENABLED: "true",
  RWGPS_API_KEY: "fixture-api",
  RWGPS_CLIENT_ID: "fixture-client",
  RWGPS_CLIENT_SECRET: "fixture-secret",
  ACTIVITY_TOKEN_KEY: "12".repeat(32),
  APP_ORIGIN: "http://localhost:3100",
};
const notified = (id = 1, action = "created", user = 71) => ({
  user_id: user,
  item_user_id: user,
  item_type: "trip",
  item_id: id,
  action,
});
const item = (id = 1, action = "created", user = 71) => ({
  ...notified(id, action, user),
  datetime: new Date().toISOString(),
});
const trip = (id = 1) => ({
  id,
  user_id: 71,
  name: "RWGPS ride " + id,
  activity_type: "cycling:road",
  stationary: false,
  departed_at: new Date(Date.now() - 86400000).toISOString(),
  distance: 1000,
  duration: 2400,
  moving_time: 2300,
  avg_hr: 123,
  avg_watts: 187,
});

test("OAuth credentials, signature, dates and deterministic bike assignment", async () => {
  const sealed = sealActivityToken("private-token", "rwgps:a", env);
  assert.ok(!sealed.includes("private-token"));
  assert.equal(openActivityToken(sealed, "rwgps:a", env), "private-token");
  assert.throws(() => openActivityToken(sealed, "rwgps:b", env));
  assert.throws(() =>
    openActivityToken(sealed.slice(0, -3) + "abc", "rwgps:a", env),
  );
  const config = rwgpsConfig(env),
    bytes = Buffer.from(JSON.stringify({ notifications: [notified()] }));
  const signature = createHmac("sha256", env.RWGPS_CLIENT_SECRET)
    .update(bytes)
    .digest("hex");
  assert.equal(
    verifyRwgpsWebhook(bytes, signature, env.RWGPS_API_KEY, config).length,
    1,
  );
  assert.throws(() =>
    verifyRwgpsWebhook(
      Buffer.concat([bytes, Buffer.from(" ")]),
      signature,
      env.RWGPS_API_KEY,
      config,
    ),
  );
  assert.throws(() =>
    verifyRwgpsWebhook(bytes, "invalid", env.RWGPS_API_KEY, config),
  );
  assert.throws(() =>
    verifyRwgpsWebhook(bytes, signature, "other-client", config),
  );
  assert.equal(
    twelveMonthsAgo(new Date("2024-02-29T12:00:00Z")),
    "2023-02-28T12:00:00.000Z",
  );
  const bikes = [
    { id: "a", category: "road" },
    { id: "b", category: "mtb" },
    { id: "c", category: "road", is_former: true },
  ];
  assert.equal(chooseActivityBike(bikes, "cycling:road"), "a");
  assert.equal(chooseActivityBike(bikes, "cycling:generic"), null);
  assert.equal(chooseActivityBike(bikes, "cycling:road", "c"), null);
  assert.equal(
    chooseActivityBike([{ id: "a" }, { id: "b" }], "cycling:generic", "b"),
    "b",
  );
});

test("RWGPS durable lifecycle: OAuth, FIT, updates, duplicates, failures, deletion, disconnect", async () => {
  const before = { ...process.env },
    originalFetch = globalThis.fetch;
  Object.assign(process.env, env);
  const directory = await mkdtemp(tmpdir() + "/cola-activity-");
  process.env.RIDES_DIR = directory;
  const db = new PGlite();
  const tx = (fn) => db.transaction(fn);
  let items = [],
    trips = new Map([[1, trip()]]),
    failed = new Set(),
    revoked = 0,
    downloads = 0,
    apiCalls = 0;
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, "https://ridewithgps.com");
    assert.equal(options.redirect, "error");
    apiCalls++;
    if (u.pathname === "/oauth/token.json")
      return Response.json({
        access_token: "private-token",
        token_type: "Bearer",
        user_id: 71,
      });
    if (u.pathname === "/oauth/revoke.json") {
      revoked++;
      return Response.json({});
    }
    assert.equal(options.headers.Authorization, "Bearer private-token");
    if (u.pathname === "/api/v1/sync.json") {
      assert.equal(u.searchParams.get("assets"), "trips");
      return Response.json({
        items,
        meta: { rwgps_datetime: new Date().toISOString() },
      });
    }
    const m = /\/trips\/(\d+)\.(json|fit|tcx)$/.exec(u.pathname);
    assert.ok(m, u.pathname);
    if (failed.has(Number(m[1]))) return new Response("", { status: 500 });
    if (m[2] === "json")
      return Response.json({ trip: trips.get(Number(m[1])) });
    downloads++;
    return new Response(
      fit(loop.map((p) => [p[0] + Number(m[1]) / 100, p[1], p[2], p[3]])),
    );
  };
  try {
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const owner = randomUUID(),
      other = randomUUID(),
      bike = randomUUID();
    for (const id of [owner, other])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Rider','hash',$2)",
        [id, "r" + id.slice(0, 8)],
      );
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Road',2026,'road',true)",
      [bike, owner],
    );
    const start = await tx((q) =>
        beginActivityOAuth(q, owner, "session", null),
      ),
      state = new URL(start.url).searchParams.get("state");
    await assert.rejects(
      tx((q) => finishActivityOAuth(q, owner, "wrong-session", state, "code")),
      /истекло/,
    );
    await assert.rejects(
      tx((q) => finishActivityOAuth(q, other, "session", state, "code")),
      /истекло/,
    );
    items = [item()];
    assert.deepEqual(
      await tx((q) => finishActivityOAuth(q, owner, "session", state, "code")),
      { connected: true },
    );
    await assert.rejects(
      tx((q) => finishActivityOAuth(q, owner, "session", state, "code")),
      /истекло/,
    );
    const connection = (await db.query("SELECT * FROM activity_connections"))
      .rows[0];
    assert.ok(
      !JSON.stringify(await activityStatus(db, owner)).includes(
        "private-token",
      ),
    );
    assert.ok(!connection.credentials.includes("private-token"));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    let ride = (await db.query("SELECT * FROM rides")).rows[0];
    assert.ok(ride);
    assert.equal(ride.source_kind, "external");
    assert.equal(ride.is_public, false);
    assert.equal(ride.bike_id, bike);
    assert.equal(ride.has_track, true);
    assert.equal(ride.import_metrics.avgHr, 110);
    assert.ok((await getOriginal(ride.track_file_id)).length);
    assert.equal((await activityStatus(db, owner)).counts.synced, 1);
    const countBefore = apiCalls;
    await receiveActivityNotifications(db, [
      { ...notified(), item_type: "route" },
      notified(1, "added"),
      { ...notified(), item_user_id: 99 },
    ]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM activity_jobs")).rows[0].n,
      0,
    );
    assert.equal(apiCalls, countBefore);
    await receiveActivityNotifications(db, [notified(), notified()]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM activity_jobs")).rows[0].n,
      1,
    );
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM rides")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query("SELECT count FROM rate_limits WHERE key=$1", [
          "ride-upload:" + owner,
        ])
      ).rows[0].count,
      1,
      "Duplicate snapshots do not consume the import budget",
    );
    // Reconnect may move the backfill boundary forward; it must not delete an
    // existing ride when receiving an update to that older history.
    await db.query(
      "UPDATE activity_connections SET import_since=now() WHERE id=$1",
      [connection.id],
    );
    await tx((q) => requestActivitySync(q, owner, undefined));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM rides WHERE owner_id=$1", [
          owner,
        ])
      ).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE activity_connections SET import_since=now()-interval '12 months' WHERE id=$1",
      [connection.id],
    );
    // User's title, chosen sensors and clipped geometry survive an upstream update.
    await tx((q) =>
      saveRide(
        q,
        owner,
        {
          bikeId: bike,
          title: "My title",
          description: "Mine",
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
          visibleMetrics: ["distanceM"],
        },
        rideDefaults,
        ride.id,
      ),
    );
    trips.set(1, { ...trip(), name: "Renamed at source" });
    items = [item(1, "updated")];
    await tx((q) => requestActivitySync(q, owner, undefined));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    ride = (await db.query("SELECT * FROM rides")).rows[0];
    assert.equal(ride.title, "My title");
    assert.equal(ride.privacy_enabled, true);
    assert.deepEqual(ride.visible_metrics, ["distanceM"]);
    assert.equal(ride.description, "Mine");
    const publicRide = await rideDetail(db, ride.share_id, null);
    assert.ok(!JSON.stringify(publicRide).includes("private-token"));
    assert.ok(!("external_id" in publicRide));
    // One upstream failure leaves the next trip importable; non-bike trips are ignored.
    trips.set(2, { ...trip(2), activity_type: "running:generic" });
    trips.set(3, trip(3));
    trips.set(4, trip(4));
    failed.add(3);
    items = [item(2), item(3), item(4)];
    await tx((q) => requestActivitySync(q, owner, undefined));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal((await activityStatus(db, owner)).counts.ignored, 1);
    assert.equal((await activityStatus(db, owner)).counts.error, 1);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM rides")).rows[0].n,
      2,
    );
    failed.clear();
    items = [];
    await tx((q) => requestActivitySync(q, owner, undefined));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM rides")).rows[0].n,
      3,
    );
    // Remote deletion removes only its linked ride; replay must not resurrect it.
    items = [item(1, "deleted")];
    await receiveActivityNotifications(db, [notified(1, "deleted")]);
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal(
      (await db.query("SELECT 1 FROM rides WHERE id=$1", [ride.id])).rows
        .length,
      0,
    );
    items = [item(1, "updated")];
    await receiveActivityNotifications(db, [notified(1, "updated")]);
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal(
      (
        await db.query(
          "SELECT status FROM external_activities WHERE external_id='1'",
        )
      ).rows[0].status,
      "deleted",
    );
    const remaining = (await db.query("SELECT * FROM rides LIMIT 1")).rows[0];
    await tx((q) => deleteRide(q, owner, remaining.id));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM external_activities WHERE status='local_deleted'",
        )
      ).rows[0].n,
      1,
    );
    // Disconnect while a worker is fetching fences the stale result.
    items = [item(5)];
    trips.set(5, trip(5));
    await tx((q) => requestActivitySync(q, owner, undefined));
    await runActivityBatch(db, tx);
    const job = (
      await db.query("SELECT * FROM activity_jobs WHERE external_id='5'")
    ).rows[0];
    const vendorFetch = globalThis.fetch;
    let fetchedResolve, release;
    const fetched = new Promise((r) => {
      fetchedResolve = r;
    });
    const gate = new Promise((r) => {
      release = r;
    });
    globalThis.fetch = async (...args) => {
      const result = await vendorFetch(...args);
      if (String(args[0]).endsWith("/5.json")) {
        fetchedResolve();
        await gate;
      }
      return result;
    };
    const processing = processActivityJob(db, tx, job);
    await fetched;
    await tx((q) => disconnectActivity(q, owner));
    release();
    await processing;
    assert.equal((await activityStatus(db, owner)).connected, false);
    await assert.rejects(
      tx((q) => beginActivityOAuth(q, owner, "session", null)),
      /Отзыв предыдущего/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT ride_id FROM external_activities WHERE external_id='5'",
        )
      ).rows[0].ride_id,
      null,
    );
    await runActivityBatch(db, tx);
    assert.equal(revoked, 1);
    assert.equal(
      (await db.query("SELECT * FROM activity_revocations")).rows.length,
      0,
    );
    globalThis.fetch = vendorFetch;
    // New connection: missing/ambiguous bikes wait; stationary cycling still imports.
    const secondBike = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category) VALUES($1,$2,$1,'Other road',2026,'road')",
      [secondBike, owner],
    );
    const again = await tx((q) =>
      beginActivityOAuth(q, owner, "session", null),
    );
    const againState = new URL(again.url).searchParams.get("state");
    items = [item(6), item(7), item(8)];
    trips.set(6, {
      ...trip(6),
      activity_type: "cycling:indoor",
      stationary: true,
    });
    trips.set(7, { ...trip(7), departed_at: "2020-01-01T00:00:00Z" });
    trips.set(8, trip(8));
    await tx((q) =>
      finishActivityOAuth(q, owner, "session", againState, "code"),
    );
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    assert.equal((await activityStatus(db, owner)).counts.waiting_bike, 2);
    assert.equal(
      (
        await db.query(
          "SELECT status FROM external_activities WHERE external_id='7'",
        )
      ).rows[0].status,
      "ignored",
    );
    items = [];
    await tx((q) => requestActivitySync(q, owner, bike));
    await runActivityBatch(db, tx);
    await runActivityBatch(db, tx);
    const indoor = (
      await db.query(
        "SELECT r.* FROM rides r JOIN external_activities a ON a.ride_id=r.id WHERE a.external_id='6'",
      )
    ).rows[0];
    assert.equal(indoor.has_track, false);
    assert.equal(indoor.distance_m, 1000);
    assert.equal(indoor.import_metrics.avgHr, 123);
    assert.equal(indoor.is_public, false);
    // Account deletion retains only a revocation job; no connection or import survives.
    await db.query("DELETE FROM users WHERE id=$1", [owner]);
    assert.equal(
      (await db.query("SELECT * FROM activity_connections")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM activity_revocations")).rows.length,
      1,
    );
    await runActivityBatch(db, tx);
    assert.equal(revoked, 2);
    assert.ok(downloads > 0);
    // Transport limits and URL confinement remain enforced independently of payload validation.
    await assert.rejects(
      rwgpsRequest("//evil.test/api", { token: "private-token" }),
    );
    globalThis.fetch = async () => new Response("x".repeat(50));
    await assert.rejects(
      rwgpsRequest("/api/v1/trips/1.fit", { binary: true, limit: 20 }),
      /полный ответ/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
    await rm(directory, { recursive: true, force: true });
    for (const key of Object.keys(env).concat("RIDES_DIR")) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
