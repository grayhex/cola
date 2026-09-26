import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
// A second isolated app process proves runtime switching without a rebuild.
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
for (const mode of ["enforce", "off"]) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, CSP_MODE: mode }, stdio: "ignore" });
  try {
    let response;
    for (let i = 0; i < 60; i++) {
      assert.equal(child.exitCode, null, "CSP mode app stays alive");
      try { response = await fetch(`http://127.0.0.1:${port}/about`); if (response.ok) break; } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(response?.ok, "CSP mode app ready");
    const policy = response.headers.get("content-security-policy");
    assert.equal(response.headers.get("content-security-policy-report-only"), null);
    assert.match(policy, /frame-ancestors 'none'/);
    if (mode === "enforce") {
      assert.match(policy, /strict-dynamic/);
      const nonce = policy.match(/'nonce-([^']+)'/)[1];
      for (const script of (await response.text()).match(/<script\b[^>]*>/g)) assert.ok(script.includes(`nonce="${nonce}"`));
    } else assert.doesNotMatch(policy, /script-src|report-uri/);
  } finally {
    if (child.exitCode === null) await new Promise(resolve => { child.once("exit", resolve); child.kill("SIGTERM"); });
  }
}
console.log("CSP modes HTTP: runtime enforcement and baseline-only rollback passed without rebuild.");
