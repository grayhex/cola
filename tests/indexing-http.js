// Indexing (#74) on the real app: robots.txt, sitemap.xml, per-page robots,
// public pages rendered on the server and hidden ones answering 404.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gpx, loop } from "./ride-fixtures.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  const call = async (url, method = "GET", data) => {
    const binary = Buffer.isBuffer(data);
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data
          ? {
              "Content-Type": binary
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
      },
      body: data ? (binary ? data : JSON.stringify(data)) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  // Like curl: the HTML as sent, no JavaScript, no redirects followed.
  call.page = async (path) => {
    const response = await fetch(base + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
    return { status: response.status, html: await response.text() };
  };
  return call;
}
const robots = (html) =>
  html.match(/<meta name="robots" content="([^"]*)"/)?.[1];
const canonical = (html) =>
  html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
const owner = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8);

const robotsTxt = await fetch(base + "/robots.txt");
assert.equal(robotsTxt.status, 200);
const rules = await robotsTxt.text();
assert.match(rules, /User-Agent: \*/);
assert.match(rules, /^Disallow: \/api\/$/m);
for (const media of ["photos", "avatars", "journal/media", "market/media", "social-preview"])
  assert.match(rules, new RegExp(`^Allow: /api/${media}/$`, "m"));
// Personal sections carry noindex instead: a crawler must fetch them to see it.
assert.doesNotMatch(rules, /^Disallow: \/$/m);
assert.match(rules, new RegExp(`^Sitemap: ${base}/sitemap.xml$`, "m"));

// Catalogs are indexed; personal and utility pages are not.
for (const path of ["/", "/bikes", "/journal", "/articles", "/rides", "/market", "/records", "/about", "/legal/terms"]) {
  const page = await guest.page(path);
  assert.equal(page.status, 200, path);
  assert.equal(robots(page.html), "index, follow", path);
}
for (const path of ["/account", "/saved", "/search", "/notifications", "/feed", "/login", "/register", "/experience", "/j/new", "/market/new", "/articles/new", "/legal/terms?revision=1"]) {
  const page = await guest.page(path);
  assert.match(robots(page.html) || "", /^noindex/, path);
}

assert.equal(
  (
    await owner("auth/register", "POST", {
      ...testConsents,
      name: "Индекс " + nonce,
      email: `indexing-${nonce}@example.test`,
      password: "indexing-http-secret-123",
    })
  ).status,
  201,
);
const { username } = (await owner("me")).body.user;
const bikeInput = {
  name: "Stumpjumper " + nonce,
  brand: "Specialized",
  model: "Stumpjumper",
  year: 2023,
  category: "mtb",
  description: "Эндуро-сборка для горных трасс " + nonce,
  color: "",
  size: "",
  weight: null,
  is_public: true,
};
const created = await owner("bikes", "POST", bikeInput);
assert.equal(created.status, 201, JSON.stringify(created.body));
assert.equal(
  (
    await owner(`bikes/${created.body.id}/components`, "POST", {
      section: "build",
      category: "Групсет",
      name: "Shimano GRX " + nonce,
      notes: "",
      price: null,
    })
  ).status,
  201,
);
const { bike } = (await owner("bikes/" + created.body.id)).body;
const bikePath = "/b/" + encodeURIComponent(`${bike.slug}-${bike.public_id}`);

const entry = await owner("journal", "POST", {
  bikeId: bike.id,
  kind: "service",
  title: "Замена цепи " + nonce,
  body: "Поставил новую цепь и кассету " + nonce,
  status: "published",
  isPublic: true,
});
assert.equal(entry.status, 201, JSON.stringify(entry.body));
const preview = await owner("rides/preview", "POST", gpx([loop]));
assert.equal(preview.status, 201, JSON.stringify(preview.body));
const ride = await owner("rides", "POST", {
  previewId: preview.body.previewId,
  bikeId: bike.id,
  title: "Утренний круг " + nonce,
  description: "Лесной круг вокруг озера " + nonce,
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
});
assert.equal(ride.status, 201, JSON.stringify(ride.body));
const listing = await owner("market", "POST", {
  title: "Вилка Fox " + nonce,
  description: "Ход 150 мм, после сервиса " + nonce,
  category: "components",
  listingType: "sale",
  condition: "used",
  price: 45000,
  currency: "RUB",
  location: "Москва",
  contact: "",
  status: "active",
});
assert.equal(listing.status, 201, JSON.stringify(listing.body));
const article = await owner("articles", "POST", {
  title: "Как смазать цепь " + nonce,
  body: "Сначала очистите цепь от грязи " + nonce,
  topicId: "maintenance",
  status: "published",
});
assert.equal(article.status, 201, JSON.stringify(article.body));
const draft = await owner("articles", "POST", {
  title: "Черновик " + nonce,
  body: "Ещё не готово " + nonce,
  topicId: "maintenance",
  status: "draft",
});
assert.equal(draft.status, 201, JSON.stringify(draft.body));

