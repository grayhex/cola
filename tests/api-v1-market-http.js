// API v1, the market (#319), through the real server and PostgreSQL: the list
// and its cursors, who sees which listing, the contact asked for one by one
// (sign-in, verified email, budget), the seller's other listings and saving.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  errorSchema,
  marketContactSchema,
  marketListingDetailSchema,
  marketOthersSchema,
  marketPageSchema,
  marketSavedSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "market-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label, verified = true) {
  const email = `market-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: "Райдер " + label,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  if (verified) await verifyCapturedEmail(email);
  // A cookie request, with the Origin the site sends unless a test says otherwise.
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  // A native client: a device session, a Bearer token and no Origin at all.
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const withToken = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    web,
    cookieValue: () => cookie,
    bearer: async () => "Bearer " + grant.body.accessToken,
    cookie: withCookie,
    token: withToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const day = (n) => `2026-09-${String(n).padStart(2, "0")}T10:00:00.000100Z`;
async function addListing(owner, options = {}) {
  const id = randomUUID();
  const status = options.status ?? "active";
  await db.query(
    `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,location,contact,status,listing_type,published_at,expires_at)
     VALUES($1,$2,$3,$4,'Описание',$5,'used',$6,'RUB',$7,$8,$9,$10,$11,$12)`,
    [
      id,
      randomUUID(),
      owner,
      options.title ?? `Лот ${id.slice(0, 6)} ${run}`,
      options.category ?? "components",
      options.price === undefined ? 1000 : options.price,
      options.location ?? "Москва",
      options.contact ?? "tg: @contact_" + id.slice(0, 6),
      status,
      options.type ?? "sale",
      status === "draft" ? null : (options.at ?? day(10)),
      status === "active" ? (options.expires ?? "2099-01-01T00:00:00Z") : null,
    ],
  );
  return id;
}
const idsOf = (r) => r.body.items.map((item) => item.id);

try {
  const seller = await member("seller");
  const reader = await member("reader");
  const mailless = await member("mailless", false);
  const barredSeller = await member("barred");
  const marker = "Ж" + run;

  const cheap = await addListing(seller.id, {
    at: day(1),
    price: 100,
    title: marker + " cheap",
  });
  const dear = await addListing(seller.id, {
    at: day(2),
    price: 900,
    category: "bikes",
    title: marker + " dear",
  });
  const tie1 = await addListing(seller.id, {
    at: day(3),
    price: 500,
    title: marker + " tie",
  });
  const tie2 = await addListing(seller.id, {
    at: day(3),
    price: 500,
    type: "wanted",
    title: marker + " tie",
  });
  const nothing = await addListing(seller.id, {
    at: day(4),
    price: null,
    type: "exchange",
    location: "Казань",
    title: marker + " none",
  });
  const sold = await addListing(seller.id, {
    status: "sold",
    at: day(5),
    title: marker + " sold",
  });
  const expired = await addListing(seller.id, {
    at: day(6),
    expires: "2020-01-01T00:00:00Z",
    title: marker + " expired",
  });
  const draft = await addListing(seller.id, {
    status: "draft",
    title: marker + " draft",
  });
  const hidden = await addListing(barredSeller.id, {
    at: day(7),
    title: marker + " hidden",
  });
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [
    barredSeller.id,
  ]);
  const live = [cheap, dear, tie1, tie2, nothing];

  const market = (query = "", viewer = guest) =>
    viewer("/market?q=" + encodeURIComponent(marker) + query);

  // The list, newest first, the pages are walked by the cursor.
  const first = await market("&limit=2");
  assert.equal(first.status, 200, first.text);
  marketPageSchema.parse(first.body);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.nextCursor);
  const walked = async (sort, limit) => {
    const seen = [];
    let cursor = null;
    for (let guardian = 0; guardian < 12; guardian++) {
      const r = await market(
        `&sort=${sort}&limit=${limit}` + (cursor ? "&cursor=" + cursor : ""),
      );
      assert.equal(r.status, 200, r.text);
      marketPageSchema.parse(r.body);
      seen.push(...idsOf(r));
      if (!r.body.nextCursor) return seen;
      cursor = r.body.nextCursor;
    }
    throw new Error("the walk does not end");
  };
  for (const sort of ["new", "price_asc", "price_desc"]) {
    const whole = await walked(sort, 50);
    assert.deepEqual([...whole].sort(), [...live].sort(), sort);
    for (const limit of [1, 2, 3])
      assert.deepEqual(await walked(sort, limit), whole, `${sort}/${limit}`);
  }
  const ascending = await walked("price_asc", 50);
  assert.deepEqual(ascending.slice(0, 1), [cheap]);
  assert.equal(ascending.at(-1), nothing);
  assert.equal((await walked("price_desc", 50))[0], dear);
  for (const gone of [sold, expired, draft, hidden])
    assert.ok(!ascending.includes(gone));
  // The same list for a signed-in reader, by cookie and by token.
  assert.deepEqual(
    idsOf(await market("&sort=price_asc", reader.cookie)),
    ascending,
  );
  assert.deepEqual(
    idsOf(await market("&sort=price_asc", reader.token)),
    ascending,
  );

  // A cursor belongs to its order.
  assertError(
    await market("&sort=price_asc&cursor=" + first.body.nextCursor),
    400,
    "invalid_request",
    "new cursor in a price order",
  );
  const priced = await market("&sort=price_asc&limit=1");
  assertError(
    await market("&sort=price_desc&cursor=" + priced.body.nextCursor),
    400,
    "invalid_request",
    "price cursor in the opposite order",
  );
  assertError(
    await market("&cursor=" + priced.body.nextCursor),
    400,
    "invalid_request",
    "price cursor in the new order",
  );
  assertError(
    await market("&cursor=garbage"),
    400,
    "invalid_request",
    "garbage cursor",
  );
  assertError(
    await guest("/market?sort=cheap"),
    400,
    "invalid_request",
    "sort",
  );
  assertError(await guest("/market?type=sell"), 400, "invalid_request", "type");
  assertError(
    await guest("/market?price_min=-5"),
    400,
    "invalid_request",
    "price",
  );
  assertError(
    await guest("/market?page=2"),
    400,
    "invalid_request",
    "page is not a parameter",
  );
  assertError(
    await guest("/market?sort=new&sort=price_asc"),
    400,
    "invalid_request",
    "repeated",
  );

  // Filters of the site.
  const only = async (query) => idsOf(await market(query)).sort();
  assert.deepEqual(await only("&type=wanted"), [tie2]);
  assert.deepEqual(await only("&category=bikes"), [dear]);
  assert.deepEqual(await only("&city=%D0%BA%D0%B0%D0%B7"), [nothing]);
  assert.deepEqual(
    await only("&price_min=500&price_max=500"),
    [tie1, tie2].sort(),
  );
  assert.deepEqual(await only("&price_max=100"), [cheap]);
  assert.deepEqual(
    await only("&seller=" + seller.username.toUpperCase()),
    [...live].sort(),
  );
  assertError(
    await guest("/market?seller=nobody-" + run),
    404,
    "not_found",
    "unknown seller",
  );
  assertError(
    await guest("/market?seller=" + barredSeller.username),
    404,
    "not_found",
    "blocked seller",
  );

  // A card: the contact and the term are the owner's.
  const card = await guest("/market/" + cheap);
  assert.equal(card.status, 200, card.text);
  marketListingDetailSchema.parse(card.body);
  assert.equal(card.body.hasContact, true);
  assert.equal(card.body.saved, false);
  assert.ok(!("contact" in card.body) && !("expiresAt" in card.body));
  assert.ok(
    !card.text.includes("contact_") && !card.text.includes("@example.test"),
  );
  for (const viewer of [seller.cookie, seller.token]) {
    const own = await viewer("/market/" + cheap);
    assert.equal(own.body.isOwner, true);
    assert.match(own.body.contact, /^tg: @contact_/);
    assert.ok(own.body.expiresAt);
  }
  const others = await reader.token("/market/" + cheap);
  assert.equal(others.body.isOwner, false);
  assert.ok(!("contact" in others.body));
  // Sold and expired listings open with the mark; drafts, hidden and unknown ones do not.
  assert.equal((await guest("/market/" + sold)).body.status, "sold");
  const gone = await guest("/market/" + expired);
  assert.equal(gone.body.expired, true);
  for (const id of [draft, hidden, randomUUID()])
    assertError(
      await reader.token("/market/" + id),
      404,
      "not_found",
      "unreadable " + id,
    );
  assert.equal((await seller.token("/market/" + draft)).body.status, "draft");
  assertError(
    await guest("/market/not-a-uuid"),
    404,
    "not_found",
    "malformed id",
  );
  assertError(
    await guest("/market/" + cheap, { method: "POST" }),
    405,
    "method_not_allowed",
    "method",
  );

  // Photos of a draft are the owner's: the media route reads a Bearer token as
  // well as a cookie, and nobody else gets the file.
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
  const uploaded = await fetch(`${base}/api/market/${draft}/photos`, {
    method: "POST",
    headers: {
      cookie: seller.cookieValue(),
      origin: base,
      "content-type": "image/png",
    },
    body: png,
  });
  assert.equal(uploaded.status, 201, await uploaded.text());
  const photo = (await seller.token("/market/" + draft)).body.photos[0];
  assert.match(photo.url, /^\/api\/market\/media\/[0-9a-f-]{36}$/);
  const media = (credential) =>
    fetch(base + photo.url, {
      headers: credential ? { authorization: credential } : {},
    });
  assert.equal((await media(null)).status, 404, "guest");
  assert.equal(
    (await media(await seller.bearer())).status,
    200,
    "owner with a token",
  );
  assert.equal(
    (await media(await reader.bearer())).status,
    404,
    "another person with a token",
  );
  assert.equal(
    (await media("Bearer cola_at_nope")).status,
    401,
    "a token that finds nobody",
  );

  // The contact: signed in, verified email, a budget.
  assertError(
    await guest(`/market/${cheap}/contact`),
    401,
    "unauthorized",
    "guest contact",
  );
  assertError(
    await mailless.token(`/market/${cheap}/contact`),
    403,
    "email_verification_required",
    "unverified contact",
  );
  const contact = await reader.token(`/market/${cheap}/contact`);
  assert.equal(contact.status, 200, contact.text);
  marketContactSchema.parse(contact.body);
  assert.match(contact.body.contact, /^tg: @contact_/);
  assert.equal(contact.headers.get("cache-control"), "no-store");
  assert.equal((await reader.cookie(`/market/${cheap}/contact`)).status, 200);
  for (const id of [sold, expired, draft, hidden])
    assertError(
      await reader.token(`/market/${id}/contact`),
      404,
      "not_found",
      "contact of " + id,
    );
  assert.equal((await seller.token(`/market/${sold}/contact`)).status, 200);
  const share = (
    await db.query("SELECT share_id FROM market_listings WHERE id=$1", [cheap])
  ).rows[0].share_id;
  assertError(
    await reader.token(`/market/${share}/contact`),
    404,
    "not_found",
    "share id is not a key",
  );
  // The budget of the site's contact route is shared: 20 reads, then 429.
  const burst = await member("burst");
  let limited = null;
  for (let i = 0; i < 22 && !limited; i++) {
    const r = await burst.token(`/market/${cheap}/contact`);
    if (r.status === 429) limited = r;
    else assert.equal(r.status, 200, r.text);
  }
  assert.ok(limited, "the budget ends");
  assertError(limited, 429, "rate_limited", "budget");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  // The seller's others: only those on the market, never the listing itself.
  const siblings = await guest(`/market/${cheap}/others`);
  assert.equal(siblings.status, 200, siblings.text);
  marketOthersSchema.parse(siblings.body);
  assert.equal(siblings.body.total, 4);
  assert.equal(siblings.body.items.length, 4);
  assert.ok(!idsOf(siblings).includes(cheap));
  assertError(
    await reader.token(`/market/${draft}/others`),
    404,
    "not_found",
    "others of a draft",
  );

  // Saving: a switch with the site's budget and Origin rule.
  assertError(
    await guest(`/market/${cheap}/save`, { method: "PUT" }),
    401,
    "unauthorized",
    "guest save",
  );
  assertError(
    await reader.cookie(`/market/${cheap}/save`, {
      method: "PUT",
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "foreign origin",
  );
  const saved = await reader.cookie(`/market/${cheap}/save`, { method: "PUT" });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(marketSavedSchema.parse(saved.body), { saved: true });
  assert.deepEqual(
    (await reader.token(`/market/${cheap}/save`, { method: "PUT" })).body,
    { saved: true },
  );
  assert.equal((await reader.token("/market/" + cheap)).body.saved, true);
  const site = await reader.web("/market/saved");
  assert.ok(site.body.items.some((item) => item.id === cheap));
  assert.deepEqual(
    (await reader.token(`/market/${cheap}/save`, { method: "DELETE" })).body,
    { saved: false },
  );
  assert.deepEqual(
    (await reader.token(`/market/${cheap}/save`, { method: "DELETE" })).body,
    { saved: false },
  );
  for (const id of [sold, expired, draft, hidden])
    assertError(
      await reader.token(`/market/${id}/save`, { method: "PUT" }),
      404,
      "not_found",
      "save " + id,
    );
  assertError(
    await reader.token(`/market/${cheap}/save`),
    405,
    "method_not_allowed",
    "GET save",
  );

  // A token that finds nobody is an error, never a guest.
  assertError(
    await guest("/market", {
      headers: { authorization: "Bearer cola_at_nope" },
    }),
    401,
    "invalid_token",
    "bad token",
  );

  console.log("api v1 market http: ok");
} finally {
  await db.end();
}
