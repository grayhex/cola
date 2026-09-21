import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { parseGarminCsv, assertMatchingTrack } from "../lib/garmin-csv.js";
import { prepareSvg } from "../lib/svg-asset.js";
import { parseGpx } from "../lib/ride-gpx.js";
import {
  previewRide,
  importGarmin,
  rideDefaults,
  rideList,
  rideDetail,
  saveRide,
  planRide,
  attachRideTrack,
  respondRideInvitation,
  cancelPlannedRide,
  bikeRideStats,
} from "../lib/rides.js";
import {
  saveListing,
  marketList,
  marketDetail,
  saveMarketPhoto,
  marketPhoto,
  deleteListing,
  cleanupMarketPhotos,
} from "../lib/market.js";
import { notificationPage } from "../lib/notifications.js";
import { communityActivity } from "../lib/discovery.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { garminCsv } from "./garmin-fixtures.js";
import { gpx, loop } from "./ride-fixtures.js";

test("Garmin parses quoted CSV, timezone, thousands, negatives, missing data and all sample columns", () => {
  const p = parseGarminCsv("\uFEFF" + garminCsv({ "Avg HR": "--" }));
  assert.equal(p.rides.length, 1);
  const r = p.rides[0];
  assert.equal(r.title, 'Test, "Gravel"');
  assert.equal(r.startedAt, "2026-09-16T00:00:00.000Z");
  assert.equal(r.metrics.distanceM, 10000);
  assert.equal(r.metrics.maxPower, 1234);
  assert.equal(r.metrics.bodyBattery, -8);
  assert.equal(r.metrics.movingTimeS, 3300);
  assert.equal(r.metrics.avgHr, undefined);
  assert.equal(p.availableFields.length, 29);
  assert.equal(
    parseGarminCsv(garminCsv(), { utcOffsetMinutes: 0, units: "imperial" })
      .rides[0].metrics.distanceM,
    16093,
  );
  assert.throws(
    () => parseGarminCsv(garminCsv({ Date: "2026-02-30 03:00:00" })),
    /дата/,
  );
  assert.throws(() => parseGarminCsv(garminCsv({ Distance: "NaN" })), /число/);
  assert.throws(() => parseGarminCsv(garminCsv({ Time: "01:70:00" })), /время/);
  assert.throws(() => parseGarminCsv("Date,Distance\n2026,100"), /столбца/);
  assert.throws(() => parseGarminCsv(garminCsv() + '"unterminated'), /кавычки/);
  assert.throws(
    () => parseGarminCsv(garminCsv({ "Activity Type": "Running" })),
    /велосипедных/,
  );
  const ride = {
    started_at: r.startedAt,
    distance_m: 10000,
    elapsed_time_s: 3600,
  };
  assert.doesNotThrow(() =>
    assertMatchingTrack(ride, {
      startedAt: r.startedAt,
      distanceM: 10100,
      elapsedTimeS: 3590,
    }),
  );
  for (const m of [
    { startedAt: null, distanceM: 10000, elapsedTimeS: 3600 },
    { startedAt: "2026-09-17T00:00:00Z", distanceM: 10000, elapsedTimeS: 3600 },
    { startedAt: r.startedAt, distanceM: 20000, elapsedTimeS: 3600 },
    { startedAt: r.startedAt, distanceM: 10000, elapsedTimeS: 7200 },
  ])
    assert.throws(() => assertMatchingTrack(ride, m));
});
test("animated SVG keeps local CSS and SMIL and rejects active or external content", () => {
  const safe =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><style>@keyframes spin{to{transform:rotate(360deg)}}.wheel{animation:spin 3s linear infinite}</style><circle class="wheel" cx="40" cy="40" r="20"><animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite"/></circle></svg>';
  assert.equal(prepareSvg(Buffer.from(safe)).toString(), safe);
  for (const child of [
    "<script>alert(1)</script>",
    "<foreignObject/>",
    '<use href="https://example.test/a.svg"/>',
    '<circle onload="alert(1)"/>',
    '<style>@import "x";</style>',
    '<animate attributeName="href" values="javascript:alert(1)"/>',
    "<style>path{fill:url(https://example.test/x)}</style>",
  ])
    assert.throws(() => prepareSvg(Buffer.from("<svg>" + child + "</svg>")));
});
test("Garmin lifecycle, safe GPX binding, planned invitations and market publication keep access boundaries", async () => {
  const db = new PGlite(),
    dir = await mkdtemp(path.join(tmpdir(), "cola-new-features-"));
  process.env.RIDES_DIR = path.join(dir, "rides");
  process.env.UPLOAD_DIR = path.join(dir, "photos");
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const owner = randomUUID(),
      friend = randomUUID(),
      other = randomUUID(),
      bike = randomUUID();
    for (const [id, name] of [
      [owner, "owner"],
      [friend, "friend"],
      [other, "other"],
    ])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$3)",
        [id, id + "@example.test", name],
      );
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$3,'Tourer',2026,'gravel',true)",
      [bike, owner, randomUUID()],
    );
    const bytes = gpx([loop]),
      metrics = parseGpx(bytes).metrics,
      hhmmss = (s) =>
        [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
          .map((v) => String(v).padStart(2, "0"))
          .join(":");
    const csv = garminCsv({
        Distance: (metrics.distanceM / 1000).toFixed(3),
        Time: hhmmss(metrics.elapsedTimeS),
        "Elapsed Time": hhmmss(metrics.elapsedTimeS),
      }),
      parsed = parseGarminCsv(csv);
    const input = {
      bikeId: bike,
      isPublic: true,
      selected: [0],
      visibleMetrics: ["distanceM", "avgHr", "maxPower"],
    };
    const result = await db.transaction((q) =>
        importGarmin(q, owner, input, parsed, rideDefaults),
      ),
      ride = result.imported[0];
    assert.equal(result.imported.length, 1);
    assert.equal(
      (
        await db.transaction((q) =>
          importGarmin(q, owner, input, parsed, rideDefaults),
        )
      ).skipped,
      1,
    );
    await assert.rejects(
      () =>
        db.transaction((q) =>
          importGarmin(q, friend, input, parsed, rideDefaults),
        ),
      /свой велосипед/,
    );
    const publicRide = await rideDetail(db, ride.shareId, friend);
    assert.equal(publicRide.hasTrack, false);
    assert.deepEqual(publicRide.geometry, []);
    assert.deepEqual(publicRide.visibleMetrics, input.visibleMetrics);
    await db.transaction((q) =>
      saveRide(
        q,
        owner,
        {
          bikeId: bike,
          title: "Edited import",
          description: "No track required",
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
        },
        rideDefaults,
        ride.id,
      ),
    );
    await assert.rejects(
      () =>
        db.transaction((q) =>
          attachRideTrack(q, friend, ride.id, bytes, rideDefaults),
        ),
      /недоступна/,
    );
    await assert.rejects(
      () =>
        db.transaction((q) =>
          attachRideTrack(
            q,
            owner,
            ride.id,
            gpx([loop.map((p) => [p[0], p[1], p[2] + 86400, p[3]])]),
            rideDefaults,
          ),
        ),
      /Дата/,
    );
    assert.equal(
      (await rideDetail(db, ride.shareId, owner, true)).hasTrack,
      false,
    );
    await db.transaction((q) =>
      attachRideTrack(q, owner, ride.id, bytes, rideDefaults),
    );
    const attached = await rideDetail(db, ride.shareId, owner, true);
    assert.equal(attached.hasTrack, true);
    assert(attached.geometry.length);
    assert.equal(attached.metrics.maxPower, 1234);
    await assert.rejects(
      () => db.transaction((q) => previewRide(q, owner, bytes, rideDefaults)),
      /уже загружена/,
    );
    await assert.rejects(
      () =>
        db.transaction((q) =>
          attachRideTrack(q, owner, ride.id, bytes, rideDefaults),
        ),
      /уже есть трек/,
    );
    const plan = {
      bikeId: bike,
      title: "Future gravel",
      description: "Easy pace",
      isPublic: false,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      features: ["Гравий", "Кофе"],
      meetingPoint: "Парк",
      invitations: ["friend"],
    };
    const planPreview = await db.transaction((q) =>
      previewRide(q, owner, bytes, rideDefaults, { planned: true }),
    );
    const planned = await db.transaction((q) =>
      planRide(
        q,
        owner,
        { ...plan, previewId: planPreview.previewId },
        rideDefaults,
      ),
    );
    await assert.rejects(
      () => rideDetail(db, planned.shareId, other),
      /недоступна/,
    );
    assert.equal(
      (await rideDetail(db, planned.shareId, friend)).invitation,
      "pending",
    );
    assert.equal(
      (await rideDetail(db, planned.shareId, friend)).isPublic,
      false,
    );
    assert(
      (await notificationPage(db, friend)).notifications.some(
        (n) => n.type === "ride_invite",
      ),
    );
    await db.transaction((q) =>
      respondRideInvitation(q, planned.id, friend, "accepted"),
    );
    assert.equal(
      (await rideDetail(db, planned.shareId, owner, true)).invitations[0]
        .response,
      "accepted",
    );
    assert.equal((await bikeRideStats(db, [bike], owner))[0].count, 1);
    assert.equal(
      (await rideList(db, owner, { own: true })).totalDistanceM,
      metrics.distanceM,
    );
    await db.transaction((q) =>
      saveRide(q, owner, { ...plan, isPublic: true }, rideDefaults, planned.id),
    );
    const editedPlan = (
      await db.query(
        "SELECT gpx_hash,public_speed_profile FROM rides WHERE id=$1",
        [planned.id],
      )
    ).rows[0];
    assert.equal(editedPlan.gpx_hash, null);
    assert.deepEqual(editedPlan.public_speed_profile, []);
    const activity = await communityActivity(db);
    assert(activity.content.some((i) => i.type === "planned"));
    await db.transaction((q) => cancelPlannedRide(q, planned.id, owner));
    assert(
      !(await communityActivity(db)).events.some(
        (i) => i.id === "planned:" + planned.id,
      ),
    );
    const listingInput = {
      title: "Gravel wheel",
      description: "Good condition",
      category: "components",
      condition: "used",
      price: 12500,
      currency: "RUB",
      location: "Test city",
      contact: "@owner",
      status: "draft",
    };
    const listing = await db.transaction((q) =>
      saveListing(q, owner, listingInput),
    );
    assert.equal((await marketList(db, friend)).total, 0);
    await assert.rejects(
      () => marketDetail(db, listing.shareId, friend),
      /недоступно/,
    );
    await assert.rejects(
      () =>
        db.transaction((q) =>
          saveListing(
            q,
            other,
            { ...listingInput, status: "active" },
            listing.id,
          ),
        ),
      /недоступно/,
    );
    const photo = await saveMarketPhoto(
      (fn) => db.transaction(fn),
      listing.id,
      owner,
      Buffer.from("test-photo"),
    );
    await assert.rejects(() => marketPhoto(db, photo.id, friend), /недоступно/);
    await db.transaction((q) =>
      saveListing(q, owner, { ...listingInput, status: "active" }, listing.id),
    );
    assert.equal(
      (await marketList(db, friend, { category: "components" })).total,
      1,
    );
    assert.equal(
      (await marketList(db, friend, { category: "bikes" })).total,
      0,
    );
    assert.equal(
      (await marketPhoto(db, photo.id, friend)).toString(),
      "test-photo",
    );
    assert(
      (await communityActivity(db)).content.some((i) => i.type === "market"),
    );
    await db.transaction((q) =>
      saveListing(q, owner, { ...listingInput, status: "sold" }, listing.id),
    );
    assert.equal((await marketList(db, friend)).total, 0);
    await db.transaction((q) => deleteListing(q, listing.id, owner));
    await cleanupMarketPhotos(db);
    await assert.rejects(() =>
      access(path.join(process.env.UPLOAD_DIR, "market-" + photo.id + ".webp")),
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
