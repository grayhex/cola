// Prove CI covers the new directories and rejects real type/null mistakes.
// The probes are temporary source files, not @ts-expect-error assertions that
// could pass when a directory is accidentally excluded from the compiler.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const dirs = [];
try {
  const api = await mkdtemp(path.join(root, "app/api/typecheck-probe-"));
  dirs.push(api);
  await writeFile(
    path.join(api, "route.js"),
    `
import { currentUser } from ${JSON.stringify("../../../lib/auth.js")};
import { publicAuthor } from ${JSON.stringify("../../../lib/profile-dto.js")};
/** @param {Request} request */
export async function GET(request) {
  const viewer = await currentUser();
  if (viewer) viewer.role = 42;
  publicAuthor({ id: 42, username: "probe", name: "Probe" });
  return new Response(request.nonexistentProperty);
}
`,
  );
  const apiResult = check("jsconfig.json");
  assert.match(apiResult, /route\.js.*TS2322/);
  assert.match(apiResult, /route\.js.*TS2769/);
  assert.match(apiResult, /route\.js.*TS2339/);
  await rm(api, { recursive: true, force: true });
  const lib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  dirs.push(lib);
  await writeFile(
    path.join(lib, "null.js"),
    `
import { ownedBike } from ${JSON.stringify("../repository.js")};
import { currentViewer } from ${JSON.stringify("../viewer.js")};
/** @param {import(${JSON.stringify("../repository.js")}).Queryable} db */
export async function probe(db) {
  const bike = await ownedBike(db, "id", "owner");
  const viewer = await currentViewer();
  return bike.name + viewer.id;
}
`,
  );
  const nullResult = check("jsconfig.strict.json");
  assert.match(nullResult, /null\.js.*TS18047: 'bike'/);
  assert.match(nullResult, /null\.js.*TS18047: 'viewer'/);
  console.log(
    "Typecheck gates reject API, DTO, repository-null and viewer-null mistakes.",
  );
} finally {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}
function check(config) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", config, "--pretty", "false"],
    { cwd: root, encoding: "utf8" },
  );
  assert.ok([1, 2].includes(result.status), result.stderr || result.stdout);
  return result.stdout;
}
