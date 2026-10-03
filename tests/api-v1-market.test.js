import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  marketApiDetail,
  marketContact,
  marketKeysetPage,
  marketList,
  sellerApiListings,
  setListingSaved,
} from "../lib/market.ts";
import {
  decodeMarketCursor,
  encodeCursor,
  encodeMarketCursor,
} from "../lib/api-v1/cursor.ts";
import {
  marketListingDetailSchema,
  marketListingSchema,
  marketOthersSchema,
  parseMarketQuery,
} from "../lib/api-v1/schemas.ts";
import {
  toMarketListing,
  toMarketListingDetail,
} from "../lib/api-v1/mappers.ts";

// API v1, the market (#319): the keyset list in three orders, the filters of
// the site, who may read which listing, the contact asked for one by one and
// the seller's other listings. The server end to end is
// tests/api-v1-market-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

const run = randomUUID().slice(0, 6);
const day = (n, micro = 100) =>
  `2026-09-${String(n).padStart(2, "0")}T10:00:00.${String(micro).padStart(6, "0")}Z`;
async function addUser(label, blocked = false) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,$3,'hash',$4,$5)",
    [
      id,
      id + "@test.invalid",
      "Имя " + label,
      (label + "-" + id.slice(0, 8)).toLowerCase(),
      blocked,
    ],
  );
  return id;
}
async function addListing(owner, options = {}) {
  const id = randomUUID();
  const status = options.status ?? "active";
  await db.query(
    `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,location,contact,status,listing_type,published_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RUB',$9,$10,$11,$12,$13,$14)`,
    [
      id,
      randomUUID(),
      owner,
      options.title ?? "Лот " + id.slice(0, 6),
      options.description ?? "Описание",
      options.category ?? "components",
      options.condition ?? "used",
      options.price === undefined ? 1000 : options.price,
      options.location ?? "Москва",
      options.contact ?? "tg: @seller_" + id.slice(0, 4),
      status,
      options.type ?? "sale",
      status === "draft" ? null : (options.at ?? day(10)),
      status === "active" ? (options.expires ?? "2099-01-01T00:00:00Z") : null,
    ],
  );
  return id;
}
const page = (viewer, extra = {}) =>
  marketKeysetPage(db, viewer, {
    sort: "new",
    limit: 50,
    after: null,
    ...extra,
  });
const ids = (result) => result.items.map((item) => item.id);

const seller = await addUser("seller");
const other = await addUser("other");
const barred = await addUser("barred", true);
const reader = await addUser("reader");

const a = await addListing(seller, {
  at: day(1),
  price: 500,
  title: `Ar ${run}`,
});
const b = await addListing(seller, {
  at: day(2),
  price: 100,
  category: "bikes",
});
// Same price and same instant: the id is the last word.
const c = await addListing(other, { at: day(3), price: 100, type: "wanted" });
const d = await addListing(other, { at: day(3), price: 100, condition: "new" });
const free = await addListing(other, { at: day(4), price: 0, type: "free" });
const noPrice1 = await addListing(seller, {
  at: day(5),
  price: null,
  type: "exchange",
});
const noPrice2 = await addListing(other, {
  at: day(6),
  price: null,
  location: "Казань",
});
const sold = await addListing(seller, { status: "sold", at: day(7) });
const expired = await addListing(seller, {
  at: day(8),
  expires: "2020-01-01T00:00:00Z",
});
const draft = await addListing(seller, { status: "draft" });
const hidden = await addListing(barred, { at: day(9) });
const live = [a, b, c, d, free, noPrice1, noPrice2];

async function walk(sort, limit, extra = {}) {
  const seen = [];
  let after = null;
  for (let guard = 0; guard < 20; guard++) {
    const result = await page(reader, { sort, limit, after, ...extra });
    seen.push(...ids(result));
    if (!result.next) return seen;
    // The cursor survives its own text form, as a client keeps it.
    after = decodeMarketCursor(encodeMarketCursor(result.next), sort !== "new");
  }
  throw new Error("the walk does not end");
}

