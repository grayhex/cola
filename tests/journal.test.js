import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  journalInput,
  saveJournal,
  journalDetail,
  journalList,
  deleteJournal,
} from "../lib/journal.js";
import { journalSocial } from "../lib/journal-social.js";
import {
  saveJournalPhoto,
  readJournalPhoto,
  cleanupJournalPhotos,
} from "../lib/journal-storage.js";
import { notificationPage, unreadCount } from "../lib/notifications.js";
import { createReport, moderateReport, reportPage } from "../lib/reports.js";
import { siteStatistics } from "../lib/site-statistics.js";
import { settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";
import { siteAssetIds } from "../lib/site-assets.js";
import { fontNames, hostedFonts } from "../lib/fonts.js";
test("journal validation, font catalogue and asset references", () => {
  const base = { bikeId: randomUUID(), kind: "story", title: "", body: "" };
  assert(journalInput.safeParse(base).success);
  assert(!journalInput.safeParse({ ...base, status: "published" }).success);
  assert(!journalInput.safeParse({ ...base, eventDate: "2026-02-30" }).success);
  assert(
    !journalInput.safeParse({ ...base, components: [{ name: "forged" }] })
      .success,
  );
  assert(!journalInput.safeParse({ ...base, body: "text\0" }).success);
  assert.equal(hostedFonts.length, 10);
  for (const font of fontNames)
    assert(settingsInput.safeParse({ ...defaultSettings, font }).success);
  const id = randomUUID();
  assert(
    settingsInput.safeParse({ ...defaultSettings, uiIcons: { Bike: id } })
      .success,
  );
  assert(
    !settingsInput.safeParse({ ...defaultSettings, uiIcons: { arbitrary: id } })
      .success,
  );
  assert.deepEqual(
    siteAssetIds({
      ...defaultSettings,
      uiIcons: { Bike: id },
      loginImageId: id,
    }),
    [id],
  );
});
test("journal lifecycle: snapshots, linked ride, reused social features, visibility and protected media", async () => {
  const q = new PGlite(),
    dir = await mkdtemp(path.join(tmpdir(), "cola-journal-"));
  const before = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await q.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = { id: randomUUID(), role: "user" },
      other = { id: randomUUID(), role: "user" },
      admin = { id: randomUUID(), role: "admin" };
    for (const [i, u] of [owner, other, admin].entries())
      await q.query(
        "INSERT INTO users(id,email,name,password_hash,username,role) VALUES($1,$2,'Rider','x',$3,$4)",
        [u.id, i + "@test.example", "rider" + i, u.role],
      );
    const bike = randomUUID(),
      alien = randomUUID();
    for (const id of [bike, alien])
      await q.query(
        "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$3,'Journal bike',2026,'road',true)",
        [id, owner.id, randomUUID()],
      );
    const part = randomUUID(),
      otherPart = randomUUID(),
      ride = randomUUID();
    for (const [id, b] of [
      [part, bike],
      [otherPart, alien],
    ])
      await q.query(
        "INSERT INTO components(id,bike_id,section,category,name,price,url) VALUES($1,$2,'build','wheel','Original wheel',12345,'https://example.test/wheel')",
        [id, b],
      );
    await q.query(
      "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,is_public) VALUES($1,$1,$2,$3,'Private ride',5000,0,0,'[]',500,'journal-test',false)",
      [ride, owner.id, bike],
    );
    const input = journalInput.parse({
      bikeId: bike,
      kind: "build",
      title: "New wheels",
      body: "What changed",
      eventDate: "2026-09-20",
      componentIds: [part],
      rideId: ride,
    });
    const saved = await q.transaction((t) => saveJournal(t, owner.id, input));
    assert.equal(
      (await journalDetail(q, saved.shareId, owner.id)).eventDate,
      "2026-09-20",
    );
    await assert.rejects(
      journalDetail(q, saved.shareId),
      (e) => e.status === 404,
    );
    assert.equal((await journalList(q, bike)).entries.length, 0);
    assert.equal(
      (await journalDetail(q, saved.shareId, owner.id)).status,
      "draft",
    );
    await assert.rejects(
      q.transaction((t) => saveJournal(t, other.id, input, saved.id)),
      (e) => e.status === 404,
    );
    await assert.rejects(
      q.transaction((t) =>
        saveJournal(
          t,
          owner.id,
          { ...input, componentIds: [otherPart] },
          saved.id,
        ),
      ),
      /Компонент/,
    );
    await assert.rejects(
      q.transaction((t) =>
        saveJournal(
          t,
          owner.id,
          { ...input, bikeId: alien, componentIds: [] },
          null,
        ),
      ),
      /покатушку/,
    );
    const png = await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#ffffff" },
    })
      .webp()
      .toBuffer();
    const photo = await saveJournalPhoto(
      (fn) => q.transaction(fn),
      saved.id,
      owner.id,
      png,
    );
    await assert.rejects(
      readJournalPhoto(q, photo.id),
      (e) => e.status === 404,
    );
    assert((await readJournalPhoto(q, photo.id, owner.id)).length > 0);
    await q.transaction((t) =>
      saveJournal(
        t,
        owner.id,
        { ...input, status: "published", isPublic: false },
        saved.id,
      ),
    );
    await assert.rejects(
      journalDetail(q, saved.shareId, other.id),
      (e) => e.status === 404,
    );
    const published = { ...input, status: "published", isPublic: true };
    await q.transaction((t) => saveJournal(t, owner.id, published, saved.id));
    const publicEntry = await journalDetail(q, saved.shareId);
    assert.equal(publicEntry.ride, null);
    assert.equal(publicEntry.components[0].name, "Original wheel");
    assert(!("price" in publicEntry.components[0]));
    assert(!JSON.stringify(publicEntry).includes("@test.example"));
    assert.equal((await siteStatistics(q)).entries, 1);
    await q.query(
      "UPDATE components SET name='Changed wheel',price=9 WHERE id=$1",
      [part],
    );
    await q.transaction((t) =>
      saveJournal(
        t,
        owner.id,
        { ...published, body: "Edited story" },
        saved.id,
      ),
    );
    assert.equal(
      (await journalDetail(q, saved.shareId, owner.id)).components[0].price,
      "12345.00",
    );
    await q.query("DELETE FROM components WHERE id=$1", [part]);
    await q.transaction((t) => saveJournal(t, owner.id, published, saved.id));
    assert.equal(
      (await journalDetail(q, saved.shareId)).components[0].name,
      "Original wheel",
    );
    await q.query("UPDATE rides SET is_public=true WHERE id=$1", [ride]);
    assert.equal((await journalDetail(q, saved.shareId)).ride.id, ride);
    await q.transaction((t) => journalSocial.like(t, saved.id, other.id, true));
    await q.transaction((t) => journalSocial.like(t, saved.id, other.id, true));
    const comment = await q.transaction((t) =>
      journalSocial.create(t, saved.id, other, { body: "Question" }),
    );
    const reply = await q.transaction((t) =>
      journalSocial.create(t, saved.id, owner, {
        body: "Answer",
        parentId: comment.id,
      }),
    );
    assert.equal(
      (await journalSocial.page(q, saved.id, other)).comments[0].replies[0].id,
      reply.id,
    );
    await assert.rejects(
      q.transaction((t) =>
        journalSocial.create(t, saved.id, other, {
          body: "Nested",
          parentId: reply.id,
        }),
      ),
      /основной/,
    );
    await assert.rejects(
      q.transaction((t) =>
        journalSocial.change(t, comment.id, owner, "Hijack"),
      ),
      (e) => e.status === 403,
    );
    await q.transaction((t) =>
      journalSocial.change(t, comment.id, other, "Edited question"),
    );
    const notifications = await notificationPage(q, owner.id);
    assert.equal(notifications.notifications.length, 2);
    assert(
      notifications.notifications.every((n) => n.target.href.startsWith("/j/")),
    );
    const report = await q.transaction((t) =>
      createReport(t, other, {
        entityType: "journal",
        targetId: saved.id,
        reason: "other",
      }),
    );
    assert(report.created);
    const reports = await reportPage(q);
    assert.equal(reports.reports[0].target.href, "/j/" + saved.shareId);
    assert((await readJournalPhoto(q, photo.id)).length > 0);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    for (const viewer of [null, other.id, admin.id]) {
      await assert.rejects(
        journalDetail(q, saved.shareId, viewer),
        (e) => e.status === 404,
      );
      await assert.rejects(
        readJournalPhoto(q, photo.id, viewer),
        (e) => e.status === 404,
      );
      assert.equal((await journalList(q, bike, viewer)).entries.length, 0);
    }
    await assert.rejects(
      journalSocial.page(q, saved.id, other),
      (e) => e.status === 404,
    );
    await assert.rejects(
      q.transaction((t) => journalSocial.like(t, saved.id, other.id, true)),
      (e) => e.status === 404,
    );
    await assert.rejects(
      q.transaction((t) =>
        createReport(t, other, {
          entityType: "journal",
          targetId: saved.id,
          reason: "other",
        }),
      ),
      (e) => e.status === 404,
    );
    assert.equal((await unreadCount(q, owner.id)).unread, 0);
    assert.equal((await siteStatistics(q)).entries, 0);
    assert((await readJournalPhoto(q, photo.id, owner.id)).length > 0);
    await q.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
    await q.transaction((t) =>
      moderateReport(t, reports.reports[0].id, admin, "hide_journal"),
    );
    await assert.rejects(
      journalDetail(q, saved.shareId),
      (e) => e.status === 404,
    );
    await q.transaction((t) => deleteJournal(t, saved.id, owner.id));
    await cleanupJournalPhotos(q);
    assert.deepEqual(await readdir(dir), []);
    assert.equal(
      (await q.query("SELECT count(*)::int n FROM journal_comments")).rows[0].n,
      0,
    );
  } finally {
    await q.close();
    await rm(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = before;
  }
});
