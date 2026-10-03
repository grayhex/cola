import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  ridePassportInput,
  plannedDetails,
  plannedEnd,
} from "../lib/ride-plan.ts";
import {
  planInput,
  rideInput,
  planRide,
  rideDefaults,
  rideDetail,
  rideList,
  saveRide,
  respondRide,
  attachRideTrack,
} from "../lib/rides.ts";
import { loadSocialPreview, loadSocialCard } from "../lib/social-preview.ts";
import { gpx, loop } from "./ride-fixtures.js";
import { migrateOnly, testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import { userRow } from "./support/people.ts";
import { ownerFields } from "./support/rides.ts";

test("shared passport validates units, unknowns, coarse areas and total duration", () => {
  assert.deepEqual(ridePassportInput.parse({}), {});
  for (const invalid of [
    { unknown: true },
    { pace: "fast" },
    { difficulty: "relaxed" },
    { distanceKm: { min: 30, max: 20 } },
    { durationMinutes: { min: 0, max: 30 } },
    { durationMinutes: { min: 0.5, max: 30 } },
    { groupSize: { min: 1, max: 101 } },
    { speedKmh: { min: 1, max: 61 } },
    { beginnerFriendly: "true" },
    { area: { label: "Park", center: [37, 55] } },
    { area: { label: "Park", radiusM: 1000 } },
    { area: { label: "Park", center: [181, 55], radiusM: 1000 } },
    { area: { label: "Park", center: [37, 55], radiusM: 10 } },
    { area: { label: "Park", address: "exact address" } },
  ])
    assert.equal(
      ridePassportInput.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  assert.deepEqual(ridePassportInput.parse({ area: { label: " Park " } }), {
    area: { label: "Park" },
  });
  assert.deepEqual(
    present(
      ridePassportInput.parse({
        area: { label: "Park", center: [37.123456, 55.765432], radiusM: 1500 },
      }).area,
    ).center,
    [37.12, 55.77],
  );
  const input = {
    scheduledAt: "2031-03-29T09:00:00Z",
    expectedEndAt: "2031-03-29T11:00:00Z",
    passport: { durationMinutes: { min: 90, max: 150 } },
  };
  assert.equal(plannedDetails(input).meetingVisibility, "participants");
  for (const end of [
    "2031-03-29T08:00:00Z",
    "2031-03-29T13:00:00Z",
    "2031-04-06T09:00:00Z",
  ])
    assert.throws(() => plannedDetails({ ...input, expectedEndAt: end }));
  assert.equal(
    plannedEnd({
      started_at: input.scheduledAt,
      plan_ends_at: input.expectedEndAt,
      occurs_at: "2031-04-05T08:00:00Z",
    }),
    "2031-04-05T10:00:00.000Z",
  );
  assert.equal(rideInput.safeParse({ passport: {} }).success, false);
});

test("migration preserves legacy visibility; meeting access follows this occurrence, bike and active membership", async () => {
  const db = await testDatabase({ migrated: false }),
    dir = await mkdtemp(tmpdir() + "/cola-passport-"),
    before = process.env.RIDES_DIR;
  process.env.RIDES_DIR = dir;
  try {
    await migrateOnly(db, (f) => f < "036");
    const owner = (await userRow(db, { username: "passport0" })).id,
      reader = (await userRow(db, { username: "passport1" })).id,
      bike = (await bikeRow(db, owner, { name: "Bike" })).id,
      legacy = randomUUID();
    // A ride of the schema before 036 has no passport: raw SQL on purpose.
    await db.query(
      "INSERT INTO rides(id,owner_id,bike_id,share_id,title,source_hash,status,source_kind,has_track,meeting_point,started_at,is_public,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m) VALUES($1,$2,$3,$1,'Legacy','legacy','planned','planned',false,'Old public meeting','2031-03-29T09:00:00Z',true,0,0,0,'[]',500)",
      [legacy, owner, bike],
    );
    await migrateOnly(db, (f) => f === "036_ride_passport.sql");
    // The code below needs the current schema, not the one right after 036;
    // later migrations keep the legacy visibility too.
    await migrateOnly(db, (f) => f > "036_ride_passport.sql");
    const old = await rideDetail(db, legacy, null);
    assert.equal(old.meetingPoint, "Old public meeting");
    assert.deepEqual(old.passport, {});
    assert.equal(old.meetingVisibility, "public");
    const tx = db.transaction;
    const input = planInput.parse({
      bikeId: bike,
      title: "Morning loop",
      description: "Public description",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: "2031-03-29T09:00:00Z",
      expectedEndAt: "2031-03-29T11:00:00Z",
      recurrence: "weekly",
      recurrenceTimezone: "Europe/Berlin",
      meetingPoint: "PRIVATE MEETING",
      passport: {
        area: { label: "Park", center: [37.123456, 55.765432], radiusM: 2000 },
        pace: "relaxed",
        beginnerFriendly: false,
      },
    });
    const meeting = present(input.meetingPoint);
    const plan = await tx((q) => planRide(q, owner, input, rideDefaults));
    const detail = (viewer: string | null = null) =>
      rideDetail(db, plan.shareId, viewer);
    assert.equal((await detail()).meetingPoint, "");
    assert.equal((await detail(reader)).meetingHidden, true);
    assert.equal((await detail(owner)).meetingPoint, input.meetingPoint);
    assert.equal(
      ownerFields.parse(await rideDetail(db, plan.shareId, owner, true))
        .privacyEnabled,
      true,
    );
    assert.deepEqual(
      present((await detail()).passport?.area).center,
      [37.12, 55.77],
    );
    await db.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
      [plan.id, reader],
    );
    assert.equal((await detail(reader)).meetingPoint, "");
    for (const response of [
      "accepted",
      "declined",
      "maybe",
      "accepted",
    ] as const) {
      await tx((q) =>
        respondRide(q, plan.id, reader, response, input.scheduledAt),
      );
      const expected = response === "accepted" ? input.meetingPoint : "";
      assert.equal((await detail(reader)).meetingPoint, expected);
      assert.equal(
        present(
          (await rideList(db, reader)).rides.find((r) => r.id === plan.id),
        ).meetingPoint,
        expected,
      );
    }
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [reader]);
    assert.equal((await detail(reader)).meetingPoint, "");
    await assert.rejects(
      tx((q) => respondRide(q, plan.id, reader, "accepted", input.scheduledAt)),
      { status: 404 },
    );
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [reader]);
    await tx((q) =>
      attachRideTrack(q, owner, plan.id, gpx([loop]), rideDefaults),
    );
    const publicDetail = await detail();
    assert(publicDetail.geometry.flat().length > 0);
    assert(
      !publicDetail.geometry
        .flat()
        .some((p) => p[0] === loop[0][0] && p[1] === loop[0][1]),
    );
    assert.equal(publicDetail.analysis, null);
    const preview = await loadSocialPreview(db, "ride", plan.shareId);
    const card = present(await loadSocialCard(db, present(preview)));
    assert.deepEqual(card.geometry, publicDetail.geometry);
    assert(!JSON.stringify({ preview, card, publicDetail }).includes(meeting));
    await db.query(
      "UPDATE rides SET started_at=started_at-interval '7 days',plan_ends_at=plan_ends_at-interval '7 days' WHERE id=$1",
      [plan.id],
    );
    assert.equal((await detail(reader)).meetingPoint, "");
    await assert.rejects(
      tx((q) => respondRide(q, plan.id, reader, "accepted", input.scheduledAt)),
      { status: 409 },
    );
    // Omitted fields on an older client's PATCH preserve the passport and access policy.
    const edit = {
      bikeId: bike,
      title: "Edited",
      description: "",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
    };
    await tx((q) => saveRide(q, owner, edit, rideDefaults, plan.id));
    assert.equal(present((await detail()).passport).pace, "relaxed");
    assert.equal((await detail()).meetingPoint, "");
    await tx((q) =>
      saveRide(
        q,
        owner,
        { ...edit, meetingVisibility: "public" },
        rideDefaults,
        plan.id,
      ),
    );
    assert.equal((await detail()).meetingPoint, input.meetingPoint);
    await tx((q) =>
      saveRide(
        q,
        owner,
        { ...edit, meetingVisibility: "participants" },
        rideDefaults,
        plan.id,
      ),
    );
    assert.equal((await detail()).meetingPoint, "");
    assert(
      !JSON.stringify((await detail()).geometry).includes(
        JSON.stringify(loop[0].slice(0, 2)),
      ),
    );
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    await assert.rejects(detail(), { status: 404 });
    assert.equal(await loadSocialPreview(db, "ride", plan.shareId), null);
    // Invitation grants existing private-plan access, but not the exact meeting.
    assert.equal((await detail(reader)).meetingPoint, "");
    await db.query("DELETE FROM ride_invitations WHERE ride_id=$1", [plan.id]);
    await assert.rejects(detail(reader), { status: 404 });
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    await assert.rejects(detail(), { status: 404 });
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [owner]);
    await db.query(
      "UPDATE rides SET status='completed',source_kind='gpx' WHERE id=$1",
      [legacy],
    );
    await assert.rejects(
      tx((q) =>
        saveRide(q, owner, { ...edit, passport: {} }, rideDefaults, legacy),
      ),
      /только плановой/,
    );
    assert(!("passport" in (await rideDetail(db, legacy, null))));
  } finally {
    if (before === undefined) delete process.env.RIDES_DIR;
    else process.env.RIDES_DIR = before;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
