import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config.mjs";
import { assetContentSecurityPolicy } from "../lib/asset-security.js";

test("asset sandbox remains the final path policy without changing page headers", async () => {
  const rules = await config.headers();
  const general = rules.find((rule) => rule.source === "/:path*");
  const asset = rules.find((rule) => rule.source === "/api/assets/:id");
  const policy = (rule) => rule.headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.ok(rules.indexOf(asset) > rules.indexOf(general));
  assert.equal(policy(general), "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  assert.equal(policy(asset), assetContentSecurityPolicy);
  assert.match(assetContentSecurityPolicy, /(?:^|; )default-src 'none';/);
  assert.match(assetContentSecurityPolicy, /(?:^|; )img-src data:;/);
  assert.match(assetContentSecurityPolicy, /(?:^|; )sandbox$/);
  assert.doesNotMatch(assetContentSecurityPolicy, /allow-scripts|allow-same-origin|https?:|unsafe-eval/);
  assert.equal(general.headers.find((h) => h.key === "X-Content-Type-Options").value, "nosniff");
});
