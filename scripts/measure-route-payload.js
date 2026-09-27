// Compare production builds against the same disposable data. This measures
// server HTML's eager scripts, not post-hydration chunks or browser Web Vitals.
import { gzipSync } from "node:zlib";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin))
  throw new Error("Measure a local disposable production build only");
const paths = process.argv.slice(2);
const results = [];
for (const path of paths.length
  ? paths
  : ["/", "/bikes", "/journal", "/rides"]) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("Expected a local route");
  await (await fetch(url)).text(); // warm the route once
  const timings = [];
  let html;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const response = await fetch(url);
    timings.push(performance.now() - start);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    html = await response.text();
  }
  const scripts = [
    ...new Set(
      [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
    ),
  ];
  let jsGzipBytes = 0;
  for (const src of scripts) {
    const scriptUrl = new URL(src.replaceAll("&amp;", "&"), origin);
    if (scriptUrl.origin !== origin)
      throw new Error("Unexpected external script");
    const response = await fetch(scriptUrl);
    if (!response.ok) throw new Error(`Script HTTP ${response.status}`);
    jsGzipBytes += gzipSync(Buffer.from(await response.arrayBuffer()), {
      level: 9,
    }).length;
  }
  results.push({
    path,
    scripts: scripts.length,
    jsGzipBytes,
    htmlGzipBytes: gzipSync(html, { level: 9 }).length,
    warmTtfbMedianMs: +timings.sort((a, b) => a - b)[2].toFixed(1),
  });
}
console.log(JSON.stringify(results, null, 2));
