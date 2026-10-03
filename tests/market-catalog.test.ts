import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.ts";
import {
  bikeCatalog,
  bikeCatalogInput,
  bikeModelAtPath,
  resolveBikeModel,
  editBikeModel,
  mergeBikeModels,
} from "../lib/bike-catalog.ts";
import {
  listingBikeChoices,
  listingModelChoices,
} from "../lib/market-links.ts";
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
} from "../lib/market.ts";
import {
  editComponentModel,
  mergeComponentModels,
  resolveComponentModel,
} from "../lib/component-catalog.ts";
import { migrateOnly, testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import { processEnv } from "./support/env.ts";
import type { BikeRow, MarketRow } from "../lib/database-rows.ts";
import { userRow } from "./support/people.ts";
import { one } from "./support/rows.ts";
import { modelLanding } from "../lib/experience-landing.ts";
import { socialMetadata } from "../lib/social-metadata.ts";
import { loadSocialPreview } from "../lib/social-preview.ts";

const offer = (extra: Partial<z.input<typeof listingInput>> = {}) =>
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
  const db = await testDatabase({ migrated: false });
  let owner = "",
    other = "",
    admin = "";
  const sql = (f: string) => migrateOnly(db, (name) => name === f);
  const tx = db.transaction;
  const catalogModelOf = async (bikeId: string) =>
    present(
      (
        await one<{ catalog_model_id: string | null }>(
          db,
          "SELECT catalog_model_id FROM bikes WHERE id=$1",
          [bikeId],
        )
      ).catalog_model_id,
    );
  const foundBike = async (id: string | null) =>
    present(await resolveBikeModel(db, present(id)));
  const bikeAt = async (brand: string, name: string) =>
    present(await bikeModelAtPath(db, brand, name));
  const bike = async (name: string, pub = true, who = owner, brand = "Cube") =>
    bikeRow(db, who, {
      name,
      brand,
      model: name,
      year: 2024,
      category: "road",
      is_public: pub,
    });
  const save = (
    extra: Partial<z.input<typeof listingInput>> = {},
    id?: string,
  ) => tx((q) => saveListing(q, owner, offer(extra), id));
  const detail = (m: { shareId: string }, viewer: string | null = null) =>
    marketDetail(db, m.shareId, viewer);
  try {
    await migrateOnly(db, (f) => f < "030");
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
    owner = (await userRow(db, { username: "market-owner" })).id;
    other = (await userRow(db, { username: "market-other" })).id;
    admin = (await userRow(db, { username: "market-admin", role: "admin" })).id;
    const original = await bike("Travel"),
      alias = await bike("Тревел", true, owner, "Куб"),
      hidden = await bike("Secret bike", false),
      foreign = await bike("Foreign bike", true, other);
    const oldId = randomUUID();
    await db.query(
      "INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,status) VALUES($1,$1,$2,'Legacy','Legacy description','bikes','used','sold')",
      [oldId, owner],
    );
    const before = await one<MarketRow>(
      db,
      "SELECT * FROM market_listings WHERE id=$1",
      [oldId],
    );
    await sql("030_market_catalog_links.sql");
    // Model edits write the description (#264).
    await sql("041_component_descriptions.sql");
    const migrated = await one<MarketRow>(
      db,
      "SELECT * FROM market_listings WHERE id=$1",
      [oldId],
    );
    const { component_model_id, bike_model_id, linked_bike_id, ...same } =
      migrated;
    assert.deepEqual(same, before);
    assert.equal(component_model_id, null);
    assert.equal(bike_model_id, null);
    assert.equal(linked_bike_id, null);
    const { catalog_model_id: catalogModel, ...unchanged } = await one<BikeRow>(
      db,
      "SELECT * FROM bikes WHERE id=$1",
      [original.id],
    );
    const modelId = present(catalogModel);
    assert.deepEqual(unchanged, original);
    assert.equal(await catalogModelOf(alias.id), modelId);
    const hiddenId = await catalogModelOf(hidden.id);
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
    assert.equal(present(mine.ownedBike).name, "Secret bike");
    assert.equal(present(mine.ownedBike).path, null);
    const publicOffer = await save({
      bikeModelId: modelId,
      linkedBikeId: original.id,
    });
    assert.equal(
      present((await detail(publicOffer)).linkedBike).name,
      original.name,
    );
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
      new Date(
        present((await detail(privateOffer, owner)).expiresAt),
      ).getTime(),
      new Date(present(term)).getTime(),
    );
    const initial = await foundBike(modelId);
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
    assert.equal((await bikeAt("Куб", "Тревел")).id, modelId);
    assert.equal((await bikeAt("Cube", "Travel")).name, "Travel Revised");
    let d = await detail(privateOffer);
    assert.equal(present(d.bikeModel).name, "Cube Travel Revised");
    assert.equal(d.title, offer().title);
    assert.equal(d.description, offer().description);
    assert.equal(Number(d.price), 123);
    assert.equal(
      present(await modelLanding(db, null, "cube", "travel")).builds,
      2,
    );
    const plus = await bike("Variant+X"),
      space = await bike("Variant X"),
      target = await foundBike(space.catalog_model_id);
    assert.notEqual(plus.catalog_model_id, space.catalog_model_id);
    assert.notEqual((await foundBike(plus.catalog_model_id)).slug, target.slug);
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
    assert.equal(present((await detail(privateOffer)).bikeModel).id, target.id);
    assert.equal((await bikeAt("cube", "travel")).id, target.id);
    assert.equal(
      present(await modelLanding(db, null, "cube", "travel")).builds,
      3,
    );
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
    assert.equal(
      present((await detail(privateOffer)).bikeModel).archived,
      true,
    );
    assert(
      !(await listingModelChoices(db, "bikes", "Variant X")).items.some(
        (m) => m.id === target.id,
      ),
    );
    await db.query("UPDATE bikes SET is_public=false WHERE owner_id=$1", [
      owner,
    ]);
    assert.equal((await detail(publicOffer)).linkedBike, null);
    assert.equal(
      present(await modelLanding(db, null, "cube", "travel")).builds,
      0,
    );
    await db.query("DELETE FROM bikes WHERE owner_id=$1", [owner]);
    assert.equal((await detail(privateOffer, owner)).linkedBikeId, null);
    assert.equal(present((await detail(publicOffer)).bikeModel).id, target.id);
    assert.equal(
      present(await modelLanding(db, null, "cube", "travel")).id,
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
    const componentModelOf = async (componentId: string) =>
      present(
        (
          await one<{ model_id: string | null }>(
            db,
            "SELECT model_id FROM components WHERE id=$1",
            [componentId],
          )
        ).model_id,
      );
    const cId = await componentModelOf(partId);
    const c = present(await resolveComponentModel(db, cId)),
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
    assert.equal(
      present((await detail(offerC)).componentModel).name,
      "Brooks Renamed",
    );
    const p2 = randomUUID();
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло','Other Saddle')",
      [p2, b.id],
    );
    const c2 = await componentModelOf(p2);
    await tx((q) =>
      mergeComponentModels(q, admin, cId, {
        targetId: c2,
        version: 2,
        targetVersion: 1,
      }),
    );
    assert.equal(present((await detail(offerC)).componentModel).id, c2);
    await db.query("DELETE FROM bikes WHERE id=$1", [b.id]);
    assert.equal(present((await detail(offerC)).componentModel).id, c2);
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
      socialMetadata(
        await loadSocialPreview(db, "market", offerC.shareId),
        processEnv({ APP_ORIGIN: "https://example.test" }),
      ).robots?.index,
      false,
    );
    await tx((q) => extendListing(q, offerC.id, owner));
    assert.equal((await detail(offerC)).expired, false);
    await save({ category: "components", status: "sold" }, offerC.id);
    assert.equal(present((await detail(offerC)).componentModel).id, c2);
    assert.equal((await marketDetail(db, oldId, null)).status, "sold");
  } finally {
    await db.close();
  }
});
