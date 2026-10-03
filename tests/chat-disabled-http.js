import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN;
const register = await verifiedFetch(base + "/api/auth/register", {
  method: "POST",
  headers: { origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({
    ...testConsents,
    name: "Chat disabled",
    email: randomUUID() + "@example.test",
    password: "disabled-chat-test-123",
  }),
});
assert.equal(register.status, 201);
const cookie = register.headers.get("set-cookie").split(";")[0];
const token = await fetch(base + "/api/chat/token", {
  method: "POST",
  headers: { origin: base, cookie, "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(token.status, 503);
assert.equal((await token.json()).enabled, false);
// The native bridge says the same in the envelope of API v1.
const v1 = await fetch(base + "/api/v1/chat/token", {
  method: "POST",
  headers: { origin: base, cookie },
});
assert.equal(v1.status, 503);
assert.equal((await v1.json()).error.code, "service_unavailable");
const page = await fetch(base + "/messages", { headers: { cookie } });
assert.equal(page.status, 200);
assert.match(await page.text(), /Сообщения пока отключены/);
assert.doesNotMatch(
  page.headers.get("content-security-policy-report-only") || "",
  /stream-io/,
);
assert.equal((await fetch(base + "/api/ready")).status, 200);
console.log(
  "Chat without configuration: disabled page and token endpoint; site readiness unaffected.",
);
