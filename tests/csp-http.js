import assert from "node:assert/strict";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const first = await fetch(base + "/about", { headers: { "x-cola-nonce": "attacker", "Content-Security-Policy": "script-src 'nonce-attacker'" } });
const policy = first.headers.get("content-security-policy-report-only");
assert.match(policy, /script-src 'self' 'nonce-[A-Za-z0-9+/]+' 'strict-dynamic'/);
assert.doesNotMatch(policy, /attacker|unsafe-eval/);
assert.match(first.headers.get("content-security-policy"), /frame-ancestors 'none'/);
assert.match(first.headers.get("cache-control"), /no-store/);
const nonce = policy.match(/'nonce-([^']+)'/)[1];
const html = await first.text();
const scripts = html.match(/<script\b[^>]*>/g) || [];
assert.ok(scripts.length > 2);
for (const script of scripts) assert.ok(script.includes(`nonce="${nonce}"`), "each SSR script has the request nonce");
assert.ok(html.includes(`<style nonce="${nonce}"`), "theme style carries nonce");
const second = await fetch(base + "/about");
assert.notEqual(second.headers.get("content-security-policy-report-only"), policy);
assert.equal((await fetch(base + "/api/status")).headers.get("content-security-policy-report-only"), null);
const post = (body, headers = {}) => fetch(base + "/api/csp-reports", { method: "POST", headers: { origin: base, "Content-Type": "application/csp-report", ...headers }, body: JSON.stringify(body) });
const report = { "csp-report": { "document-uri": base + "/about?token=secret", "effective-directive": "script-src-elem", "blocked-uri": "inline", "script-sample": "secret", "original-policy": policy } };
assert.equal((await post(report, { origin: "https://evil.test" })).status, 403);
assert.equal((await post(report, { "Content-Type": "application/json" })).status, 415);
assert.equal((await post({ ...report, extra: "x".repeat(17000) })).status, 400);
assert.equal((await post({})).status, 400);
assert.equal((await post(report)).status, 204);
assert.equal((await post([{ type: "csp-violation", body: { documentURL: base + "/about", effectiveDirective: "script-src-elem", blockedURL: "inline" } }], { "Content-Type": "application/reports+json" })).status, 204);
let limited = false;
for (let i = 0; i < 125; i++) {
  const response = await post(report);
  if (response.status === 429) { limited = true; break; }
  assert.equal(response.status, 204);
}
assert.ok(limited, "CSP intake has a bounded global budget");
console.log("CSP HTTP: report-only, fresh server nonce, no-store, script/style nonces, report formats, origin/size/rate checks passed.");
