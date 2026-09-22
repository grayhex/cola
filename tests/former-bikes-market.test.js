import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { bikeInput } from "../lib/validation.js";
import { insertBike, hydrate, ownedBike } from "../lib/repository.js";
import { showcase } from "../lib/showcase.js";
import { publicBike } from "../lib/public-dto.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { previewRide, saveRide, planRide, importGarmin, rideDefaults, rideDetail, deleteRide } from "../lib/rides.js";
import { getOriginal } from "../lib/ride-storage.js";
import { parseGarminCsv } from "../lib/garmin-csv.js";
import { listingInput, saveListing, marketList, marketDetail } from "../lib/market.js";
import { listingPriceLabel } from "../lib/market-types.js";
import { garminCsv } from "./garmin-fixtures.js";
import { gpx, loop } from "./ride-fixtures.js";

const inputBike = (extra = {}) => bikeInput.parse({
  name: "Ownership fixture", brand: "Test", model: "Model", year: 2021,
  category: "mtb", description: "", color: "", size: "L", weight: 12,
  is_public: true, ...extra,
});
const offer = (extra = {}) => listingInput.parse({
  title: "Test wheel", description: "Synthetic listing", category: "components",
  condition: "used", price: 1000, location: "Test city", contact: "", status: "active", ...extra,
});
async function schema(db, beforeNew = false) {
  for (const f of (await readdir(new URL("../db/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort()) {
    if (beforeNew && f === "021_former_bikes_market_types.sql") continue;
    await db.exec(await readFile(new URL("../db/" + f, import.meta.url), "utf8"));
  }
  await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [JSON.stringify(defaultSettings)]);
  await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [JSON.stringify(defaultCatalog)]);
}
async function user(db, username) {
  const id = randomUUID();
  await db.query("INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$3)", [id, id + "@example.test", username]);
  return id;
}
const formerError = (error) => error.status === 409 && /бывшего велосипеда/.test(error.message);

test("ownership status blocks every new ride path before writes and preserves existing GPX/history", async () => {
  const db = new PGlite();
  const dir = await mkdtemp(path.join(tmpdir(), "cola-ownership-"));
  const oldDir = process.env.RIDES_DIR;
  process.env.RIDES_DIR = dir;
  try {
    await schema(db);
    const owner = await user(db, "feature_owner"), other = await user(db, "feature_other");
    const current = await db.transaction((q) => insertBike(q, owner, inputBike()));
    const former = await db.transaction((q) => insertBike(q, owner, inputBike({ name: "Old bicycle", is_former: true })));
    const row = await ownedBike(db, former, owner);
    assert.equal(row.is_former, true);
    assert.equal(row.category, "mtb");
    assert.equal((await hydrate(db, row)).is_former, true);
    assert.equal((await showcase(db, null)).bikes.find((b) => b.id === former).is_former, true);
    const dto = publicBike({ ...row, price: 321, factory_spec: { secret: "private" }, show_bike_price: false });
    assert.equal(dto.is_former, true);
    assert.equal("owner_id" in dto, false);
    assert.equal("factory_spec" in dto, false);
    assert.equal("price" in dto, false);
    assert.equal(bikeInput.safeParse({ ...inputBike(), is_former: "true" }).success, false);
    const bytes = gpx([loop]);
    const preview = await db.transaction((q) => previewRide(q, owner, bytes, rideDefaults));
    const base = { bikeId: former, title: "Old route", description: "", isPublic: true, privacyEnabled: false, privacyRadiusM: 500, previewId: preview.previewId };
    const beforeFiles = (await readdir(dir)).sort();
    await assert.rejects(db.transaction((q) => saveRide(q, owner, base, rideDefaults)), formerError);
    const planned = { bikeId: former, title: "Future route", description: "", isPublic: false, privacyEnabled: false, privacyRadiusM: 500, scheduledAt: new Date(Date.now() + 86400000).toISOString(), invitations: ["feature_other"] };
    await assert.rejects(db.transaction((q) => planRide(q, owner, planned, rideDefaults)), formerError);
    await assert.rejects(db.transaction((q) => planRide(q, owner, { ...planned, previewId: preview.previewId }, rideDefaults)), formerError);
    const csv = parseGarminCsv(garminCsv());
    await assert.rejects(db.transaction((q) => importGarmin(q, owner, { bikeId: former, selected: [0], visibleMetrics: [], isPublic: false }, csv, rideDefaults)), formerError);
    assert.equal((await db.query("SELECT count(*)::int n FROM rides")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM ride_invitations")).rows[0].n, 0);
    assert.deepEqual((await readdir(dir)).sort(), beforeFiles);
    await assert.rejects(db.transaction((q) => planRide(q, other, { ...planned, bikeId: current }, rideDefaults)), /свой велосипед/);

    const ride = await db.transaction((q) => saveRide(q, owner, { ...base, bikeId: current }, rideDefaults));
    assert.deepEqual(await getOriginal(ride.id), bytes);
    // Moving an existing ride onto a former bicycle is not a bypass.
    await assert.rejects(db.transaction((q) => saveRide(q, owner, base, rideDefaults, ride.id)), formerError);
    await db.query("UPDATE bikes SET is_former=true WHERE id=$1", [current]);
    assert.equal((await rideDetail(db, ride.shareId, null)).title, base.title);
    await db.transaction((q) => saveRide(q, owner, { ...base, bikeId: current, description: "Retained history" }, rideDefaults, ride.id));
    assert.deepEqual(await getOriginal(ride.id), bytes);
    await db.transaction((q) => saveRide(q, owner, { ...base, bikeId: current, isPublic: false, privacyEnabled: true }, rideDefaults, ride.id));
    await assert.rejects(rideDetail(db, ride.shareId, null), /недоступна/);
    await assert.rejects(db.transaction((q) => saveRide(q, owner, { ...base, bikeId: current }, rideDefaults, ride.id)), formerError);
    const existing = await rideDetail(db, ride.shareId, owner, true);
    assert.equal(existing.privacyEnabled, true);
    assert.equal(existing.bike.id, current);
    assert.deepEqual(await getOriginal(ride.id), bytes);
    await db.query("UPDATE bikes SET is_former=false WHERE id=$1", [former]);
    await db.transaction((q) => planRide(q, owner, planned, rideDefaults));
    assert.equal((await db.query("SELECT count(*)::int n FROM rides")).rows[0].n, 2);
    await db.transaction((q) => deleteRide(q, owner, ride.id));
    assert.equal((await db.query("SELECT count(*)::int n FROM rides WHERE id=$1", [ride.id])).rows[0].n, 0);
  } finally {
    await db.close();
    if (oldDir === undefined) delete process.env.RIDES_DIR; else process.env.RIDES_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("market intent, combined filters, pagination, rubles and ownership use the real schema", async () => {
  const db = new PGlite();
  try {
    await schema(db);
    const owner = await user(db, "market_owner"), other = await user(db, "market_other");
    const created = {};
    for (const listingType of ["sale", "wanted", "exchange", "free"])
      created[listingType] = await db.transaction((q) => saveListing(q, owner, offer({ listingType, price: listingType === "wanted" || listingType === "exchange" ? null : 50 })));
    for (const [type, value] of Object.entries(created)) {
      const listing = await marketDetail(db, value.shareId, null);
      assert.equal(listing.listingType, type);
      assert.equal(listing.currency, "RUB");
      assert.equal(listing.isOwner, false);
      assert.equal("owner_id" in listing, false);
    }
    const free = await marketDetail(db, created.free.shareId, null);
    assert.equal(free.price, 0);
    assert.equal(listingPriceLabel(free), "Бесплатно");
    await db.transaction((q) => saveListing(q, owner, offer({ price: 123 }), created.free.id));
    assert.equal((await marketDetail(db, created.free.shareId, null)).listingType, "free");
    assert.equal((await marketDetail(db, created.free.shareId, null)).price, 0);
    await assert.rejects(db.query("UPDATE market_listings SET price=12 WHERE id=$1", [created.free.id]), /market_free_price/);
    await assert.rejects(db.transaction((q) => saveListing(q, other, offer(), created.free.id)), /недоступно/);
    for (const currency of ["USD", "EUR"])
      assert.equal(listingInput.safeParse({ ...offer(), currency }).success, false);
    assert.equal(listingInput.safeParse({ ...offer(), listingType: "unknown" }).success, false);
    const filtered = await marketList(db, null, { listingType: "wanted", category: "components", condition: "used", search: "wheel" });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, created.wanted.id);
    assert.equal((await marketList(db, null, { listingType: "wanted", condition: "new" })).total, 0);
    assert.equal((await marketList(db, null, { search: "%_'" })).total, 0);
    const hidden = await db.transaction((q) => saveListing(q, owner, offer({ listingType: "wanted", status: "draft" })));
    assert.equal((await marketList(db, null, { listingType: "wanted" })).total, 1);
    assert.equal((await marketList(db, owner, { own: true, listingType: "wanted" })).total, 2);
    assert.equal((await marketList(db, other, { own: true, listingType: "wanted" })).total, 0);
    await assert.rejects(marketDetail(db, hidden.shareId, other), /недоступно/);
    for (let i = 0; i < 25; i++)
      await db.transaction((q) => saveListing(q, owner, offer({ listingType: "wanted", title: "Pagination " + i })));
    const first = await marketList(db, null, { listingType: "wanted", search: "Pagination", page: 1 });
    const second = await marketList(db, null, { listingType: "wanted", search: "Pagination", page: 2 });
    assert.equal(first.total, 25);
    assert.equal(second.total, 25);
    assert.equal(first.items.length, 24);
    assert.equal(second.items.length, 1);
    assert.equal(new Set([...first.items, ...second.items].map((r) => r.id)).size, 25);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
    assert.equal((await marketList(db, null, { listingType: "wanted" })).total, 0);
    await assert.rejects(marketDetail(db, created.free.shareId, null), /недоступно/);
  } finally { await db.close(); }
});

test("migration 021 keeps existing bikes, planned history and foreign-currency amounts unchanged", async () => {
  const db = new PGlite();
  try {
    await schema(db, true);
    const owner = await user(db, "upgrade_owner");
    const bike = await db.transaction((q) => insertBike(q, owner, inputBike()));
    const ride = await db.transaction((q) => planRide(q, owner, {
      bikeId: bike, title: "Existing plan", description: "", isPublic: true,
      privacyEnabled: false, privacyRadiusM: 500, scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    }, rideDefaults));
    const listing = randomUUID();
    await db.query("INSERT INTO market_listings(id,share_id,owner_id,title,category,condition,price,currency,status) VALUES($1,$1,$2,'Existing listing','bikes','used',100,'USD','active')", [listing, owner]);
    const before = (await db.query("SELECT * FROM rides WHERE id=$1", [ride.id])).rows[0];
    await db.exec(await readFile(new URL("../db/021_former_bikes_market_types.sql", import.meta.url), "utf8"));
    assert.equal((await ownedBike(db, bike, owner)).is_former, false);
    assert.deepEqual((await db.query("SELECT * FROM rides WHERE id=$1", [ride.id])).rows[0], before);
    const old = await marketDetail(db, listing, null);
    assert.equal(old.listingType, "sale");
    assert.equal(old.price, 100);
    assert.equal(old.currency, "USD");
    assert.match(listingPriceLabel(old), /уточнения/);
    assert.equal((await db.query("SELECT count(*)::int n FROM users")).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM bikes")).rows[0].n, 1);
  } finally { await db.close(); }
});
