import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.js";
import {
  bikeCatalog,
  bikeCatalogInput,
  bikeModelAtPath,
  resolveBikeModel,
  editBikeModel,
  mergeBikeModels,
} from "../lib/bike-catalog.js";
import {
  listingBikeChoices,
  listingModelChoices,
} from "../lib/market-links.js";
import {
  listingInput,
  saveListing,
  marketDetail,
  marketList,
  setListingSaved,
  savedListings,
  sellerListings,
  marketContact,
  extendListing,
} from "../lib/market.js";
import {
  editComponentModel,
  mergeComponentModels,
  resolveComponentModel,
} from "../lib/component-catalog.js";
import { modelLanding } from "../lib/experience-landing.js";
import { socialMetadata } from "../lib/social-metadata.js";
import { loadSocialPreview } from "../lib/social-preview.js";

const offer = (extra = {}) =>
  listingInput.parse({
    title: "My advertisement",
    description: "My independent description",
    category: "bikes",
    condition: "used",
    price: 123,
    location: "City",
    contact: "private contact",
    status: "active",
    ...extra,
  });
test("market catalog: populated migration, independent fields, private/foreign bicycles and durable identities", async () => {
  const db = new PGlite(),
    owner = randomUUID(),
    other = randomUUID(),
    admin = randomUUID();
  const sql = async (f) =>
    db.exec(await readFile(new URL("../db/" + f, import.meta.url), "utf8"));
  const tx = (fn) => db.transaction(fn);
  const bike = async (name, pub = true, who = owner, brand = "Cube") => {
    const id = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public) VALUES($1,$1,$2,$3,$4,$3,2024,'road',$5)",
      [id, who, name, brand, pub],
    );
    return (await db.query("SELECT * FROM bikes WHERE id=$1", [id])).rows[0];
  };
  const save = (extra = {}, id) =>
    tx((q) => saveListing(q, owner, offer(extra), id));
  const detail = (m, viewer = null) => marketDetail(db, m.shareId, viewer);
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && f < "030")
      .sort())
      await sql(f);
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify({
        ...defaultCatalog,
        aliases: [
          ...defaultCatalog.aliases,
          { kind: "brand", alias: "Куб", name: "Cube" },
          { kind: "model", scope: "Cube", alias: "Тревел", name: "Travel" },
        ],
      }),
    ]);
    for (const id of [owner, other, admin])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$3,$3,'x',$2)",
        [id, id === admin ? "admin" : "user", id],
      );
    const original = await bike("Travel"),
      alias = await bike("Тревел", true, owner, "Куб"),
      hidden = await bike("Secret bike", false),
      foreign = await bike("Foreign bike", true, other);
    const oldId = randomUUID();
    await db.query(
      "INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,status) VALUES($1,$1,$2,'Legacy','Legacy description','bikes','used','sold')",
      [oldId, owner],
    );
    const before = (
      await db.query("SELECT * FROM market_listings WHERE id=$1", [oldId])
    ).rows[0];
    await sql("030_market_catalog_links.sql");
    // Model edits write the description (#264).
    await sql("041_component_descriptions.sql");
    const migrated = (
      await db.query("SELECT * FROM market_listings WHERE id=$1", [oldId])
    ).rows[0];
    const { component_model_id, bike_model_id, linked_bike_id, ...same } =
      migrated;
    assert.deepEqual(same, before);
    assert.equal(component_model_id, null);
    assert.equal(bike_model_id, null);
    assert.equal(linked_bike_id, null);
    const { catalog_model_id: modelId, ...unchanged } = (
      await db.query("SELECT * FROM bikes WHERE id=$1", [original.id])
    ).rows[0];
    assert.deepEqual(unchanged, original);
    assert.equal(
      (
        await db.query("SELECT catalog_model_id FROM bikes WHERE id=$1", [
          alias.id,
        ])
      ).rows[0].catalog_model_id,
      modelId,
    );
    const hiddenId = (
      await db.query("SELECT catalog_model_id FROM bikes WHERE id=$1", [
        hidden.id,
      ])
    ).rows[0].catalog_model_id;
    assert.equal(await resolveBikeModel(db, hiddenId), null);
    assert(
      !(await bikeCatalog(db, bikeCatalogInput.parse({}))).items.some(
        (m) => m.id === hiddenId,
      ),
    );
    const privateOffer = await save({
      bikeModelId: modelId,
      linkedBikeId: hidden.id,
    });
    const mine = await detail(privateOffer, owner);
    assert.equal(mine.ownedBike.name, "Secret bike");
    assert.equal(mine.ownedBike.path, null);
    const publicOffer = await save({
      bikeModelId: modelId,
      linkedBikeId: original.id,
    });
    assert.equal((await detail(publicOffer)).linkedBike.name, original.name);
    const anonymous = await detail(privateOffer);
    assert.equal(anonymous.linkedBike, null);
    assert(!("linkedBikeId" in anonymous));
    assert(!("ownedBike" in anonymous));
    await tx((q) => setListingSaved(q, privateOffer.id, other, true));
    for (const result of [
      anonymous,
      await marketList(db, other),
      await savedListings(db, other),
      await sellerListings(db, publicOffer.id, other),
    ]) {
      const json = JSON.stringify(result);
      for (const secret of [
        hidden.id,
        "Secret bike",
        hidden.share_id,
        "private contact",
      ])
        assert(!json.includes(secret), secret);
    }
    for (const linkedBikeId of [foreign.id, randomUUID()])
      await assert.rejects(save({ linkedBikeId }), { status: 404 });
    await assert.rejects(save({ bikeModelId: hiddenId }), { status: 404 });
    await assert.rejects(save({ bikeModelId: randomUUID() }), { status: 404 });
    await assert.rejects(
      save({ category: "components", bikeModelId: modelId }),
      { status: 400 },
    );
    assert.equal((await listingBikeChoices(db, owner)).items.length, 3);
    const term = mine.expiresAt;
    await save({}, privateOffer.id); // Older clients omit new fields: retain them.
    assert.equal((await detail(privateOffer, owner)).linkedBikeId, hidden.id);
    assert.equal(
      new Date((await detail(privateOffer, owner)).expiresAt).getTime(),
      new Date(term).getTime(),
    );
    const initial = await resolveBikeModel(db, modelId);
    await assert.rejects(
      tx((q) =>
        editBikeModel(q, other, modelId, {
          brand: "Cube",
          name: "No",
          archived: false,
          version: 1,
        }),
      ),
      { status: 403 },
    );
    await tx((q) =>
      editBikeModel(q, admin, modelId, {
        brand: "Cube",
        name: "Travel Revised",
        archived: false,
        version: initial.version,
      }),
    );
    assert.equal((await bikeModelAtPath(db, "Куб", "Тревел")).id, modelId);
    assert.equal(
      (await bikeModelAtPath(db, "Cube", "Travel")).name,
      "Travel Revised",
    );
    let d = await detail(privateOffer);
    assert.equal(d.bikeModel.name, "Cube Travel Revised");
    assert.equal(d.title, offer().title);
    assert.equal(d.description, offer().description);
    assert.equal(Number(d.price), 123);
    assert.equal((await modelLanding(db, null, "cube", "travel")).builds, 2);
    const plus = await bike("Variant+X"),
      space = await bike("Variant X"),
      target = await resolveBikeModel(db, space.catalog_model_id);
    assert.notEqual(plus.catalog_model_id, space.catalog_model_id);
    assert.notEqual(
      (await resolveBikeModel(db, plus.catalog_model_id)).slug,
      target.slug,
    );
    await assert.rejects(
      tx((q) =>
        editBikeModel(q, admin, modelId, {
          brand: "Cube",
          name: "Travel",
          archived: false,
          version: 1,
        }),
      ),
      { status: 409 },
    );
    await tx((q) =>
      mergeBikeModels(q, admin, modelId, {
        targetId: target.id,
        version: 2,
        targetVersion: 1,
      }),
    );
    assert.equal((await detail(privateOffer)).bikeModel.id, target.id);
    assert.equal((await bikeModelAtPath(db, "cube", "travel")).id, target.id);
    assert.equal((await modelLanding(db, null, "cube", "travel")).builds, 3);
    assert.equal(
      (
        await db.query(
          "SELECT bike_model_id FROM market_listings WHERE id=$1",
          [privateOffer.id],
        )
      ).rows[0].bike_model_id,
      modelId,
    );
    await tx((q) =>
      editBikeModel(q, admin, target.id, {
        brand: target.brand,
        name: target.name,
        archived: true,
        version: 2,
      }),
    );
    await assert.rejects(save({ bikeModelId: target.id }), { status: 404 });
    await save({ bikeModelId: target.id }, privateOffer.id); // Existing canonical link can be kept after merge/archive.
    assert.equal((await detail(privateOffer)).bikeModel.archived, true);
    assert(
      !(await listingModelChoices(db, "bikes", "Variant X")).items.some(
        (m) => m.id === target.id,
      ),
    );
    await db.query("UPDATE bikes SET is_public=false WHERE owner_id=$1", [
      owner,
    ]);
    assert.equal((await detail(publicOffer)).linkedBike, null);
    assert.equal((await modelLanding(db, null, "cube", "travel")).builds, 0);
    await db.query("DELETE FROM bikes WHERE owner_id=$1", [owner]);
    assert.equal((await detail(privateOffer, owner)).linkedBikeId, null);
    assert.equal((await detail(publicOffer)).bikeModel.id, target.id);
    assert.equal(
      (await modelLanding(db, null, "cube", "travel")).id,
      target.id,
    );
    await assert.rejects(
      db.query("DELETE FROM bike_models WHERE id=$1", [target.id]),
      /foreign key/,
    );
    await save({ bikeModelId: null }, publicOffer.id);
    assert.equal((await detail(publicOffer)).bikeModel, null);
    await save({ category: "accessories" }, privateOffer.id);
    assert.equal((await detail(privateOffer)).bikeModel, null);
    // Component references use #145's existing IDs and survive the same lifecycle.
    const b = await bike("Parts"),
      partId = randomUUID();
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло','Brooks Test')",
      [partId, b.id],
    );
    const cId = (
      await db.query("SELECT model_id FROM components WHERE id=$1", [partId])
    ).rows[0].model_id;
    const c = await resolveComponentModel(db, cId),
      offerC = await save({ category: "components", componentModelId: cId });
    await tx((q) =>
      editComponentModel(q, admin, cId, {
        name: "Brooks Renamed",
        category: c.category,
        brand: c.brand,
        archived: false,
        version: c.version,
      }),
    );
    assert.equal((await detail(offerC)).componentModel.name, "Brooks Renamed");
    const p2 = randomUUID();
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло','Other Saddle')",
      [p2, b.id],
    );
    const c2 = (
      await db.query("SELECT model_id FROM components WHERE id=$1", [p2])
    ).rows[0].model_id;
    await tx((q) =>
      mergeComponentModels(q, admin, cId, {
        targetId: c2,
        version: 2,
        targetVersion: 1,
      }),
    );
    assert.equal((await detail(offerC)).componentModel.id, c2);
    await db.query("DELETE FROM bikes WHERE id=$1", [b.id]);
    assert.equal((await detail(offerC)).componentModel.id, c2);
    // Expiry/sold/contact behavior and old unlinked ads keep their previous contracts.
    await db.query(
      "UPDATE market_listings SET expires_at=now()-interval '1 day' WHERE id=$1",
      [offerC.id],
    );
    assert.equal((await detail(offerC)).expired, true);
    await assert.rejects(marketContact(db, offerC.shareId, other), {
      status: 404,
    });
    assert.equal(
      socialMetadata(await loadSocialPreview(db, "market", offerC.shareId), {
        APP_ORIGIN: "https://example.test",
      }).robots.index,
      false,
    );
    await tx((q) => extendListing(q, offerC.id, owner));
    assert.equal((await detail(offerC)).expired, false);
    await save({ category: "components", status: "sold" }, offerC.id);
    assert.equal((await detail(offerC)).componentModel.id, c2);
    assert.equal((await marketDetail(db, oldId, null)).status, "sold");
  } finally {
    await db.close();
  }
});
