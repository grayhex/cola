import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.ts";
import { preparePhoto } from "../lib/images.ts";
import {
  componentGallery,
  saveComponentPhoto,
  changeComponentPhoto,
  changeComponentGallery,
  componentPhotoFilename,
  cleanupComponentPhotos,
} from "../lib/component-photos.ts";
import { componentSocial } from "../lib/component-social.ts";
import {
  editComponentModel,
  mergeComponentModels,
  resolveComponentModel,
} from "../lib/component-catalog.ts";
import { notificationPage } from "../lib/notifications.ts";
import { createReport, reportPage, moderateReport } from "../lib/reports.ts";
import { componentPhotoBytes, checkPhotoQuota, limits } from "../lib/limits.ts";
import { migrateOnly, testDatabase } from "./support/database.ts";
import { bikeRow, componentRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import { userRow, viewer } from "./support/people.ts";
import { one } from "./support/rows.ts";
import { exportAccount } from "../lib/account-data.ts";

test("component media and shared discussion: upgrade, roles, quota, merges, moderation and lifetime", async () => {
  const db = await testDatabase({ migrated: false }),
    dir = await mkdtemp(path.join(os.tmpdir(), "cola-components-"));
  const oldDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const tx = db.transaction;
  const user = async (role: "user" | "admin" = "user", verified = true) => {
    const row = await userRow(db, {
      name: "Author",
      role,
      email_verified_at: verified ? new Date() : null,
    });
    return viewer({
      id: row.id,
      role,
      email_verified_at: row.email_verified_at,
    });
  };
  const bike = async (u: { id: string }, isPublic = true) =>
    (
      await bikeRow(db, u.id, {
        name: "Private name",
        brand: "Cube",
        model: "Travel",
        year: 2024,
        category: "road",
        is_public: isPublic,
      })
    ).id;
  const install = async (bikeId: string, name: string) => {
    const row = await componentRow(db, bikeId, { name });
    return present(
      (
        await one<{ model_id: string | null }>(
          db,
          "SELECT model_id FROM components WHERE id=$1",
          [row.id],
        )
      ).model_id,
      "model of the installed component",
    );
  };
  const denied = (promise: Promise<unknown>, status: number) =>
    assert.rejects(promise, { status });
  try {
    await migrateOnly(db, (f) => f < "029");
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    const owner = await user(),
      other = await user(),
      admin = await user("admin"),
      unverified = await user("user", false);
    const publicBike = await bike(other),
      privateBike = await bike(owner, false),
      secondBike = await bike(other);
    const model = await install(publicBike, "Brooks Photos"),
      second = await install(secondBike, "Brooks Other");
    assert.equal(await install(privateBike, "Brooks Photos"), model);
    const privateOnly = await install(privateBike, "Never public");
    const snapshot = (await db.query("SELECT * FROM components ORDER BY id"))
      .rows;
    await migrateOnly(
      db,
      (f) =>
        f === "029_component_community.sql" ||
        f === "030_market_catalog_links.sql",
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM components ORDER BY id")).rows,
      snapshot,
    );
    // Current notification readers require the current ride and weekly schemas.
    await migrateOnly(db, (f) => f >= "031");
    const raw = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#efac21" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "PRIVATE EXIF" } } })
      .toBuffer();
    const bytes = await preparePhoto(raw);
    assert.equal((await sharp(bytes).metadata()).exif, undefined);
    await denied(componentGallery(db, privateOnly), 404);
    await denied(saveComponentPhoto(tx, model, unverified, bytes), 403);
    // A verified non-owner cannot borrow another person's photo capability.
    const stranger = await user();
    await denied(saveComponentPhoto(tx, model, stranger, bytes), 403);
    const first = (await saveComponentPhoto(tx, model, owner, bytes)).id;
    const adminPhoto = (await saveComponentPhoto(tx, model, admin, bytes)).id;
    const otherPhoto = (await saveComponentPhoto(tx, second, other, bytes)).id;
    let gallery = await componentGallery(db, model);
    assert.equal(gallery.photos[0].isCover, true);
    assert.equal(gallery.photos[0].author.id, owner.id);
    assert.equal(JSON.stringify(gallery).includes(privateBike), false);
    assert.equal(JSON.stringify(gallery).includes("Private name"), false);
    assert.equal(JSON.stringify(gallery).includes("@example.test"), false);
    assert.equal((await componentGallery(db, model, owner)).canUpload, true);
    await denied(
      tx((q) =>
        changeComponentPhoto(q, second, first, admin, {
          version: 1,
          hidden: true,
        }),
      ),
      404,
    );
    await denied(
      tx((q) => changeComponentPhoto(q, model, first, stranger, null)),
      403,
    );
    await denied(
      tx((q) =>
        changeComponentPhoto(q, model, first, owner, {
          version: 1,
          hidden: false,
        }),
      ),
      403,
    );
    await tx((q) =>
      changeComponentPhoto(q, model, first, owner, {
        version: 1,
        caption: "Моё седло",
      }),
    );
    await denied(
      tx((q) =>
        changeComponentPhoto(q, model, first, owner, {
          version: 1,
          caption: "Lost update",
        }),
      ),
      409,
    );
    gallery = await componentGallery(db, model, admin);
    await tx((q) =>
      changeComponentGallery(q, model, admin, {
        version: gallery.version,
        coverId: adminPhoto,
        order: [adminPhoto, first],
      }),
    );
    assert.equal((await componentGallery(db, model)).photos[0].id, adminPhoto);
    await denied(
      tx((q) =>
        changeComponentGallery(q, model, admin, {
          version: gallery.version,
          coverId: first,
        }),
      ),
      409,
    );
    gallery = await componentGallery(db, model, admin);
    await denied(
      tx((q) =>
        changeComponentGallery(q, model, admin, {
          version: gallery.version,
          coverId: otherPhoto,
        }),
      ),
      404,
    );
    await denied(
      tx((q) =>
        changeComponentGallery(q, model, admin, {
          version: gallery.version,
          order: [adminPhoto, otherPhoto],
        }),
      ),
      409,
    );
    await denied(
      tx((q) =>
        changeComponentGallery(q, model, owner, {
          version: gallery.version,
          coverId: first,
        }),
      ),
      403,
    );
    const photoReport = await tx((q) =>
      createReport(q, stranger, {
        entityType: "component_photo",
        targetId: first,
        reason: "copyright",
      }),
    );
    assert.equal(photoReport.created, true);
    const report = present(
      (await reportPage(db)).reports.find((r) => r.targetId === first),
    );
    assert.match(present(report.target.href), /#photo-/);
    await tx((q) =>
      moderateReport(q, report.id, admin, "hide_component_photo"),
    );
    assert.equal((await componentGallery(db, model)).photos.length, 1);
    await denied(componentPhotoFilename(db, first), 404);
    assert.match(await componentPhotoFilename(db, first, owner), /^component-/);
    await tx((q) =>
      changeComponentPhoto(q, model, first, admin, {
        version: 3,
        hidden: false,
      }),
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner.id]);
    assert.equal((await componentGallery(db, model)).photos.length, 1);
    await denied(componentPhotoFilename(db, first), 404);
    await denied(saveComponentPhoto(tx, model, owner, bytes), 403);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [owner.id]);
    // New media shares the existing budget in both directions.
    await db.query("UPDATE component_photos SET size_bytes=$2 WHERE id=$1", [
      first,
      limits.storageBytes,
    ]);
    await denied(saveComponentPhoto(tx, model, owner, bytes), 409);
    await denied(
      tx((q) => checkPhotoQuota(q, owner.id, privateBike, [1])),
      409,
    );
    await db.query("UPDATE component_photos SET size_bytes=$2 WHERE id=$1", [
      first,
      bytes.length,
    ]);
    assert.equal(await componentPhotoBytes(db, owner.id), bytes.length);
    assert.equal(
      (await exportAccount(db, owner.id, "https://example.test"))
        .componentPhotos[0].id,
      first,
    );
    const root = await tx((q) =>
      componentSocial.create(q, model, owner, { body: "Как седло?" }),
    );
    assert.equal(
      (await notificationPage(db, other.id)).notifications.length,
      0,
    ); // No catalog owner/fanout.
    const foreignRoot = await tx((q) =>
      componentSocial.create(q, second, other, { body: "Другая модель" }),
    );
    await denied(
      tx((q) =>
        componentSocial.create(q, model, other, {
          body: "Cross model",
          parentId: foreignRoot.id,
        }),
      ),
      404,
    );
    await denied(
      tx((q) =>
        componentSocial.create(q, model, unverified, { body: "No email" }),
      ),
      403,
    );
    const reply = await tx((q) =>
      componentSocial.create(q, model, stranger, {
        parentId: root.id,
        body: "Мне подходит",
      }),
    );
    const nested = await tx((q) =>
      componentSocial.create(q, model, other, {
        parentId: reply.id,
        body: "Nested",
      }),
    );
    assert.equal(
      (await componentSocial.replies(db, model, reply.id, other)).comments[0]
        .id,
      nested.id,
    );
    await tx((q) => componentSocial.change(q, nested.id, other));
    await tx((q) =>
      componentSocial.create(q, model, stranger, {
        parentId: root.id,
        body: "Ещё ответ",
      }),
    );
    let notices = (await notificationPage(db, owner.id)).notifications;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, "component_reply");
    assert.match(notices[0].target.href, new RegExp(reply.id));
    await denied(
      tx((q) => componentSocial.change(q, root.id, stranger, "Not mine")),
      403,
    );
    await tx((q) => componentSocial.change(q, reply.id, stranger, "Уточнение"));
    await tx((q) =>
      createReport(q, owner, {
        entityType: "component_comment",
        targetId: reply.id,
        reason: "abuse",
      }),
    );
    const commentReport = present(
      (await reportPage(db)).reports.find((r) => r.targetId === reply.id),
    );
    await tx((q) =>
      moderateReport(q, commentReport.id, admin, "delete_comment"),
    );
    assert.equal(
      (await notificationPage(db, owner.id)).notifications.length,
      0,
    );
    // Merge keeps both immutable threads and media; replies to the old root use its FK.
    const original = present(await resolveComponentModel(db, model)),
      target = present(await resolveComponentModel(db, second));
    await tx((q) =>
      mergeComponentModels(q, admin.id, model, {
        version: original.version,
        targetId: second,
        targetVersion: target.version,
      }),
    );
    assert.equal((await componentGallery(db, model)).photos.length, 3);
    assert.equal(
      (await componentSocial.page(db, second, owner)).comments.length,
      2,
    );
    const mergedReply = await tx((q) =>
      componentSocial.create(q, second, other, {
        parentId: root.id,
        body: "После объединения",
      }),
    );
    assert.equal(
      (
        await db.query("SELECT model_id FROM component_comments WHERE id=$1", [
          mergedReply.id,
        ])
      ).rows[0].model_id,
      model,
    );
    const rename = present(await resolveComponentModel(db, second));
    await tx((q) =>
      editComponentModel(q, admin.id, second, {
        ...rename,
        category: rename.category,
        name: "New model name",
        brand: "Brooks",
        archived: false,
        version: rename.version,
      }),
    );
    notices = (await notificationPage(db, owner.id)).notifications;
    assert.equal(notices[0].target.name, "New model name");
    assert.match(notices[0].target.href, /new-model-name/);
    await db.query("DELETE FROM bikes WHERE id=ANY($1::uuid[])", [
      [publicBike, secondBike, privateBike],
    ]);
    assert.equal((await componentGallery(db, second)).photos.length, 3);
    assert.equal((await componentGallery(db, model, owner)).canUpload, false);
    assert.equal(
      (await componentSocial.page(db, second, owner)).comments.length,
      2,
    );
    await assert.rejects(
      tx((q) => q.query("DELETE FROM component_models WHERE id=$1", [model])),
      /violates RESTRICT setting of foreign key constraint/,
    ); // FK RESTRICT.
    await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [
      owner.id,
    ]);
    await denied(
      tx((q) =>
        changeComponentPhoto(q, second, first, owner, {
          version: 4,
          caption: "New public text",
        }),
      ),
      403,
    );
    await tx((q) => componentSocial.change(q, root.id, owner, null));
    const tombstone = present(
      (await componentSocial.page(db, second, owner)).comments.find(
        (c) => c.id === root.id,
      ),
    );
    assert.equal(tombstone.unavailable, true);
    assert.equal(tombstone.body, null);
    assert.ok(tombstone.replies.length);
    const filename = await componentPhotoFilename(db, first, owner);
    await tx((q) => changeComponentPhoto(q, second, first, owner, null));
    assert.ok(
      (
        await db.query("SELECT 1 FROM component_photo_gc WHERE filename=$1", [
          filename,
        ])
      ).rowCount,
    );
    await cleanupComponentPhotos(db);
    await assert.rejects(access(path.join(dir, filename)));
    await db.query("DELETE FROM users WHERE id=$1", [other.id]);
    await cleanupComponentPhotos(db);
    assert.equal((await componentGallery(db, second)).photos.length, 1);
    assert.ok(await resolveComponentModel(db, model));
  } finally {
    await db.close();
    if (oldDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
