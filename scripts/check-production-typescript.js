// A frozen list permits existing JS during #256; directory globs would also
// silently permit new debt. Remove entries when migrating their files to TS.
import { stripTypeScriptTypes } from "node:module";
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
const runtimeErrors = [];
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
if (runtimeErrors.length) {
  console.error(
    "Shared lib TypeScript must run with Node type stripping:\n" +
      runtimeErrors.join("\n"),
  );
  process.exitCode = 1;
}
if (!process.exitCode)
  console.log(
    "Production TypeScript policy: no new JavaScript; shared TS supports Node type stripping.",
  );

async function walk(dir) {
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const filename = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(filename);
    else if (
      dir.startsWith("lib") &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      try {
        stripTypeScriptTypes(
          await readFile(path.join(root, filename), "utf8"),
          { mode: "strip", sourceUrl: filename },
        );
      } catch (error) {
        runtimeErrors.push(
          `${filename}: ${error.code || error.name}: ${error.message}`,
        );
      }
    } else if (/\.(?:[cm]?js|jsx)$/.test(entry.name)) {
      present.add(filename);
      const backend =
        filename.startsWith("lib/") || filename.startsWith("app/api/");
      if (!allowed.has(filename) || (backend && filename !== "lib/version.js"))
        unexpected.push(filename);
    }
  }
}
