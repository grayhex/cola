import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.ts";
import {
  componentCatalog,
  componentCatalogInput,
  componentModelAtPath,
  editComponentModel,
  mergeComponentModels,
  resolveComponentModel,
} from "../lib/component-catalog.ts";
import { migrateOnly, testDatabase } from "./support/database.ts";
import { bikeRow, componentRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import { userRow } from "./support/people.ts";
import { one } from "./support/rows.ts";
import type { ComponentRow } from "../lib/database-rows.ts";
import { partLanding } from "../lib/experience-landing.ts";
import { searchExperience, searchInput } from "../lib/search.ts";

test("component catalog: populated upgrade, variants, privacy, durable links and administrative lifecycle", async () => {
  const db = await testDatabase({ migrated: false });
  const sql = (f: string) => migrateOnly(db, (name) => name === f);
  let owner = "",
    blocked: string;
  const bike = async (isPublic = true, user = owner) =>
    (
      await bikeRow(db, user, {
        brand: "Cube",
        model: "Travel",
        year: 2024,
        category: "road",
        is_public: isPublic,
      })
    ).id;
  const part = (bikeId: string, name: string, category = "Седло") =>
    componentRow(db, bikeId, {
      category,
      name,
      notes: "Author text",
      price: "1234",
    });
  const list = (input = {}) =>
    componentCatalog(db, componentCatalogInput.parse(input));
  const tx = db.transaction;
  const modelOf = async (componentId: string) =>
    present(
      (
        await one<{ model_id: string | null }>(
          db,
          "SELECT model_id FROM components WHERE id=$1",
          [componentId],
        )
      ).model_id,
    );
  const found = async (id: string | null) =>
    present(await resolveComponentModel(db, present(id)));
  const atPath = async (category: string, slug: string) =>
    present(await componentModelAtPath(db, category, slug));
  try {
    await migrateOnly(db, (f) => f < "028");
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify({
        ...defaultCatalog,
        aliases: [
          ...defaultCatalog.aliases,
          {
            kind: "component",
            scope: "Седло",
            alias: "Брукс C17",
            name: "Brooks C17",
          },
        ],
      }),
    ]);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    owner = (
      await userRow(db, {
        name: "admin",
        username: "catalog-admin",
        role: "admin",
      })
    ).id;
    blocked = (
      await userRow(db, {
        name: "blocked",
        username: "catalog-blocked",
        blocked: true,
      })
    ).id;
    const publicBike = await bike(),
      secondBike = await bike(),
      privateBike = await bike(false),
      blockedBike = await bike(true, blocked);
    const original = await part(publicBike, "Brooks C17"),
      alias = await part(secondBike, "Брукс C17");
    await part(publicBike, "BROOKS C17"); // Two installations on one bike count once.
    const variant = await part(publicBike, "Brooks C-17");
    const unknown = await part(privateBike, "Secret saddle 987");
    await part(privateBike, "Brooks C17");
    await part(blockedBike, "Brooks C17");
    await part(blockedBike, "Blocked exclusive");
    // Existing journal snapshots have no model_id. Preserve them byte-for-byte.
    const entry = randomUUID(),
      snapshot = [
        { id: original.id, category: original.category, name: original.name },
      ];
    await db.query(
      "INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,components,published_at) VALUES($1,$1,$2,$3,'build','Original story','Text','published',true,$4,now())",
      [entry, owner, publicBike, JSON.stringify(snapshot)],
    );
    await sql("028_component_models.sql");
    await sql("029_component_community.sql");
    await sql("030_market_catalog_links.sql");
    // Model edits write the description (#264).
    await sql("041_component_descriptions.sql");
    const migrated = await one<ComponentRow>(
      db,
      "SELECT * FROM components WHERE id=$1",
      [original.id],
    );
    const { model_id: migratedModel, ...unchanged } = migrated;
    const id = present(migratedModel);
    assert.deepEqual(unchanged, original);
    assert.equal(await modelOf(alias.id), id);
    assert.notEqual(
      await modelOf(variant.id),
      id,
      "punctuation variants are not guessed to be duplicates",
    );
    assert.deepEqual(
      (
        await db.query("SELECT components FROM journal_entries WHERE id=$1", [
          entry,
        ])
      ).rows[0].components,
      snapshot,
    );
    let result = await list();
    assert.equal(result.total, 2);
    assert.equal(result.items[0].builds, 2);
    assert.equal(result.items[0].brand, "Brooks");
    assert.deepEqual(result.brands, ["Brooks"]);
    assert(!JSON.stringify(result).includes("Secret"));
    const privateId = await modelOf(unknown.id);
    assert.equal(await resolveComponentModel(db, privateId), null);
    assert.equal(
      await componentModelAtPath(db, "седло", "secret-saddle-987"),
      null,
    );
    const photo = async (modelId: string, authorId: string, sort = 0) => {
      const photoId = randomUUID();
      await db.query(
        "INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height,sort_order) VALUES($1::uuid,$2,$3,$1::text,10,800,600,$4)",
        [photoId, modelId, authorId, sort],
      );
      return photoId;
    };
    const coverOf = async (modelId: string) =>
      (await list()).items.find((m) => m.id === modelId)?.coverUrl;
    assert.equal(await coverOf(id), null);
    const fallbackPhoto = await photo(id, owner, 1),
      coverPhoto = await photo(id, owner, 2);
    await db.query(
      "UPDATE component_models SET cover_photo_id=$2 WHERE id=$1",
      [id, coverPhoto],
    );
    assert.equal(await coverOf(id), "/api/components/media/" + coverPhoto);
    await db.query("UPDATE component_photos SET hidden=true WHERE id=$1", [
      coverPhoto,
    ]);
    assert.equal(
      await coverOf(id),
      "/api/components/media/" + fallbackPhoto,
      "hidden cover falls back to visible photo",
    );
    await db.query("UPDATE component_photos SET author_id=$2 WHERE id=$1", [
      fallbackPhoto,
      blocked,
    ]);
    assert.equal(
      await coverOf(id),
      null,
      "blocked author cannot supply a public cover",
    );
    await db.query("DELETE FROM component_photos WHERE model_id=$1", [id]);
    const initial = await found(id);
    assert.equal((await atPath("Седло", "Брукс C17")).id, id);

    // Colliding slugs get separate, stable addresses, not a silent merge.
    const plus = await part(publicBike, "Model+X"),
      space = await part(publicBike, "Model X");
    assert.notEqual(plus.model_id, space.model_id);
    const plusModel = await found(plus.model_id),
      spaceModel = await found(space.model_id);
    assert.notEqual(plusModel.slug, spaceModel.slug);
    assert.equal(
      (await atPath(spaceModel.category_slug, spaceModel.slug)).id,
      space.model_id,
    );

    await tx((q) =>
      editComponentModel(q, owner, id, {
        name: "Brooks C17 Classic",
        category: "Седло",
        brand: "Brooks",
        archived: false,
        version: initial.version,
      }),
    );
    assert.equal(
      (await atPath("седло", "brooks-c17")).slug,
      "brooks-c17-classic",
    );
    assert.equal(
      present(await partLanding(db, null, "седло", "brooks-c17")).builds,
      2,
    );
    assert.equal(
      (
        await searchExperience(
          db,
          null,
          searchInput.parse({ componentModelId: id, type: "journal" }),
        )
      ).total,
      1,
      "old snapshot resolves without rewriting history",
    );
    assert.equal(
      (await part(secondBike, "Brooks C17")).model_id,
      id,
      "old names stay bound after rename",
    );
    await assert.rejects(
      tx((q) =>
        editComponentModel(q, owner, id, {
          name: "Stale",
          category: "Седло",
          brand: "",
          archived: false,
          version: 1,
        }),
      ),
      /уже изменена/,
    );
    const beforeMerge = await found(plus.model_id),
      target = await found(space.model_id);
    await assert.rejects(
      tx((q) =>
        editComponentModel(q, owner, beforeMerge.id, {
          name: target.name,
          category: target.category,
          brand: "",
          archived: false,
          version: beforeMerge.version,
        }),
      ),
      /уже есть/,
    );
    // A future foreign content FK remains attached to the retained source ID.
    await db.exec(
      "CREATE TABLE catalog_test_content(model_id uuid REFERENCES component_models(id) ON DELETE RESTRICT, body text)",
    );
    await db.query(
      "INSERT INTO catalog_test_content VALUES($1,'future content')",
      [beforeMerge.id],
    );
    await tx((q) =>
      mergeComponentModels(q, owner, beforeMerge.id, {
        targetId: target.id,
        version: beforeMerge.version,
        targetVersion: target.version,
      }),
    );
    assert.equal((await found(beforeMerge.id)).id, target.id);
    assert.equal((await atPath("седло", beforeMerge.slug)).id, target.id);
    assert.equal(await modelOf(plus.id), beforeMerge.id);
    assert.equal(
      (await list({ q: "Model" })).items[0].builds,
      1,
      "merge counts distinct bikes, not installations",
    );
    await assert.rejects(
      db.query("DELETE FROM component_models WHERE id=$1", [beforeMerge.id]),
      /foreign key/,
    );
    await assert.rejects(
      tx((q) =>
        mergeComponentModels(q, owner, target.id, {
          targetId: beforeMerge.id,
          version: 2,
          targetVersion: 2,
        }),
      ),
      /недоступна/,
    );
    const mergedPhoto = await photo(beforeMerge.id, owner);
    assert.equal(
      await coverOf(target.id),
      "/api/components/media/" + mergedPhoto,
      "retained source photos supply the canonical model cover",
    );
    // Merge the survivor again: all historical IDs resolve directly, no cycle/chain.
    await tx((q) =>
      mergeComponentModels(q, owner, target.id, {
        targetId: id,
        version: 2,
        targetVersion: 2,
      }),
    );
    assert.equal((await found(beforeMerge.id)).id, id);
    assert.equal((await found(target.id)).id, id);
    await db.query("UPDATE bikes SET is_public=false WHERE id=ANY($1)", [
      [publicBike, secondBike],
    ]);
    let page = present(await partLanding(db, null, "седло", "brooks-c17"));
    assert.equal(page.builds, 0);
    assert.equal(page.bikes.length, 0);
    assert.equal(page.entries.length, 0);
    assert.equal(
      present((await found(id)).first_public_at).getTime(),
      present(initial.first_public_at).getTime(),
    );
    await db.query("DELETE FROM bikes WHERE id=ANY($1)", [
      [publicBike, secondBike],
    ]);
    page = present(await partLanding(db, null, "седло", "brooks-c17"));
    assert.equal(page.id, id);
    assert.equal(page.builds, 0);
    assert.equal(
      (await db.query("SELECT body FROM catalog_test_content")).rows[0].body,
      "future content",
    );
    await tx((q) =>
      editComponentModel(q, owner, id, {
        name: "Brooks C17 Classic",
        category: "Седло",
        brand: "Brooks",
        archived: true,
        version: 3,
      }),
    );
    assert(!(await list()).items.some((m) => m.id === id));
    assert.equal(
      (await atPath("седло", "brooks-c17")).id,
      id,
      "archive retains the page",
    );
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [
      privateBike,
    ]);
    assert.ok(
      await resolveComponentModel(db, privateId),
      "first publication activates private model",
    );
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [blocked]);
    assert.equal((await list({ q: "Blocked" })).total, 1);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
    assert.equal((await list({ q: "Blocked" })).items[0].builds, 0);
    const newPrivate = await bike(false);
    const changed = await part(newPrivate, "Before public edit");
    await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [newPrivate]);
    await db.query(
      "UPDATE components SET name='After public edit' WHERE id=$1",
      [changed.id],
    );
    assert.equal(
      (await list({ q: "After public edit" })).total,
      1,
      "component edits publish the new model",
    );

    for (let n = 0; n < 27; n++)
      await part(privateBike, "Catalog page " + n, "Педали");
    await part(privateBike, "Catalog page 100%_literal", "Педали");
    const filter = { q: "Catalog page", category: "Педали" };
    for (const sort of ["popular", "new"]) {
      const first = await list({ ...filter, sort }),
        second = await list({ ...filter, sort, page: 2 });
      assert.equal(first.total, 28);
      assert.equal(first.items.length, 24);
      assert.equal(second.items.length, 4);
      assert.equal(
        new Set([...first.items, ...second.items].map((m) => m.id)).size,
        28,
      );
      assert.deepEqual(
        (await list({ ...filter, sort })).items,
        first.items,
        "stable repeated ordering",
      );
      if (sort === "popular")
        assert.deepEqual(
          first.items.map((m) => m.id),
          [...first.items].map((m) => m.id).sort(),
        );
    }
    assert.equal(
      (await list({ q: "%_" })).total,
      1,
      "search metacharacters are literal",
    );
    assert.equal(
      (await list({ brand: "Brooks", category: "Педали" })).total,
      0,
    );
    result = await list({ q: "Catalog page" });
    assert(
      result.items.every(
        (m) =>
          Object.keys(m).sort().join() ===
          [
            "id",
            "category",
            "brand",
            "name",
            "path",
            "builds",
            "firstPublicAt",
            "coverUrl",
          ]
            .sort()
            .join(),
      ),
    );
  } finally {
    await db.close();
  }
});
