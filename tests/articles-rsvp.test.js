import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  articleInput,
  articleList,
  articleDetail,
  saveArticle,
  deleteArticle,
  articleSocial,
} from "../lib/articles.js";
import { saveJournalPhoto, readJournalPhoto } from "../lib/journal-storage.js";
import { notificationPage } from "../lib/notifications.js";
import { createReport, reportPage, moderateReport } from "../lib/reports.js";
import {
  planRide,
  planInput,
  rideDefaults,
  rideDetail,
  respondRide,
  rideOccurrence,
  cancelPlannedRide,
} from "../lib/rides.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { articleBlocks, articleInline } from "../lib/article-markup.js";
import { settingsInput } from "../lib/admin-validation.js";

test("article markup renders a small safe subset, attachment references and plain HTML", () => {
  const id = randomUUID(),
    blocks = articleBlocks(
      '## Покрышки\n\n**Размеры** и *выбор*.\n\n- 700C\n- 29"\n\n![Схема](photo:' +
        id +
        ")\n\n<script>alert(1)</script>",
    );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "paragraph", "list", "image", "paragraph"],
  );
  assert.equal(blocks[3].id, id);
  assert.equal(blocks[4].text, "<script>alert(1)</script>");
  assert.equal(articleInline("[опасно](javascript:alert(1))")[0].type, "text");
  assert.equal(
    articleInline("[документация](https://example.test/a)")[0].type,
    "link",
  );
  assert.equal(
    articleBlocks("![tracking](https://example.test/pixel)")[0].type,
    "paragraph",
  );
  assert(
    !articleInput.safeParse({
      title: "",
      body: "",
      status: "published",
      topicId: "maintenance",
    }).success,
  );
  assert(
    !settingsInput.safeParse({
      ...defaultSettings,
      articleTopics: [
        defaultSettings.articleTopics[0],
        defaultSettings.articleTopics[0],
      ],
    }).success,
  );
  assert(
    !settingsInput.safeParse({
      ...defaultSettings,
      emojis: { ...defaultSettings.emojis, unknown: "x" },
    }).success,
  );
});

