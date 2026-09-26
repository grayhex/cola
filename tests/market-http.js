import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
// Market contacts never reach guests; members request them one at a time.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (url, method = "GET", data) => {
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
}
const seller = client(),
  buyer = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8);
for (const [c, name] of [
  [seller, "seller"],
  [buyer, "buyer"],
])
  assert.equal(
    (
      await c("auth/register", "POST", {
        ...testConsents,
        name,
        email: `market-${name}-${nonce}@example.test`,
        password: "market-http-secret-123",
      })
    ).status,
    201,
  );
const title = "Contact wheel " + nonce,
  phone = "+7 900 111-22-33";
const created = await seller("market", "POST", {
  title,
  description: "Wheelset",
  category: "components",
  listingType: "sale",
  condition: "used",
  price: 4200,
  currency: "RUB",
  location: "Москва",
  contact: phone,
  status: "active",
});
assert.equal(created.status, 201, JSON.stringify(created.body));
const share = created.body.shareId;

// Guests: no contact in the list or the card, and no direct access.
const list = await guest("market?q=" + encodeURIComponent(title));
assert.equal(list.status, 200);
assert.equal(list.body.total, 1);
assert.equal(list.body.items[0].hasContact, true);
const card = await guest("market/public/" + share);
assert.equal(card.status, 200);
assert.ok(card.body.listing.publishedAt);
assert.doesNotMatch(
  JSON.stringify([list.body, card.body]),
  /111-22-33|"contact"/,
);
assert.equal((await guest(`market/public/${share}/contact`)).status, 401);

// Members get the contact on request; only the seller sees it in the card.
const shown = await buyer(`market/public/${share}/contact`);
assert.equal(shown.status, 200);
assert.equal(shown.body.contact, phone);
assert.equal(
  "contact" in (await buyer("market/public/" + share)).body.listing,
  false,
);
assert.equal(
  (await seller("market/public/" + share)).body.listing.contact,
  phone,
);

// Price, city and sort are validated; count and page use the same conditions.
const query = (extra) =>
  guest("market?" + new URLSearchParams({ q: title, ...extra }));
const filtered = await query({
  price_min: "4000",
  price_max: "5000",
  city: "Москва",
  sort: "price_asc",
});
assert.equal(filtered.status, 200);
assert.equal(filtered.body.total, 1);
assert.equal(filtered.body.items.length, 1);
assert.equal((await query({ price_min: "4300" })).body.total, 0);
assert.equal((await query({ city: "Казань" })).body.total, 0);
for (const bad of [
  { price_min: "-1" },
  { price_max: "1.5" },
  { sort: "random" },
  { city: "x".repeat(101) },
])
  assert.equal((await query(bad)).status, 400, JSON.stringify(bad));

// #116: the seller's other listings, the seller filter, saving and the term.
const listingBody = (extra) => ({
  description: "Second wheelset",
  category: "components",
  listingType: "sale",
  condition: "used",
  price: 3000,
  currency: "RUB",
  location: "Москва",
  contact: phone,
  status: "active",
  ...extra,
});
const second = await seller(
  "market",
  "POST",
  listingBody({ title: "Second " + nonce }),
);
assert.equal(second.status, 201);
const draft = await seller(
  "market",
  "POST",
  listingBody({ title: "Draft " + nonce, status: "draft" }),
);
assert.equal(draft.status, 201);
const withOthers = (await guest("market/public/" + share)).body;
assert.deepEqual(
  withOthers.others.items.map((m) => m.title),
  ["Second " + nonce],
);
assert.equal(withOthers.others.total, 1);
assert.equal(withOthers.listing.expired, false);
assert.equal("expiresAt" in withOthers.listing, false);
const username = (await seller("me")).body.user.username;
const bySeller = await guest("market?seller=" + username);
assert.equal(bySeller.status, 200);
assert.deepEqual(
  bySeller.body.items.map((m) => m.title).sort(),
  ["Second " + nonce, title].sort(),
);
assert.equal(bySeller.body.seller.username, username);
assert.equal((await guest("market?seller=nobody-" + nonce)).status, 404);
assert.equal((await guest("market?seller=..%2Fx")).status, 400);

// Saving: members only, and only a listing on the market.
const id = created.body.id;
assert.equal((await guest(`market/${id}/save`, "PUT")).status, 401);
assert.deepEqual((await buyer(`market/${id}/save`, "PUT")).body, {
  saved: true,
});
assert.equal((await buyer("market/public/" + share)).body.listing.saved, true);
assert.deepEqual(
  (await buyer("market/saved")).body.items.map((m) => m.title),
  [title],
);
assert.equal((await buyer(`market/${draft.body.id}/save`, "PUT")).status, 404);

// Only the owner extends a listing.
assert.equal((await buyer(`market/${id}/extend`, "POST")).status, 409);
const extended = await seller(`market/${id}/extend`, "POST");
assert.equal(extended.status, 200);
assert.ok(new Date(extended.body.expiresAt) > Date.now() + 59 * 86400000);

// The term ends. The server's clock is real, so the term moves instead.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query(
    "UPDATE market_listings SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [id],
  );
  const expired = (await guest("market/public/" + share)).body;
  assert.equal(expired.listing.expired, true);
  assert.equal(
    (await guest("market?q=" + encodeURIComponent(title))).body.total,
    0,
  );
  assert.equal((await buyer(`market/public/${share}/contact`)).status, 404);
  assert.deepEqual((await buyer("market/saved")).body.items, []);
  const page = await fetch(base + "/market/" + share);
  assert.equal(page.status, 200);
  assert.match(
    (await page.text()).match(/<meta name="robots" content="([^"]*)"/)?.[1] ||
      "",
    /^noindex/,
  );
  // Reading notifications brings the owner the site's notice.
  assert.ok((await seller("community/notifications/count")).body.unread >= 1);
  const notice = (
    await seller("community/notifications")
  ).body.notifications.find((n) => n.type === "market_expiring");
  assert.equal(notice.actor, null);
  assert.equal(notice.target.state, "expired");
  assert.equal((await seller(`market/${id}/extend`, "POST")).status, 200);
  assert.equal(
    (await guest("market/public/" + share)).body.listing.expired,
    false,
  );
  assert.equal(
    (await buyer("market/saved")).body.items.map((m) => m.title)[0],
    title,
  );
} finally {
  await db.end();
}

// Twenty contacts per 15 minutes per person, then 429.
let last;
for (let i = 0; i < 20; i++)
  last = await buyer(`market/public/${share}/contact`);
assert.equal(last.status, 429);
console.log(
  "Market HTTP: contacts hidden from guests, members' contact requests limited, price/city/sort filters validated, other listings, seller filter, saves, term and extension.",
);
