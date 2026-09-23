// Canonical public URLs, legacy redirects and link previews on the real app.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  const call = async (url, method = "GET", data, type) => {
    const binary = Buffer.isBuffer(data);
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data
          ? {
              "Content-Type":
                type ||
                (binary ? "application/octet-stream" : "application/json"),
            }
          : {}),
      },
      body: data ? (binary ? data : JSON.stringify(data)) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  // Pages are requested without following redirects to see 308s.
  call.page = (path) =>
    fetch(base + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
  return call;
}
const meta = (html, key) =>
  html.match(
    new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`),
  )?.[1];
const canonicalLink = (html) =>
  html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/)?.[1];
const location = (response) => {
  const url = new URL(response.headers.get("location"), base);
  return url.pathname + url.search;
};
const owner = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8);
assert.equal(
  (
    await owner("auth/register", "POST", {
      ...testConsents,
      name: "Preview owner",
      email: `preview-${nonce}@example.test`,
      password: "preview-http-secret-123",
    })
  ).status,
  201,
);
const { username } = (await owner("me")).body.user;
const input = {
  name: "Гревел " + nonce,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "Лёгкий **гравийник** для выходных",
  color: "",
  size: "",
  weight: null,
  is_public: true,
};
const created = await owner("bikes", "POST", input);
assert.equal(created.status, 201);
const photo = await sharp({
  create: { width: 1600, height: 1000, channels: 3, background: "#5b8a72" },
})
  .jpeg()
  .toBuffer();
assert.equal(
  (await owner(`bikes/${created.body.id}/photos`, "POST", photo, "image/jpeg"))
    .status,
  201,
);
// Owner API responses carry the immutable ID and the title slug.
const { bike } = (await owner("bikes/" + created.body.id)).body;
assert.match(bike.public_id, /^[0-9a-hjkmnp-tv-z]{8}$/);
assert.equal(bike.slug, "гревел-" + nonce);
const canonical = "/b/" + encodeURIComponent(`${bike.slug}-${bike.public_id}`);

// Legacy UUID links redirect permanently and keep the query string.
const legacy = await guest.page(`/b/${bike.share_id}?comment=1`);
assert.equal(legacy.status, 308);
assert.equal(location(legacy), canonical + "?comment=1");
const page = await guest.page(canonical);
assert.equal(page.status, 200);
const html = await page.text();
assert.equal(meta(html, "og:title"), input.name);
assert.equal(meta(html, "og:description"), "Лёгкий гравийник для выходных");
assert.equal(meta(html, "og:url"), base + canonical);
assert.equal(canonicalLink(html), base + canonical);
const imageUrl = `${base}/api/social-preview/bike/${bike.public_id}/image`;
assert.equal(meta(html, "og:image"), imageUrl);
assert.equal(meta(html, "twitter:card"), "summary_large_image");
const image = await fetch(imageUrl);
assert.equal(image.status, 200);
assert.equal(image.headers.get("content-type"), "image/jpeg");
const size = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
// The bike photo, fitted into 1200x630 without enlargement.
assert.deepEqual([size.format, size.width, size.height], ["jpeg", 1008, 630]);

// Renaming changes the slug, not the ID; the old slug redirects.
assert.equal(
  (
    await owner("bikes/" + bike.id, "PATCH", {
      ...input,
      name: "Новое имя " + nonce,
    })
  ).status,
  200,
);
const renamed = await guest.page(canonical);
assert.equal(renamed.status, 308);
const current = location(renamed);
assert.equal(
  current,
  "/b/" + encodeURIComponent(`новое-имя-${nonce}-${bike.public_id}`),
);

// A private bike yields no preview for guests, but the owner still resolves it.
assert.equal(
  (await owner(`bikes/${bike.id}/share`, "PATCH", { is_public: false })).status,
  200,
);
const hidden = await guest.page(`/b/${bike.share_id}`);
assert.equal(hidden.status, 200);
const hiddenHtml = await hidden.text();
assert.match(meta(hiddenHtml, "robots") || "", /noindex/);
assert.equal(meta(hiddenHtml, "og:image"), undefined);
assert.doesNotMatch(hiddenHtml, /Новое имя|гравийник/);
assert.equal((await fetch(imageUrl)).status, 404);
assert.equal((await guest.page(current)).status, 200);
assert.equal((await fetch(base + "/api/shared/" + bike.share_id)).status, 404);
const ownerView = await owner.page(`/b/${bike.share_id}`);
assert.equal(ownerView.status, 308);
assert.equal(location(ownerView), current);

// Profiles move to /@username; the old /u/ path redirects.
const profile = await guest.page("/u/" + username);
assert.equal(profile.status, 308);
assert.equal(location(profile), "/@" + username);
const profilePage = await guest.page("/@" + username);
assert.equal(profilePage.status, 200);
const profileHtml = await profilePage.text();
assert.equal(meta(profileHtml, "og:type"), "profile");
assert.equal(meta(profileHtml, "og:url"), `${base}/@${username}`);
assert.equal((await guest.page("/not-a-profile")).status, 404);

// Market listings resolve by the short reference through the API as well.
const listing = await owner("market", "POST", {
  title: "Колёса " + nonce,
  description: "Пара колёс",
  category: "components",
  listingType: "sale",
  condition: "used",
  price: 9000,
  currency: "RUB",
  location: "",
  contact: "",
  status: "active",
});
assert.equal(listing.status, 201);
assert.match(listing.body.public_id, /^[0-9a-z]{8}$/);
const handle = `${listing.body.slug}-${listing.body.public_id}`;
const marketPage = await guest.page("/market/" + listing.body.shareId);
assert.equal(marketPage.status, 308);
assert.equal(location(marketPage), "/market/" + encodeURIComponent(handle));
const byHandle = await guest("market/public/" + encodeURIComponent(handle));
assert.equal(byHandle.status, 200);
assert.equal(byHandle.body.listing.shareId, listing.body.shareId);
assert.equal((await guest("market/public/unknown-zzzzzzzz")).status, 404);
console.log(
  "Public URLs HTTP: canonical redirects, renamed slugs, previews with photos, private bikes, profiles and market references passed.",
);
