// Records one public page as a reduced offline fixture with its provenance.
// Not part of CI and never run by the service. Live mode goes through the same
// safe HTTP client as the resolver (no cookies, no JavaScript, honest user
// agent); a page the network refuses is reported, never worked around. Raw mode
// reduces a file obtained elsewhere (e.g. a Common Crawl record) and keeps its
// origin in the manifest.
//
//   node --import tsx scripts/capture-fixture.ts --manifest M --dir D --id ID \
//     --store S --kind bike --url URL --keep "h1,title,#desc" [--expect JSON]
//   node --import tsx scripts/capture-fixture.ts ... --raw FILE --origin FILE.json
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import pino from "pino";
import { ManufacturerHttpClient } from "../src/http.js";
import { withResolution } from "../src/context.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const need = (name: string) => {
  const value = args.get(name);
  if (!value) throw new Error("--" + name + " is required");
  return value;
};
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const id = need("id"),
  manifestPath = need("manifest"),
  dir = need("dir"),
  url = need("url");
let body: string,
  finalUrl = url,
  fetchedAt = new Date().toISOString(),
  origin: Record<string, unknown> = { source: "live" };
if (args.has("raw")) {
  body = await readFile(args.get("raw")!, "utf8");
  origin = JSON.parse(await readFile(need("origin"), "utf8"));
  fetchedAt = String(origin.captureTimestamp ?? fetchedAt);
} else {
  const host = new URL(url).hostname;
  const client = new ManufacturerHttpClient(
    pino({ level: "silent" }),
    700,
    20000,
  );
  const doc = await withResolution(AbortSignal.timeout(90000), undefined, () =>
    client.get(url, [host, host.replace(/^www\./, "")]),
  );
  body = doc.body;
  finalUrl = doc.url;
  fetchedAt = doc.fetchedAt;
}
const rawSha256 = sha256(body);

let reduced: string;
const rule: Record<string, unknown> = {};
if (args.has("xml-keep")) {
  // Sitemaps: keep the entries whose address contains one of the literal
  // fragments (never a pattern built from an argument) plus a few unrelated ones.
  const fragments = args
      .get("xml-keep")!
      .split("|")
      .filter((fragment) => fragment),
    extra = Number(args.get("xml-extra") ?? 8);
  const index = /<sitemapindex/.test(body),
    tag = index ? "sitemap" : "url";
  const entries = [
    ...body.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g")),
  ].map((m) => m[0]);
  let others = 0;
  const kept = entries.filter((e) => {
    const loc = e.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1] ?? "";
    if (fragments.some((fragment) => loc.includes(fragment))) return true;
    return others++ < extra;
  });
  const root = index ? "sitemapindex" : "urlset";
  reduced =
    `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    kept.join("\n") +
    `\n</${root}>\n`;
  Object.assign(rule, {
    xmlKeep: fragments,
    unrelatedEntries: extra,
  });
} else if (args.has("keep")) {
  const $ = load(body),
    selectors = args
      .get("keep")!
      .split("|")
      .map((s) => s.trim());
  const head = [
    "title",
    'link[rel="canonical"]',
    'meta[property^="og:"]',
    'script[type="application/ld+json"]',
  ].flatMap((s) =>
    $(s)
      .toArray()
      .map((e) => $.html(e)),
  );
  const parts = selectors.flatMap((s) =>
    $(s)
      .toArray()
      .map((e) => $.html(e)),
  );
  reduced =
    "<!doctype html>\n<html><head>\n" +
    head.join("\n") +
    "\n</head><body>\n" +
    parts.join("\n") +
    "\n</body></html>\n";
  Object.assign(rule, {
    keep: selectors,
    alwaysKeptInHead: "title, canonical, og:*, application/ld+json",
  });
} else reduced = body;

await writeFile(
  `${dir}/${id}.${args.has("xml-keep") ? "xml" : "html"}`,
  reduced,
);
const entry = {
  id,
  store: need("store"),
  kind: need("kind"),
  requestedUrl: url,
  url: finalUrl,
  retrievedAt: fetchedAt,
  rawSha256,
  rawBytes: Buffer.byteLength(body),
  reducedSha256: sha256(reduced),
  reducedBytes: Buffer.byteLength(reduced),
  reduction: rule,
  origin,
  ...(args.has("expect") ? { expected: JSON.parse(args.get("expect")!) } : {}),
};
let manifest: { id: string }[] = [];
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {}
manifest = [...manifest.filter((m) => m.id !== id), entry];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    id,
    rawBytes: entry.rawBytes,
    reducedBytes: entry.reducedBytes,
    url: finalUrl,
  }),
);
