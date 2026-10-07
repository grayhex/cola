// Live run of the Reddit 10 benchmark through the service's own HTTP interface.
// Not part of CI and never run by the service. It uses the same safe HTTP client
// as the resolver (no cookies, no JavaScript, honest user agent); a source that
// refuses this network is reported as such, never worked around. Nothing is
// written to the repository: the report goes to stdout (and --json), raw pages
// to --record, from where capture-fixture.ts --raw reduces them.
//
//   node --import tsx scripts/benchmark-reddit10.ts [--manifest FILE] [--only N]
//     [--stores all] [--twice] [--cancel MS] [--record DIR] [--json FILE]
//
// --stores all  also asks the stores that are off by default
// --twice       asks every request a second time: cold and warm latency
// --cancel MS   first abandons the stream of the first request after MS (while
//               nothing is cached) and counts what the service still asks for
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { createAdapters } from "../src/adapters/index.js";
import { MemoryCache } from "../src/cache.js";
import { ManufacturerHttpClient } from "../src/http.js";
import { Resolver } from "../src/resolver.js";
import { SettingsStore } from "../src/settings.js";

const flags = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++)
  if (process.argv[i].startsWith("--")) {
    const next = process.argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? "" : next;
    flags.set(process.argv[i].slice(2), value);
    if (value) i++;
  }
interface Bike {
  n: number;
  id: string;
  query: string;
  normalized: {
    brand: string;
    model: string;
    trim: string | null;
    year: number | null;
  };
  chosen?: { url: string } | null;
  // A page the person pastes when the search does not offer the bike.
  manualUrl?: { url: string } | null;
}
const manifestUrl = new URL(
  flags.get("manifest") || "../tests/fixtures/reddit10/manifest.json",
  flags.get("manifest") ? "file://" + process.cwd() + "/" : import.meta.url,
);
const bikes = (
  JSON.parse(readFileSync(manifestUrl, "utf8")) as { bikes: Bike[] }
).bikes.filter((b) => !flags.get("only") || String(b.n) === flags.get("only"));

// The response shapes this script reads; everything else is ignored.
interface Candidate {
  candidateId?: string;
  kind?: string;
  storeId?: string;
  canonicalName: string;
  year: number | null;
  url: string;
  quality?: { level: string; recognizedComponents: number };
  warnings?: string[];
}
interface Answer {
  status: string;
  reason?: string;
  candidates?: Candidate[];
  components?: unknown[];
  sourceYear?: number | null;
  warnings?: string[];
  source?: { url: string; kind?: string };
  search?: {
    complete: boolean;
    sources: {
      id: string;
      status: string;
      reason?: string;
      pages: number;
      candidates: number;
      durationMs: number;
    }[];
  };
}

process.env.LOG_LEVEL ??= "silent";
const quiet = {
  level: "silent",
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  silent() {},
  child() {
    return quiet;
  },
} as never;
const settings = new SettingsStore();
if (flags.get("stores") === "all")
  for (const id of Object.keys(settings.value.stores))
    (settings.value.stores as Record<string, boolean>)[id] = true;
const client = new ManufacturerHttpClient(
  quiet,
  700,
  10000,
  () => settings.value,
);
const network = {
  requests: 0,
  bytes: 0,
  failed: [] as string[],
  recorded: [] as Record<string, unknown>[],
};
const recordDir = flags.get("record");
if (recordDir) mkdirSync(recordDir, { recursive: true });
const getBytes = client.getBytes.bind(client);
client.getBytes = async (...args: Parameters<typeof getBytes>) => {
  network.requests++;
  try {
    const response = await getBytes(...args);
    network.bytes += response.bytes.length;
    if (recordDir) {
      const sha256 = createHash("sha256").update(response.bytes).digest("hex");
      writeFileSync(`${recordDir}/${sha256}.raw`, response.bytes);
      network.recorded.push({
        requestedUrl: args[0],
        url: response.url,
        contentType: response.contentType,
        fetchedAt: response.fetchedAt,
        sha256,
        bytes: response.bytes.length,
      });
    }
    return response;
  } catch (error) {
    network.failed.push(args[0]);
    throw error;
  }
};
const cache = new MemoryCache();
const app = buildApp(
  new Resolver(createAdapters(client), cache, quiet),
  cache,
  settings,
  client,
);

