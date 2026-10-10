import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { testConsents } from "./fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const report = {
  description: 'HTTP report <img onerror="secret">',
  contact: "",
  diagnostics: {
    path: "/login",
    theme: "dark",
    width: 390,
    height: 844,
    browser: "Firefox 144",
  },
};
const send = (body, headers = {}) =>
  fetch(origin + "/api/bug-reports", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
assert.equal((await send(report, { origin: "https://evil.test" })).status, 403);
for (const input of [
  { ...report, to: "attacker@example.test" },
  { ...report, description: "" },
  { ...report, description: "x".repeat(33000) },
  {
    ...report,
    diagnostics: { ...report.diagnostics, path: "/login?password=secret" },
  },
])
  assert.equal((await send(input)).status, 400);
const sent = await send(report);
assert.equal(sent.status, 200);
const receipt = await sent.json();
assert.ok(receipt.id);
assert.equal(receipt.accepted, true);
const registered = await fetch(origin + "/api/auth/register", {
  method: "POST",
  headers: { origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    ...testConsents,
    name: "Reporter",
    email: randomUUID() + "@example.test",
    password: "bug-report-password-123",
  }),
});
assert.equal(registered.status, 201);
const cookie = registered.headers.get("set-cookie").split(";")[0];
// Direct localhost requests have no trusted reverse proxy; the user budget applies.
for (let i = 0; i < 5; i++)
  assert.equal(
    (
      await send(
        { ...report, description: "Unverified report " + i },
        { cookie },
      )
    ).status,
    200,
  );
assert.equal((await send(report, { cookie })).status, 429);
const capture = await Promise.all(
  (await readdir(process.env.MAIL_CAPTURE_DIR)).map(async (file) =>
    JSON.parse(
      await readFile(path.join(process.env.MAIL_CAPTURE_DIR, file), "utf8"),
    ),
  ),
);
const mail = capture.find((item) => item.subject.endsWith(receipt.id));
assert.ok(mail);
assert.equal(mail.to, "owner@example.test");
assert.match(mail.html, /&lt;img onerror=&quot;secret&quot;&gt;/);
assert.match(mail.text, /Email для ответа: Не указан/);
const html = await (await fetch(origin + "/")).text();
assert.match(html, /rel="canonical" href="http:\/\/localhost:3100\/"/);
assert.match(
  html,
  /property="og:image" content="http:\/\/localhost:3100\/api\/social-preview\/home\/image"/,
);
const image = await fetch(origin + "/api/social-preview/home/image");
assert.equal(image.status, 200);
assert.match(image.headers.get("content-type"), /^image\/jpeg/);
assert.ok((await image.arrayBuffer()).byteLength > 1000);
console.log(
  "First audience HTTP: strict bug reports, capture, unverified user limit, SSR root metadata and guest image passed",
);
