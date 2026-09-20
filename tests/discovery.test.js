import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.js";
import { catalogInput } from "../lib/admin-validation.js";
import { componentModel, mergeCatalog } from "../lib/experience-catalog.js";
import { journalInput, saveJournal, journalDetail } from "../lib/journal.js";
import { journalSocial } from "../lib/journal-social.js";
import {
  setBikeFollow,
  setSaved,
  savedPage,
  setSolution,
} from "../lib/journal-discovery.js";
import { setFollow } from "../lib/follows.js";
import { rideFeed } from "../lib/ride-feed.js";
import { searchInput, searchExperience } from "../lib/search.js";
import { participationSummary } from "../lib/participation.js";
import { notificationPage } from "../lib/notifications.js";
test("catalogue aliases merge identities, not installations; cycles and excessive purposes rejected", () => {
  const c = mergeCatalog(defaultCatalog, {
    kind: "component",
    scope: "Седло",
    alias: "Брукс C-17",
    name: "Brooks C17",
  });
  assert(catalogInput.safeParse(c).success);
  assert.equal(
    componentModel(
      { id: "installation-a", name: "Брукс C-17", category: "Седло" },
      c,
    ).key,
    componentModel(
      { id: "installation-b", name: "Brooks C17", category: "Седло" },
      c,
    ).key,
  );
  assert.notEqual(
    componentModel({ name: "Brooks C17", category: "Седло" }, c).key,
    componentModel({ name: "Brooks C17", category: "Рама" }, c).key,
  );
  assert(
    !catalogInput.safeParse({
      ...c,
      aliases: [
        ...c.aliases,
        {
          kind: "component",
          scope: "Седло",
          alias: "Brooks C17",
          name: "Брукс C-17",
        },
      ],
    }).success,
  );
  assert(
    !catalogInput.safeParse({
      ...c,
      purposes: Array.from({ length: 13 }, (_, i) => ({
        id: "p" + i,
        name: "P",
        enabled: true,
      })),
    }).success,
  );
});
test("discovery lifecycle, aliases, custom builds, deduplicated feeds, bookmarks, resolved questions and live privacy", async () => {
  const db = new PGlite();
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const catalog = mergeCatalog(defaultCatalog, {
      kind: "component",
      scope: "Седло",
      alias: "Брукс С17",
      name: "Brooks C17",
    });
    catalog.aliases.push({
      kind: "model",
      scope: "Cube",
      alias: "Тревел",
      name: "Travel",
    });
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(catalog),
    ]);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    const owner = randomUUID(),
      reader = randomUUID(),
      bike = randomUUID(),
      custom = randomUUID(),
      part = randomUUID(),
      ride = randomUUID();
    for (const [id, name] of [
      [owner, "author"],
      [reader, "reader"],
    ])
      await db.query(
        "INSERT INTO users(id,email,name,username,password_hash) VALUES($1,$2,$2,$2,'x')",
        [id, name],
      );
    for (const [id, brand, model, purposes] of [
      [bike, "Cube", "Travel", ["travel"]],
      [custom, "", "", ["custom"]],
    ])
      await db.query(
        "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public,purposes) VALUES($1,$1,$2,'My build',$3,$4,2020,'road',true,$5)",
        [id, owner, brand, model, purposes],
      );
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло','Брукс С17')",
      [part, bike],
    );
    await db.query(
      "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,is_public) VALUES($1,$1,$2,$3,'Linked',1000,0,0,'[]',500,'discovery',true)",
      [ride, owner, bike],
    );
    const tx = (fn) => db.transaction(fn);
    const input = journalInput.parse({
      bikeId: bike,
      kind: "build",
      title: "Установка седла",
      body: "Рабочее решение владельца",
      status: "published",
      isPublic: true,
      componentIds: [part],
      rideId: ride,
      installationResult: "modified",
    });
    const entry = await tx((q) => saveJournal(q, owner, input));
    const draft = await tx((q) =>
      saveJournal(q, owner, { ...input, status: "draft" }),
    );
    assert.equal((await rideFeed(db, null, 1, "journal", "new")).total, 1);
    assert.equal((await notificationPage(db, reader)).notifications.length, 0);
    await tx((q) => setBikeFollow(q, bike, reader, true));
    await tx((q) => setBikeFollow(q, bike, reader, true));
    await tx((q) => setFollow(q, reader, "author", true));
    assert.equal((await rideFeed(db, reader, 1, "journal")).total, 1);
    const feed = await rideFeed(db, reader);
    assert.equal(feed.items.filter((i) => i.kind === "journal").length, 1);
    assert.equal(feed.items.filter((i) => i.kind === "ride").length, 0);
    assert.equal((await rideFeed(db, reader, 1, "rides")).items.length, 1);
    await tx((q) => setSaved(q, entry.id, reader, true));
    await tx((q) => setSaved(q, entry.id, reader, true));
    assert.equal((await savedPage(db, reader)).total, 1);
    assert.equal((await savedPage(db, owner)).total, 0);
    const search = (v) => searchExperience(db, null, searchInput.parse(v));
    for (const brand of ["cube", "CUBE", "Куб"])
      assert.equal(
        (await search({ brand, model: "Tra-vel", year: "2020" })).total,
        1,
      );
    for (const component of ["Brooks C-17", "брукс с17"]) {
      assert.equal(
        (await search({ component, componentCategory: "Седло" })).total,
        1,
      );
      assert.equal(
        (
          await search({
            type: "journal",
            component,
            componentCategory: "Седло",
          })
        ).total,
        1,
      );
    }
    assert.equal(
      (await search({ component: "Brooks C17", componentCategory: "Рама" }))
        .total,
      0,
    );
    assert.equal((await search({ q: "Brooks C17" })).total, 1);
    assert.equal((await search({ component: "Brooks C17" })).total, 1);
    assert.equal(
      (await search({ component: "Brooks C17", exact: "1" })).total,
      1,
    );
    assert.equal(
      (await search({ component: "Brooks C1", exact: "1" })).total,
      0,
    );
    assert.equal((await search({ model: "Trav", exact: "1" })).total, 0);
    assert.equal(
      (await search({ brand: "Куб", model: "Тревел", exact: "1" })).total,
      1,
    );
    assert.equal((await search({ q: "Куб Тревел" })).total, 1);
    await db.query("UPDATE bikes SET brand='Куб' WHERE id=$1", [bike]);
    assert.equal(
      (await search({ brand: "Cube", model: "Тревел", exact: "1" })).total,
      1,
    );
    assert.equal((await search({ purpose: "custom" })).total, 1);
    assert.equal((await search({ q: "несуществующая деталь" })).total, 0);
    assert.equal((await search({ type: "users", q: "@reader" })).total, 1);
    assert.equal((await search({ similar: custom })).total, 0);
    await db.query(
      "UPDATE components SET name='Unknown free-text saddle' WHERE id=$1",
      [part],
    );
    assert.equal(
      (await search({ component: "Brooks C17", componentCategory: "Седло" }))
        .total,
      0,
    );
    assert.equal(
      (
        await search({
          type: "journal",
          component: "Brooks C17",
          componentCategory: "Седло",
        })
      ).total,
      1,
    );
    assert.equal((await search({ component: "Unknown free-text" })).total, 1);
    const question = await tx((q) =>
      saveJournal(q, owner, { ...input, kind: "question", rideId: null }),
    );
    const comment = await tx((q) =>
      journalSocial.create(
        q,
        question.id,
        { id: reader, role: "user" },
        { body: "Ответ" },
      ),
    );
    await assert.rejects(
      tx((q) => setSolution(q, question.id, reader, comment.id)),
      (e) => e.status === 404,
    );
    await assert.rejects(
      tx((q) => setSolution(q, entry.id, owner, comment.id)),
      (e) => e.status === 404,
    );
    await tx((q) => setSolution(q, question.id, owner, comment.id));
    assert.equal(
      (await journalDetail(db, question.shareId)).solutionId,
      comment.id,
    );
    await tx((q) =>
      journalSocial.change(q, comment.id, { id: reader, role: "user" }, null),
    );
    assert.equal((await journalDetail(db, question.shareId)).solutionId, null);
    const events = await participationSummary(db);
    assert.equal(events.find((r) => r.event === "save").actions, 1);
    assert.equal(events.find((r) => r.event === "publish").actions, 2);
    await tx((q) => saveJournal(q, owner, input, entry.id));
    assert.equal(
      (await participationSummary(db)).find((r) => r.event === "publish")
        .actions,
      2,
    );
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    for (const viewer of [null, reader, owner]) {
      assert.equal(
        (
          await searchExperience(
            db,
            viewer,
            searchInput.parse({ type: "journal" }),
          )
        ).total,
        0,
      );
      assert.equal((await rideFeed(db, viewer, 1, "journal", "new")).total, 0);
    }
    assert.equal((await savedPage(db, reader)).total, 0);
    assert.equal((await search({ brand: "Cube" })).total, 0);
    await assert.rejects(
      tx((q) => setSaved(q, entry.id, reader, true)),
      (e) => e.status === 404,
    );
    await assert.rejects(
      tx((q) => setBikeFollow(q, bike, reader, true)),
      (e) => e.status === 404,
    );
    await assert.rejects(search({ similar: bike }), (e) => e.status === 404);
    await tx((q) => setSaved(q, entry.id, reader, false));
    assert.equal(
      (await notificationPage(db, owner)).notifications.filter(
        (n) => n.target.type === "journal",
      ).length,
      0,
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal((await search({ type: "users", q: "author" })).total, 0);
    await db.query("DELETE FROM users WHERE id=$1", [reader]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM participation_events WHERE event='save'",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
