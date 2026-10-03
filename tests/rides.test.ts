import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  previewRide,
  saveRide,
  rideDefaults,
  rideDetail,
  rideList,
  deleteRide,
  refreshRideAnalysis,
} from "../lib/rides.ts";
import { cleanupRides, getOriginal } from "../lib/ride-storage.ts";
import {
  likeRide,
  createRideComment,
  rideCommentPage,
} from "../lib/ride-comments.ts";
import { notificationPage } from "../lib/notifications.ts";
import { createReport, moderateReport, reportPage } from "../lib/reports.ts";
import { rideFeed } from "../lib/ride-feed.ts";
import { gpx, loop } from "./ride-fixtures.js";
import { seedSiteDefaults, testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow, viewer } from "./support/people.ts";
import { present } from "./support/assertions.ts";
test("rides ownership, previews, privacy, social, feed, moderation, delete and storage lifecycle", async () => {
  const dir = await mkdtemp(tmpdir() + "/cola-rides-");
  process.env.RIDES_DIR = dir;
  const db = await testDatabase();
  try {
    await seedSiteDefaults(db);
    const owner = (
        await userRow(db, {
          name: "ridera",
          username: "ridera",
          email: "ridera",
        })
      ).id,
      other = (
        await userRow(db, {
          name: "riderb",
          username: "riderb",
          email: "riderb",
        })
      ).id;
    const bike = (await bikeRow(db, owner, { name: "Test", category: "road" }))
        .id,
      bike2 = (await bikeRow(db, owner, { name: "Test", category: "road" })).id;
    const tx = db.transaction,
      preview = await tx((q) =>
        previewRide(q, owner, gpx([loop]), rideDefaults),
      );
    const ride = {
      bikeId: bike,
      title: "Loop",
      description: "",
      isPublic: true,
      privacyEnabled: true,
      privacyRadiusM: 500,
    };
    // The first save binds the preview; an edit has none.
    const input = { previewId: preview.previewId, ...ride };
    await assert.rejects(
      tx((q) => saveRide(q, other, input, rideDefaults)),
      /свой велосипед/,
    );
    const saved = await tx((q) => saveRide(q, owner, input, rideDefaults));
    const r = await rideDetail(db, saved.shareId, other);
    assert.equal(r.title, "Loop");
    const publicAnalysis = present(r.analysis);
    assert.equal(publicAnalysis.visibility, "public");
    assert.ok(
      publicAnalysis.pointCount > 0 && publicAnalysis.pointCount < loop.length,
    );
    const ownAnalysis = present(
      (await rideDetail(db, saved.shareId, owner, true)).analysis,
    );
    assert.equal(ownAnalysis.pointCount, loop.length);
    assert.equal(ownAnalysis.visibility, "owner");
    assert.ok(present(ownAnalysis.segments[0]?.[0]).timestampS);
    assert.equal(
      present((await rideDetail(db, saved.shareId, other, true)).analysis)
        .visibility,
      "public",
    );
    await assert.rejects(
      tx((q) => refreshRideAnalysis(q, other, saved.id, rideDefaults)),
      /недоступна/,
    );
    await db.query("DELETE FROM ride_analysis WHERE ride_id=$1", [saved.id]);
    assert.equal(
      (await rideDetail(db, saved.shareId, owner, true)).analysis,
      null,
    );
    await tx((q) => refreshRideAnalysis(q, owner, saved.id, rideDefaults));
    assert.deepEqual(
      (await rideDetail(db, saved.shareId, owner, true)).analysis,
      ownAnalysis,
    );
    await db.query(
      "UPDATE ride_analysis SET privacy_radius_m=1000 WHERE ride_id=$1",
      [saved.id],
    );
    assert.equal((await rideDetail(db, saved.shareId, other)).analysis, null);
    await tx((q) => refreshRideAnalysis(q, owner, saved.id, rideDefaults));

    assert.ok(!("startedAt" in r));
    assert.ok(!("sourceHash" in r));
    assert.ok(r.geometry.length);
    await assert.rejects(
      tx((q) => saveRide(q, owner, input, rideDefaults)),
      /Предпросмотр/,
    );
    await assert.rejects(
      tx((q) => previewRide(q, owner, gpx([loop]), rideDefaults)),
      /уже загружена/,
    );
    await assert.rejects(
      tx((q) => likeRide(q, saved.id, owner, true)),
      /своей/,
    );
    await tx((q) => likeRide(q, saved.id, other, true));
    await tx((q) => likeRide(q, saved.id, other, true));
    assert.equal((await rideDetail(db, saved.shareId, other)).likes, 1);
    const comment = await tx((q) =>
      createRideComment(q, saved.id, viewer({ id: other }), { body: "Nice" }),
    );
    await tx((q) =>
      createRideComment(q, saved.id, viewer({ id: owner }), {
        body: "Thanks",
        parentId: comment.id,
      }),
    );
    assert.equal(
      (await rideCommentPage(db, saved.id, viewer({ id: owner }))).comments[0]
        .replies.length,
      1,
    );
    assert.equal((await notificationPage(db, owner)).notifications.length, 2);
    assert.equal(
      (await notificationPage(db, other)).notifications[0].type,
      "ride_reply",
    );
    await db.query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2)",
      [other, owner],
    );
    assert.ok((await rideFeed(db, other)).items.some((r) => r.kind === "ride"));
    const onlyRides = await rideFeed(db, other, 1, "rides");
    assert.equal(onlyRides.total, 1);
    assert.equal(onlyRides.items.length, 1);
    assert.equal(onlyRides.items[0].kind, "ride");
    assert.equal(onlyRides.bikes.length, 0);
    assert.equal((await rideFeed(db, owner, 1, "rides")).total, 0);
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    await assert.rejects(rideDetail(db, saved.shareId, other), /недоступна/);
    assert.equal((await rideList(db, other)).total, 0);
    assert.equal((await notificationPage(db, owner)).notifications.length, 0);
    const edit = { ...ride, bikeId: bike2, privacyRadiusM: 1000 };
    await tx((q) => saveRide(q, owner, edit, rideDefaults, saved.id));
    assert.notDeepEqual(
      (await rideDetail(db, saved.shareId, other)).geometry,
      r.geometry,
    );
    await assert.rejects(
      db.query("DELETE FROM bikes WHERE id=$1", [bike2]),
      /foreign key/,
    );
    await tx((q) =>
      createReport(q, viewer({ id: other }), {
        entityType: "ride",
        targetId: saved.id,
        reason: "spam",
      }),
    );
    const reports = await reportPage(db);
    assert.match(present(reports.reports[0]?.target.href), /\/r\//);
    await tx((q) =>
      moderateReport(
        q,
        present(reports.reports[0]).id,
        viewer({ id: owner, role: "admin" }),
        "hide_ride",
      ),
    );
    await assert.rejects(rideDetail(db, saved.shareId, other));
    await tx((q) => deleteRide(q, owner, saved.id));
    await cleanupRides(db);
    await assert.rejects(getOriginal(saved.id));
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM ride_comments")).rows[0].n,
      0,
    );
  } catch (e) {
    console.error("RIDES FAIL", e);
    throw e;
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RIDES_DIR;
  }
});
