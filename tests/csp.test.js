import test from "node:test";
import assert from "node:assert/strict";
import { cspMode, pageCsp, mapOrigins } from "../lib/csp.js";
import { cspReports } from "../lib/csp-reports.js";
test("CSP mode and map sources cannot inject directives or weaken scripts", () => {
  assert.equal(cspMode({}), "report-only");
  for (const mode of ["off", "report-only", "enforce"]) assert.equal(cspMode({ CSP_MODE: mode }), mode);
  assert.throws(() => cspMode({ CSP_MODE: "on" }));
  for (const source of ["https:", "https://*.example.com", "https://x.test;report-uri", "https://x.test%3breport-uri", "https://x.test'", "https://x.test/path", "https://x.test/?key=secret", "http://x.test", "https://a:b@x.test", "'unsafe-inline'"])
    assert.throws(() => mapOrigins(source));
  assert.deepEqual(mapOrigins("https://tiles.example.test https://tiles.example.test/"), ["https://tiles.example.test"]);
  const policy = pageCsp("randomNonce", { NODE_ENV: "production" });
  assert.doesNotMatch(policy.split(";").map(s => s.trim()).find(s => s.startsWith("script-src ")), /unsafe-inline|unsafe-eval/);
  assert.match(policy, /worker-src 'self'/);
  assert.throws(() => pageCsp("bad'; script-src *"));
});
test("CSP legacy and Reporting API reports discard private data", () => {
  const origin = "https://example.test";
  const body = { "document-uri": origin + "/b/private-name?token=secret#secret", "effective-directive": "script-src-elem", "blocked-uri": "https://private-user.example/script?key=secret", "script-sample": "secret", "original-policy": "nonce-secret" };
  const expected = [{ directive: "script-src-elem", route: "/b/:path", source: "external", disposition: "report" }];
  assert.deepEqual(cspReports({ "csp-report": body }, origin), expected);
  assert.deepEqual(cspReports([{ type: "csp-violation", body: { documentURL: body["document-uri"], effectiveDirective: "script-src-elem", blockedURL: body["blocked-uri"] } }], origin), expected);
  assert.throws(() => cspReports({ "csp-report": { ...body, "document-uri": "https://evil.test" } }, origin));
  assert.throws(() => cspReports(Array(11).fill({}), origin));
  assert.throws(() => cspReports({ "csp-report": { ...body, "effective-directive": "secret" } }, origin));
});
