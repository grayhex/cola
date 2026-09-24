// The reader comes from the server layout (#74): the first HTML already has
// the signed-in header and the owner's controls, with no guest state first.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  const call = async (url, method = "GET", data) => {
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
  call.page = async (path) => {
    const response = await fetch(base + path, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });
    return { status: response.status, html: await response.text() };
  };
  return call;
}
const reader = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8),
  name = "Читатель " + nonce;
assert.equal(
  (
    await reader("auth/register", "POST", {
      ...testConsents,
      name,
      email: `viewer-${nonce}@example.test`,
      password: "viewer-http-secret-123",
    })
  ).status,
  201,
);
const created = await reader("bikes", "POST", {
  name: "Свой байк " + nonce,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
});
assert.equal(created.status, 201, JSON.stringify(created.body));
const { bike } = (await reader("bikes/" + created.body.id)).body;
const bikePath = "/b/" + encodeURIComponent(`${bike.slug}-${bike.public_id}`);
const account = `aria-label="Аккаунт — ${name}"`;
const guestLogin = /class="nav-trigger" href="\/account">[\s\S]{0,400}?Войти/;
// A 404 page is not in this list: Next sends it as an empty shell and draws it
// in the browser, where server-render.spec.js checks its header.
for (const path of ["/", "/bikes", "/journal", "/articles", "/rides", "/market", "/records", "/about", "/legal/terms", "/account", bikePath]) {
  const own = await reader.page(path);
  assert.equal(own.status, 200, path);
  assert.ok(own.html.includes(account), path + ": signed-in header");
  assert.doesNotMatch(own.html, guestLogin, path + ": no guest header");
  const other = await guest.page(path);
  assert.ok(!other.html.includes("Аккаунт — "), path + ": guest header");
}
// The owner's own bike page arrives with the owner's controls.
const own = (await reader.page(bikePath)).html;
assert.match(own, /aria-label="Управление велосипедом"/);
assert.doesNotMatch(
  (await guest.page(bikePath)).html,
  /aria-label="Управление велосипедом"/,
);
console.log(
  "Viewer HTTP: signed-in header and owner controls come with the server HTML, guests never see them.",
);
