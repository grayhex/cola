// Model and part pages of owner experience (#74) on the real app: rendered
// on the server, one canonical address, indexed from three public builds.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
let cookie = "";
async function api(url, method = "GET", data) {
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
}
// As a crawler sees it: a guest, no JavaScript, no redirects followed.
async function page(path) {
  const response = await fetch(base + path, { redirect: "manual" });
  const html = await response.text();
  return {
    status: response.status,
    location: response.headers.get("location"),
    html,
    robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1],
    canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
    text: html
      .slice(html.indexOf("<body"))
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replaceAll(/\u00a0|&nbsp;/g, " "),
  };
}
const nonce = randomUUID().slice(0, 8);
assert.equal(
  (
    await api("auth/register", "POST", {
      ...testConsents,
      name: "Опыт " + nonce,
      email: `landing-${nonce}@example.test`,
      password: "landing-http-secret-123",
    })
  ).status,
  201,
);
const model = "Occam LT " + nonce,
  fork = "Fox 36 " + nonce;
const bikes = [];
for (const [i, spelling, forkName] of [
  [1, model, fork],
  [2, model.toUpperCase(), fork.toUpperCase()],
  [3, model, fork],
]) {
  const created = await api("bikes", "POST", {
    name: `Сборка ${i} ${nonce}`,
    brand: i === 2 ? "ORBEA" : "Orbea",
    model: spelling,
    year: 2020 + i,
    category: "mtb",
    description: "",
    color: "",
    size: "",
    weight: 14,
    is_public: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  bikes.push(created.body.id);
  const part = await api(`bikes/${created.body.id}/components`, "POST", {
    section: "build",
    category: "Вилка",
    name: forkName,
    notes: "",
    price: null,
  });
  assert.equal(part.status, 201, JSON.stringify(part.body));
}
const entry = await api("journal", "POST", {
  bikeId: bikes[0],
  kind: "service",
  title: "Сервис вилки " + nonce,
  body: "Поменял пыльники и масло " + nonce,
  status: "published",
  isPublic: true,
});
assert.equal(entry.status, 201, JSON.stringify(entry.body));
// An installation story: the fork is captured with the entry.
const firstBike = (await api("bikes/" + bikes[0])).body.bike;
const installed = await api("journal", "POST", {
  bikeId: bikes[0],
  kind: "build",
  title: "Поставил вилку " + nonce,
  body: "Новая вилка встала без переделок " + nonce,
  status: "published",
  isPublic: true,
  componentIds: [firstBike.components.find((c) => c.name === fork).id],
  installationResult: "direct",
});
assert.equal(installed.status, 201, JSON.stringify(installed.body));

const modelPath = `/experience/orbea/occam-lt-${nonce}`,
  partPath = `/experience/parts/${encodeURIComponent("вилка")}/fox-36-${nonce}`;
const landing = await page(modelPath);
assert.equal(landing.status, 200);
assert.equal(landing.robots, "index, follow");
assert.equal(landing.canonical, base + modelPath);
for (const text of [
  `<h1>Orbea ${model}</h1>`,
  "3 сборки",
  "MTB",
  "Что ставили владельцы",
  "Поставил вилку " + nonce,
  `Сборка 1 ${nonce}`,
  `Сборка 3 ${nonce}`,
  "Сервис вилки " + nonce,
  fork,
  `href="${partPath}"`,
])
  assert.ok(landing.text.includes(text), "model page: " + text);
assert.match(landing.html, /<title>Orbea Occam LT [0-9a-f]+ — опыт владельцев · ColaBike<\/title>/);

const part = await page(partPath);
assert.equal(part.status, 200);
assert.equal(part.robots, "index, follow");
assert.equal(part.canonical, base + partPath);
for (const text of [`<h1>${fork}</h1>`, `href="${modelPath}"`, `Сборка 2 ${nonce}`])
  assert.ok(part.text.includes(text), "part page: " + text);

// Other spellings and letter cases move to the one address.
for (const [path, target] of [
  [`/experience/ORBEA/Occam-LT-${nonce}`, modelPath],
  [`/experience/orbea/occam_lt_${nonce}`, modelPath],
  [`/experience/parts/ВИЛКА/FOX-36-${nonce}`, partPath],
]) {
  const moved = await page(path);
  assert.equal(moved.status, 308, path);
  assert.equal(new URL(moved.location, base).pathname, target, path);
}
for (const path of [
  `/experience/orbea/nothing-${nonce}`,
  `/experience/parts/рама/fox-36-${nonce}`,
  "/experience/-/-",
]) {
  const missing = await page(path);
  assert.equal(missing.status, 404, path);
  assert.match(missing.robots || "", /noindex/, path);
}

// A public bike leads to its model and parts pages.
const { bike } = (await api("bikes/" + bikes[0])).body;
const bikePage = await page(
  "/b/" + encodeURIComponent(`${bike.slug}-${bike.public_id}`),
);
assert.equal(bikePage.status, 200);
assert.ok(bikePage.html.includes(`href="${modelPath}"`), "bike → model page");
assert.ok(bikePage.html.includes(`href="${partPath}"`), "bike → part page");

async function sitemap() {
  const response = await fetch(base + "/sitemap.xml");
  assert.equal(response.status, 200);
  return response.text();
}
const loc = (path) => `<loc>${base}${path}</loc>`;
let xml = await sitemap();
assert.ok(xml.includes(loc(modelPath)), "model page in the sitemap");
assert.ok(xml.includes(loc(partPath)), "part page in the sitemap");

// Below three public builds the pages still open but leave search.
assert.equal(
  (await api(`bikes/${bikes[2]}/share`, "PATCH", { is_public: false })).status,
  200,
);
const thin = await page(modelPath);
assert.equal(thin.status, 200);
assert.equal(thin.robots, "noindex, nofollow");
assert.ok(thin.text.includes("2 сборки"));
assert.ok(!thin.text.includes(`Сборка 3 ${nonce}`), "hidden build leaks");
xml = await sitemap();
assert.ok(!xml.includes(loc(modelPath)), "thin model page left the sitemap");
assert.ok(!xml.includes(loc(partPath)), "thin part page left the sitemap");
console.log(
  "Experience landing HTTP: server-rendered model and part pages, canonical redirects, 404, robots threshold and sitemap passed.",
);
