// A frozen list permits existing JS during #256; directory globs would also
// silently permit new debt. Remove entries when migrating their files to TS.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = JSON.parse(
  await readFile(
    new URL("./production-js-baseline.json", import.meta.url),
    "utf8",
  ),
);
const allowed = new Set(baseline);
// Exact generated exception, owned by scripts/build-version.js; not a glob.
allowed.add("lib/version.js");
const unexpected = [];
const present = new Set();
for (const dir of ["app", "lib"]) await walk(dir);
const stale = baseline.filter((filename) => !present.has(filename));
if (unexpected.length) {
  console.error(
    "New production JavaScript is forbidden; use .ts/.tsx:\n" +
      unexpected.sort().join("\n"),
  );
  process.exitCode = 1;
}
if (stale.length) {
  console.error(
    "Remove migrated/deleted files from production-js-baseline.json:\n" +
      stale.sort().join("\n"),
  );
  process.exitCode = 1;
}
if (!process.exitCode)
  console.log("Production TypeScript policy: no new JavaScript files.");

async function walk(dir) {
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const filename = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(filename);
    else if (/\.(?:[cm]?js|jsx)$/.test(entry.name)) {
      present.add(filename);
      if (!allowed.has(filename)) unexpected.push(filename);
    }
  }
}