// Each public page resolves to its canonical address...
async function canonicalPath(path) {
  const page = await guest.page(path);
  if (page.status !== 308) return path;
  const moved = await fetch(base + path, { redirect: "manual" });
  const url = new URL(moved.headers.get("location"), base);
  return url.pathname;
}
const pages = {
  bike: bikePath,
  journal: await canonicalPath("/j/" + entry.body.shareId),
  ride: await canonicalPath("/r/" + ride.body.shareId),
  market: await canonicalPath("/market/" + listing.body.shareId),
  profile: "/@" + username,
  article: "/articles/" + article.body.shareId,
};
// ...and its HTML carries the title and the main text without JavaScript.
const content = {
  bike: [bikeInput.name, bikeInput.description, "Shimano GRX " + nonce],
  journal: ["Замена цепи " + nonce, "Поставил новую цепь и кассету " + nonce],
  ride: ["Утренний круг " + nonce, "Лесной круг вокруг озера " + nonce],
  market: ["Вилка Fox " + nonce, "Ход 150 мм, после сервиса " + nonce, "45 000"],
  profile: ["Индекс " + nonce, bikeInput.name],
  article: ["Как смазать цепь " + nonce, "Сначала очистите цепь от грязи " + nonce],
};
const loading = {
  bike: ["Загружаем велосипеды"],
  journal: ["Загружаем запись"],
  ride: ["Загружаем покатушку"],
  market: ["Загружаем…", "Загружаем объявление"],
  profile: ["Загружаем профиль", "Загружаем велосипеды"],
  article: ["Загружаем статью"],
};
assert.ok((await guest.page(bikePath)).html.includes(`<h1>${bikeInput.name}</h1>`));
for (const [kind, path] of Object.entries(pages)) {
  const page = await guest.page(path);
  assert.equal(page.status, 200, kind);
  assert.equal(robots(page.html), "index, follow", kind);
  assert.equal(canonical(page.html), base + path, kind);
  // Visible text, not only metadata: strip the head and the Flight payload.
  const body = page.html
    .slice(page.html.indexOf("<body"))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replaceAll(/\u00a0|&nbsp;/g, " ");
  for (const text of content[kind]) assert.ok(body.includes(text), kind + ": " + text);
  // The page itself is ready; only side panels (awards, lists) load later.
  for (const text of loading[kind])
    assert.ok(!body.includes(text), kind + " shows " + text);
}

// The sitemap lists every public page by its canonical address.
async function sitemap() {
  const response = await fetch(base + "/sitemap.xml");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /xml/);
  return response.text();
}
const loc = (path) => `<loc>${base}${path}</loc>`;
let xml = await sitemap();
for (const path of ["/", "/bikes", "/legal/terms", ...Object.values(pages)])
  assert.ok(xml.includes(loc(path)), path);
assert.ok(!xml.includes(draft.body.shareId), "draft article");
assert.match(xml, new RegExp(`${loc(bikePath)}\\s*<lastmod>`));

// A hidden bike leaves the sitemap with its entry and ride and answers 404.
assert.equal(
  (await owner(`bikes/${bike.id}/share`, "PATCH", { is_public: false })).status,
  200,
);
xml = await sitemap();
for (const kind of ["bike", "journal", "ride"])
  assert.ok(!xml.includes(loc(pages[kind])), kind + " left the sitemap");
for (const kind of ["bike", "journal", "ride"]) {
  const page = await guest.page(pages[kind]);
  assert.equal(page.status, 404, kind);
  assert.match(robots(page.html) || "", /noindex/, kind);
  for (const text of content[kind])
    assert.ok(!page.html.includes(text), kind + " leaks " + text);
}
// The owner still opens it, rendered on the server but kept out of search.
const ownBike = await owner.page(bikePath);
assert.equal(ownBike.status, 200);
assert.equal(robots(ownBike.html), "noindex, nofollow");
assert.ok(ownBike.html.includes(`<h1>${bikeInput.name}</h1>`));

// A draft article is the author's: 404 for guests, noindex for the author.
const draftPath = "/articles/" + draft.body.shareId;
assert.equal((await guest.page(draftPath)).status, 404);
const ownDraft = await owner.page(draftPath);
assert.equal(ownDraft.status, 200);
assert.equal(robots(ownDraft.html), "noindex, nofollow");
assert.equal((await guest.page("/articles/not-a-uuid")).status, 404);

// Closed listings still open, but only active ones are worth a crawl.
assert.equal(
  (
    await owner("market/" + listing.body.id, "PATCH", {
      title: "Вилка Fox " + nonce,
      description: "Ход 150 мм, после сервиса " + nonce,
      category: "components",
      listingType: "sale",
      condition: "used",
      price: 45000,
      currency: "RUB",
      location: "Москва",
      contact: "",
      status: "sold",
    })
  ).status,
  200,
);
xml = await sitemap();
assert.ok(!xml.includes(loc(pages.market)), "sold listing");
assert.equal((await guest.page(pages.market)).status, 200);
console.log(
  "Indexing HTTP: robots.txt, per-page robots, server-rendered public pages, sitemap membership and 404 for hidden pages passed.",
);