test("the list holds exactly what is on the market, newest first", async () => {
  const all = ids(await page(reader));
  assert.deepEqual([...all].sort(), [...live].sort());
  for (const gone of [sold, expired, draft, hidden])
    assert.ok(!all.includes(gone));
  // The site's own order for the same filter.
  const legacy = await marketList(db, reader, {});
  assert.deepEqual(
    all,
    legacy.items.map((item) => item.id),
  );
});

test("a keyset walk in every order is the site's order, with no repeats and no gaps", async () => {
  for (const sort of ["new", "price_asc", "price_desc"]) {
    const expected = (await marketList(db, reader, { sort })).items.map(
      (item) => item.id,
    );
    for (const limit of [1, 2, 3, 7, 50])
      assert.deepEqual(await walk(sort, limit), expected, `${sort}/${limit}`);
  }
  // Listings without a price come last in both price orders.
  const ascending = await walk("price_asc", 50);
  assert.deepEqual(ascending.slice(-2).sort(), [noPrice1, noPrice2].sort());
  const descending = await walk("price_desc", 50);
  assert.deepEqual(descending.slice(-2).sort(), [noPrice1, noPrice2].sort());
  assert.equal(descending[0], a);
});

test("filters are the site's", async () => {
  const only = async (extra) => (await walk("new", 3, extra)).sort();
  assert.deepEqual(await only({ listingType: "wanted" }), [c]);
  assert.deepEqual(await only({ category: "bikes" }), [b]);
  assert.deepEqual(await only({ condition: "new" }), [d]);
  assert.deepEqual(await only({ city: "казань" }), [noPrice2]);
  assert.deepEqual(await only({ search: run }), [a]);
  // A price bound leaves out listings without a price.
  assert.deepEqual(
    await only({ priceMin: 100, priceMax: 100 }),
    [b, c, d].sort(),
  );
  assert.deepEqual(await only({ priceMax: 0 }), [free]);
  const username = (
    await db.query("SELECT username FROM users WHERE id=$1", [other])
  ).rows[0].username;
  assert.deepEqual(
    await only({ seller: username.toUpperCase() }),
    [c, d, free, noPrice2].sort(),
  );
});

test("a cursor belongs to its order, and its text is checked", async () => {
  const first = await page(reader, { limit: 1 });
  const plain = encodeMarketCursor(first.next);
  const priced = encodeMarketCursor({ ...first.next, price: "100.00" });
  assert.equal(
    JSON.stringify(Object.keys(JSON.parse(Buffer.from(plain, "base64url")))),
    '["t","i"]',
  );
  assert.throws(() => decodeMarketCursor(plain, true), {
    code: "invalid_request",
  });
  assert.throws(() => decodeMarketCursor(priced, false), {
    code: "invalid_request",
  });
  assert.equal(decodeMarketCursor(priced, true).price, "100.00");
  const nullPrice = encodeMarketCursor({ ...first.next, price: null });
  assert.equal(decodeMarketCursor(nullPrice, true).price, null);
  for (const bad of [
    "!!!",
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({ p: "1e9", t: day(1), i: a })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify({ p: "1", t: "2026-09-01", i: a })).toString(
      "base64url",
    ),
    // The bike list's cursor is not a market cursor in a price order.
    encodeCursor({ createdAt: first.next.publishedAt, id: first.next.id }),
  ])
    assert.throws(() => decodeMarketCursor(bad, true), {
      code: "invalid_request",
    });
});

test("the query takes the site's parameters and refuses the rest", () => {
  const parsed = parseMarketQuery(
    new URL(
      "http://x/api/v1/market?type=free&condition=used&price_min=5&sort=price_desc&seller=Bob_1&limit=5",
    ),
  );
  assert.equal(parsed.type, "free");
  assert.equal(parsed.price_min, 5);
  assert.equal(parsed.price_max, "");
  assert.equal(parsed.sort, "price_desc");
  assert.equal(parseMarketQuery(new URL("http://x/m")).sort, "new");
  for (const bad of [
    "type=sell",
    "sort=cheap",
    "price_min=-1",
    "price_min=1.5",
    "price_max=99999999999",
    "category=cars",
    "seller=a",
    "page=2",
    "sort=new&sort=price_asc",
  ])
    assert.throws(() => parseMarketQuery(new URL("http://x/m?" + bad)), {
      code: "invalid_request",
    });
});