const post = async (path: string, payload: object): Promise<Answer> =>
  (await app.inject({ method: "POST", url: path, payload })).json();
const sameUrl = (a: string, b: string) =>
  a.replace(/\/$/, "") === b.replace(/\/$/, "");
async function run(bike: Bike) {
  const before = { ...network, failed: network.failed.length };
  const started = Date.now();
  const offered = await post("/v1/resolve", {
    ...bike.normalized,
    chooseCandidates: true,
  });
  const pick =
    offered.status === "ambiguous" && bike.chosen
      ? offered.candidates?.find((c) => sameUrl(c.url, bike.chosen!.url))
      : undefined;
  const resolved = pick
    ? await post("/v1/resolve", {
        ...bike.normalized,
        candidateId: pick.candidateId,
      })
    : undefined;
  const manual = bike.manualUrl
    ? await post("/v1/resolve-url", {
        ...bike.normalized,
        sourceUrl: bike.manualUrl.url,
      })
    : undefined;
  return {
    n: bike.n,
    query: bike.query,
    status: offered.status,
    reason: offered.reason,
    complete: offered.search?.complete,
    sources: offered.search?.sources.map((s) => ({
      id: s.id,
      status: s.status,
      reason: s.reason,
      pages: s.pages,
      candidates: s.candidates,
      ms: s.durationMs,
    })),
    candidates: offered.candidates?.map((c) => ({
      kind: c.kind,
      store: c.storeId,
      name: c.canonicalName,
      year: c.year,
      quality: c.quality?.level,
      components: c.quality?.recognizedComponents,
      warnings: c.warnings,
      url: c.url,
    })),
    chosen: pick ? pick.url : null,
    resolved: resolved && {
      status: resolved.status,
      components: resolved.components?.length,
      year: resolved.sourceYear,
      warnings: resolved.warnings,
      kind: resolved.source?.kind,
    },
    manual: manual && {
      status: manual.status,
      reason: manual.reason,
      components: manual.components?.length,
      year: manual.sourceYear,
      warnings: manual.warnings,
      kind: manual.source?.kind,
    },
    ms: Date.now() - started,
    requests: network.requests - before.requests,
    kilobytes: Math.round((network.bytes - before.bytes) / 1024),
    failedRequests: network.failed.slice(before.failed),
  };
}

const report: unknown[] = [];

if (flags.has("cancel") && bikes.length) {
  // A request abandoned in the middle of its fan-out stops asking. It runs first,
  // while nothing is cached: a warm process would not ask for anything at all.
  const after = Number(flags.get("cancel")) || 800;
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  const before = network.requests;
  const response = await fetch(address + "/v1/resolve/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...bikes[0].normalized, chooseCandidates: true }),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), after);
  await response.body
    ?.getReader()
    .read()
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, after + 100));
  const atAbort = network.requests - before;
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const settled = network.requests - before;
  const cancelled = {
    cancelAfterMs: after,
    requestsAtAbort: atAbort,
    requestsStartedAfterAbort: settled - atAbort,
  };
  report.push({ cancelled });
  console.log("cancel:", JSON.stringify(cancelled));
  app.server.closeAllConnections();
}

for (const bike of bikes)
  for (const pass of flags.has("twice") ? ["cold", "warm"] : ["cold"]) {
    const row = { pass, ...(await run(bike)) };
    report.push(row);
    console.log(
      [
        String(row.n).padStart(2),
        pass,
        row.query.padEnd(38),
        row.status.padEnd(20),
        `candidates ${row.candidates?.length ?? 0}`.padEnd(14),
        row.resolved
          ? `resolved ${row.resolved.components} parts`
          : row.chosen
            ? "chosen"
            : "-",
        row.manual
          ? `url: ${row.manual.status}${row.manual.components ? " " + row.manual.components + " parts" : ""}`
          : "-",
        `${row.requests} requests ${row.kilobytes} KB ${row.ms} ms`,
      ].join(" | "),
    );
  }

if (recordDir)
  writeFileSync(
    `${recordDir}/index.json`,
    JSON.stringify(network.recorded, null, 1),
  );
if (flags.get("json"))
  writeFileSync(
    flags.get("json")!,
    JSON.stringify({ at: new Date().toISOString(), report }, null, 1),
  );
await app.close();