test("standalone articles: draft visibility, ownership, attachments, topics, comments and moderation", async () => {
  const db = new PGlite(),
    dir = await mkdtemp(path.join(tmpdir(), "cola-articles-")),
    before = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
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
    const owner = { id: randomUUID(), role: "user" },
      reader = { id: randomUUID(), role: "user" },
      admin = { id: randomUUID(), role: "admin" };
    for (const [i, u] of [owner, reader, admin].entries())
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username,role) VALUES($1,$2,'Reader','hash',$3,$4)",
        [u.id, u.id + "@example.test", "article" + i, u.role],
      );
    const input = {
      title: "Обслуживание тормозов",
      body: "## Подготовка\n\n**Инструкция**",
      topicId: "maintenance",
      status: "draft",
    };
    const article = await db.transaction((q) =>
      saveArticle(q, owner.id, articleInput.parse(input)),
    );
    assert.equal((await articleList(db)).total, 0);
    assert.equal((await articleList(db, owner.id, { own: true })).total, 1);
    await assert.rejects(articleDetail(db, article.shareId, reader.id), {
      status: 404,
    });
    await assert.rejects(
      db.transaction((q) => saveArticle(q, reader.id, input, article.id)),
      { status: 404 },
    );
    await assert.rejects(
      db.transaction((q) =>
        saveArticle(q, owner.id, { ...input, topicId: "missing" }, article.id),
      ),
      /рубрику/,
    );
    const photo = await saveJournalPhoto(
      (fn) => db.transaction(fn),
      article.id,
      owner.id,
      Buffer.from("webp-fixture"),
    );
    await assert.rejects(readJournalPhoto(db, photo.id), { status: 404 });
    assert.equal(
      (await readJournalPhoto(db, photo.id, owner.id)).toString(),
      "webp-fixture",
    );
    await db.transaction((q) =>
      saveArticle(q, owner.id, { ...input, status: "published" }, article.id),
    );
    const detail = await articleDetail(db, article.shareId);
    assert.equal(detail.photos[0].id, photo.id);
    assert(!("bike" in detail));
    assert.equal(
      (await articleList(db, null, { topic: "maintenance", search: "тормоз" }))
        .total,
      1,
    );
    assert.equal(
      (await articleList(db, null, { topic: "equipment" })).total,
      0,
    );
    assert.equal(
      (await readJournalPhoto(db, photo.id)).toString(),
      "webp-fixture",
    );
    const comment = await db.transaction((q) =>
      articleSocial.create(q, article.id, reader, {
        body: "Полезно",
        parentId: null,
      }),
    );
    await db.transaction((q) =>
      articleSocial.create(q, article.id, owner, {
        body: "Спасибо",
        parentId: comment.id,
      }),
    );
    assert.equal(
      (await articleSocial.page(db, article.id, reader)).comments[0].replies
        .length,
      1,
    );
    assert.match(
      (await notificationPage(db, owner.id)).notifications[0].target.href,
      /^\/articles\//,
    );
    await createReport(db, reader, {
      entityType: "journal",
      targetId: article.id,
      reason: "spam",
    });
    const report = (await reportPage(db)).reports[0];
    assert.match(report.target.href, /^\/articles\//);
    await db.transaction((q) =>
      moderateReport(q, report.id, admin, "hide_journal"),
    );
    await assert.rejects(articleDetail(db, article.shareId), { status: 404 });
    await assert.rejects(articleSocial.page(db, article.id, reader), {
      status: 404,
    });
    await assert.rejects(readJournalPhoto(db, photo.id), { status: 404 });
    assert.equal(
      (await notificationPage(db, owner.id)).notifications.length,
      0,
    );
    await db.transaction((q) => deleteArticle(q, article.id, owner.id));
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM journal_comments")).rows[0]
        .n,
      0,
    );
  } finally {
    if (before === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = before;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("weekly rides keep local time across DST and RSVP is scoped to the occurrence and access", async () => {
  const db = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = randomUUID(),
      reader = randomUUID(),
      bike = randomUUID();
    for (const [i, id] of [owner, reader].entries())
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Rider','hash',$3)",
        [id, id + "@example.test", "weekly" + i],
      );
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$3,'Bike',2024,'gravel',true)",
      [bike, owner, randomUUID()],
    );
    const input = {
      bikeId: bike,
      title: "Каждую субботу",
      description: "",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: "2031-03-29T09:00:00Z",
      recurrence: "weekly",
      recurrenceTimezone: "Europe/Berlin",
    };
    assert(
      !planInput.safeParse({ ...input, recurrenceTimezone: "not/a/timezone" })
        .success,
    );
    const plan = await db.transaction((q) =>
      planRide(q, owner, planInput.parse(input), rideDefaults),
    );
    // First Saturday is CET, next Saturday is CEST: both start at 10:00 local.
    const next = (
      await db.query(
        `SELECT ${rideOccurrence.replaceAll("now()", "'2031-03-30T12:00:00Z'::timestamptz")} AS occurs_at FROM rides r WHERE id=$1`,
        [plan.id],
      )
    ).rows[0].occurs_at;
    assert.equal(new Date(next).toISOString(), "2031-04-05T08:00:00.000Z");
    let detail = await rideDetail(db, plan.shareId, reader);
    await db.transaction((q) =>
      respondRide(q, plan.id, reader, "accepted", detail.scheduledAt),
    );
    await db.transaction((q) =>
      respondRide(q, plan.id, reader, "maybe", detail.scheduledAt),
    );
    detail = await rideDetail(db, plan.shareId, reader);
    assert.equal(detail.rsvp, "maybe");
    assert.deepEqual(detail.rsvpCounts, { maybe: 1 });
    await assert.rejects(
      db.transaction((q) =>
        respondRide(q, plan.id, reader, "accepted", "2031-04-05T08:00:00Z"),
      ),
      { status: 409 },
    );
    await db.query(
      "UPDATE rides SET started_at='2009-03-28T09:00:00Z' WHERE id=$1",
      [plan.id],
    );
    detail = await rideDetail(db, plan.shareId, reader);
    assert(new Date(detail.scheduledAt) > new Date());
    assert.equal(detail.rsvp, null);
    assert.deepEqual(detail.rsvpCounts, {});
    await db.query("UPDATE rides SET is_public=false WHERE id=$1", [plan.id]);
    await assert.rejects(
      db.transaction((q) =>
        respondRide(q, plan.id, reader, "accepted", detail.scheduledAt),
      ),
      { status: 404 },
    );
    await db.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
      [plan.id, reader],
    );
    await db.transaction((q) =>
      respondRide(q, plan.id, reader, "declined", detail.scheduledAt),
    );
    await db.transaction((q) => cancelPlannedRide(q, plan.id, owner));
    await assert.rejects(
      db.transaction((q) =>
        respondRide(q, plan.id, reader, "accepted", detail.scheduledAt),
      ),
      { status: 404 },
    );
  } finally {
    await db.close();
  }
});