test("a card keeps the contact and the term to the owner", async () => {
  const card = toMarketListingDetail(await marketApiDetail(db, a, reader));
  marketListingDetailSchema.parse(card);
  assert.equal(card.hasContact, true);
  assert.equal(card.isOwner, false);
  assert.equal(card.saved, false);
  assert.ok(!("contact" in card) && !("expiresAt" in card));
  assert.match(card.path, /^\/market\//);
  assert.equal(card.author.avatarUrl, null);
  const text = JSON.stringify(card);
  assert.ok(!text.includes("@test.invalid") && !text.includes("tg:"));
  const own = toMarketListingDetail(await marketApiDetail(db, a, seller));
  marketListingDetailSchema.parse(own);
  assert.equal(own.isOwner, true);
  assert.match(own.contact, /^tg: @seller_/);
  assert.ok(own.expiresAt);
  // The list carries the same cards.
  for (const item of (await page(reader)).items)
    marketListingSchema.parse(toMarketListing(item));
});

test("who reads which listing", async () => {
  const read = (id, viewer) =>
    marketApiDetail(db, id, viewer).then(
      (card) => card.status + (card.expired ? "+expired" : ""),
      (error) => error.status,
    );
  assert.equal(await read(sold, reader), "sold");
  assert.equal(await read(expired, reader), "active+expired");
  assert.equal(await read(draft, reader), 404);
  assert.equal(await read(draft, null), 404);
  assert.equal(await read(draft, seller), "draft");
  assert.equal(await read(hidden, reader), 404);
  // A blocked seller is hidden from the seller's own side too.
  assert.equal(await read(hidden, barred), 404);
  assert.equal(await read(randomUUID(), reader), 404);
});

test("the contact is asked for one listing at a time", async () => {
  const contact = (id, viewer) =>
    marketContact(db, id, viewer, "id").catch((error) => error.status);
  assert.match(await contact(a, reader), /^tg: @seller_/);
  assert.equal(await contact(sold, reader), 404);
  assert.equal(await contact(expired, reader), 404);
  assert.equal(await contact(draft, reader), 404);
  assert.equal(await contact(hidden, reader), 404);
  // The owner reads their own, whatever its state.
  assert.match(await contact(sold, seller), /^tg: @seller_/);
  assert.match(await contact(draft, seller), /^tg: @seller_/);
  // By the id: the site's share id is not a key of the API.
  const share = (
    await db.query("SELECT share_id FROM market_listings WHERE id=$1", [a])
  ).rows[0].share_id;
  assert.equal(await contact(share, reader), 404);
});

test("the seller's other listings are those on the market now", async () => {
  const others = await sellerApiListings(db, a, reader);
  marketOthersSchema.parse({
    items: others.items.map(toMarketListing),
    total: others.total,
  });
  assert.deepEqual(
    others.items.map((item) => item.id),
    [noPrice1, b],
  );
  assert.equal(others.total, 2);
  const manyBy = await addUser("many");
  const group = [];
  for (let i = 0; i < 6; i++)
    group.push(await addListing(manyBy, { at: day(11 + i) }));
  const six = await sellerApiListings(db, group[0], reader);
  assert.equal(six.items.length, 4);
  assert.equal(six.total, 5);
  assert.ok(!six.items.some((item) => item.id === group[0]));
});

test("saving follows the visibility of the listing", async () => {
  assert.deepEqual(await setListingSaved(db, a, reader, true), { saved: true });
  assert.equal((await marketApiDetail(db, a, reader)).saved, true);
  // Repeating changes nothing.
  assert.deepEqual(await setListingSaved(db, a, reader, true), { saved: true });
  for (const gone of [sold, expired, draft, hidden])
    await assert.rejects(setListingSaved(db, gone, reader, true), {
      status: 404,
    });
  assert.deepEqual(await setListingSaved(db, a, reader, false), {
    saved: false,
  });
  assert.deepEqual(await setListingSaved(db, a, reader, false), {
    saved: false,
  });
  assert.equal((await marketApiDetail(db, a, reader)).saved, false);
});
