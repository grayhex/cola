import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  previewRide,
  saveRide,
  rideDefaults,
  rideDetail,
  rideList,
  deleteRide,
} from "../lib/rides.js";
import { cleanupRides, getOriginal } from "../lib/ride-storage.js";
import {
  likeRide,
  createRideComment,
  rideCommentPage,
  changeRideComment,
} from "../lib/ride-comments.js";
import { notificationPage } from "../lib/notifications.js";
import { createReport, moderateReport, reportPage } from "../lib/reports.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { rideFeed } from "../lib/ride-feed.js";
import { gpx, loop } from "./ride-fixtures.js";
test("rides ownership, previews, privacy, social, feed, moderation, delete and storage lifecycle", async () => {
  const dir = await mkdtemp(tmpdir() + "/cola-rides-");
  process.env.RIDES_DIR = dir;
  const db = new PGlite();
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
      other = randomUUID(),
      bike = randomUUID(),
      bike2 = randomUUID();
    for (const [id, name] of [
      [owner, "ridera"],
      [other, "riderb"],
    ])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$2,'hash',$2)",
        [id, name],
      );
    for (const id of [bike, bike2])
      await db.query(
        "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Test',2026,'road',true)",
        [id, owner],
      );
    const tx = (fn) => db.transaction(fn),
      preview = await tx((q) =>
        previewRide(q, owner, gpx([loop]), rideDefaults),
      );
    const input = {
      previewId: preview.previewId,
      bikeId: bike,
      title: "Loop",
      description: "",
      isPublic: true,
      privacyEnabled: true,
      privacyRadiusM: 500,
    };
    await assert.rejects(
      tx((q) => saveRide(q, other, input, rideDefaults)),
      /свой велосипед/,
    );
    const saved = await tx((q) => saveRide(q, owner, input, rideDefaults));
    const r = await rideDetail(db, saved.shareId, other);
    assert.equal(r.title, "Loop");
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
      createRideComment(q, saved.id, { id: other }, { body: "Nice" }),
    );
    await tx((q) =>
      createRideComment(
        q,
        saved.id,
        { id: owner },
        { body: "Thanks", parentId: comment.id },
      ),
    );
    assert.equal(
      (await rideCommentPage(db, saved.id, { id: owner })).comments[0].replies
        .length,
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
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    await assert.rejects(rideDetail(db, saved.shareId, other), /недоступна/);
    assert.equal((await rideList(db, other)).total, 0);
    assert.equal((await notificationPage(db, owner)).notifications.length, 0);
    const edit = { ...input, bikeId: bike2, privacyRadiusM: 1000 };
    delete edit.previewId;
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
      createReport(
        q,
        { id: other },
        { entityType: "ride", targetId: saved.id, reason: "spam" },
      ),
    );
    const reports = await reportPage(db);
    assert.match(reports.reports[0].target.href, /\/r\//);
    await tx((q) =>
      moderateReport(
        q,
        reports.reports[0].id,
        { id: owner, role: "admin" },
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
