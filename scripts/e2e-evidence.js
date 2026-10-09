// Keeps the manifest of one browser shard (#386): the whole list of tests of its
// project and the part of it this shard runs, both read from Playwright itself
// (`test --list`, no servers needed). Together with the JSON report of the run
// it is what the summary job checks.
//
//   COLA_CI_PLAYWRIGHT_PROJECT=chromium COLA_CI_PLAYWRIGHT_SHARD=1/2 \
//     node scripts/e2e-evidence.js e2e-evidence
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { browserRun, playwrightArgs, shardLabel } from "./e2e-options.js";
import { listedIds } from "./e2e-report.js";

const run = promisify(execFile);
const dir = process.argv[2];
if (!dir) throw new Error("usage: e2e-evidence.js <directory>");
const { project, shard } = browserRun(process.argv.slice(3), process.env);
if (!project || !shard)
  throw new Error("The manifest of a shard needs its project and its shard");
async function list(options) {
  const { stdout } = await run(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      ...playwrightArgs(options, ["--list", "--reporter=json"]),
    ],
    {
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, COLA_E2E_REPORT: "" },
    },
  );
  return listedIds(JSON.parse(stdout));
}
const [full, listed] = await Promise.all([
  list({ project, shard: null }),
  list({ project, shard }),
]);
if (!full.length || !listed.length)
  throw new Error(`No tests were listed for ${project} ${shardLabel(shard)}`);
await mkdir(dir, { recursive: true });
const file = path.join(dir, `manifest-${project}-${shardLabel(shard)}.json`);
await writeFile(file, JSON.stringify({ project, shard, full, listed }) + "\n");
console.log(`${file}: ${listed.length} of ${full.length} tests of ${project}`);
