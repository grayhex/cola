// Production sources are native TS/TSX. The only JS exception is the exact
// generated version artifact; no baseline or directory glob permits new debt.
import { stripTypeScriptTypes } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Exact generated exception, owned by scripts/build-version.js; not a glob.
const allowed = new Set(["lib/version.js"]);
const unexpected = [];
const runtimeErrors = [];
for (const dir of ["app", "lib"]) await walk(dir);
if (unexpected.length) {
  console.error(
    "New production JavaScript is forbidden; use .ts/.tsx:\n" +
      unexpected.sort().join("\n"),
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
    "Production TypeScript policy: native TS/TSX, generated version.js only; shared TS supports Node type stripping.",
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
      if (!allowed.has(filename)) unexpected.push(filename);
    }
  }
}
