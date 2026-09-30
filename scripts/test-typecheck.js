// Prove legacy and native gates reject real errors, including TSX and new JS.
// The probes are temporary source files, not @ts-expect-error assertions that
// could pass when a directory is accidentally excluded from the compiler.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
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
  await rm(lib, { recursive: true, force: true });

  const nativeLib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  dirs.push(nativeLib);
  const nativeApp = await mkdtemp(path.join(root, "app/typecheck-probe-"));
  const nativeApi = await mkdtemp(path.join(root, "app/api/typecheck-probe-"));
  dirs.push(nativeApp, nativeApi);
  await writeFile(
    path.join(nativeApp, "view.tsx"),
    `
import styles from ${JSON.stringify("../about/about.module.css")};
import ${JSON.stringify("../styles/tokens.css")};
export default function Probe({ count }: { count: number }) {
  return <button className={styles.button} onClick={(event) => event.currentTarget.focus()}>{count}</button>;
}
`,
  );
  await writeFile(
    path.join(nativeApi, "route.ts"),
    "export async function GET(request: Request) { return new Response(request.url); }\n",
  );
  await writeFile(
    path.join(nativeLib, "strict.ts"),
    `
import type { PublicAuthor, Viewer, BikeInput, Page } from ${JSON.stringify("../contracts.js")};
export const author: PublicAuthor = { id: "id", username: "probe", name: "Probe", avatar: null };
export const page: Page<PublicAuthor> = { items: [author], total: 1, page: 1, pageSize: 20 };
export function viewerId(viewer: Viewer) { return viewer?.id ?? null; }
export function year(input: BikeInput): number { return input.year; }
`,
  );
  const valid = run("node_modules/@typescript/native/bin/tsc", [
    "-p",
    "tsconfig.json",
    "--pretty",
    "false",
  ]);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  await writeFile(
    path.join(nativeLib, "strict.ts"),
    `
import type { PublicAuthor, Viewer, BikeInput, ApiError, Page } from ${JSON.stringify("../contracts.js")};
export function implicit(value) { return value; }
export function nullable(viewer: Viewer) { return viewer.id; }
export const author: PublicAuthor = { id: "id", username: "probe", name: "Probe", avatar: null, email: "private" };
export const error: ApiError = { error: 42 };
export const page: Page<PublicAuthor> = { items: [], total: "1", page: 1, pageSize: 20 };
export function invalidInput(input: BikeInput) { input.year = "2026"; }
`,
  );
  const nativeResult = check("tsconfig.json");
  assert.match(nativeResult, /strict\.ts.*TS7006/);
  assert.match(nativeResult, /strict\.ts.*TS18047/);
  assert.match(nativeResult, /strict\.ts.*TS2353/);
  assert.equal((nativeResult.match(/strict\.ts.*TS2322/g) || []).length, 3);
  assert.ok(
    nativeResult.includes("Type 'string' is not assignable to type 'number'"),
    nativeResult,
  );
  await rm(nativeLib, { recursive: true, force: true });

  // Strict native code must also be checked under app/ and app/api/.
  await writeFile(
    path.join(nativeApp, "view.tsx"),
    `
export default function Probe({ count }: { count: number }) {
  const label: string = count;
  return <button onClick={(event) => event.nonexistentProperty}>{label}</button>;
}
`,
  );
  await writeFile(
    path.join(nativeApi, "route.ts"),
    `
export async function GET(request: Request) {
  return new Response(request.nonexistentProperty);
}
`,
  );
  const appResult = check("tsconfig.json");
  assert.match(appResult, /view\.tsx.*TS2322/);
  assert.match(appResult, /view\.tsx.*TS2339/);
  assert.match(appResult, /route\.ts.*TS2339/);
  await rm(nativeApp, { recursive: true, force: true });
  await rm(nativeApi, { recursive: true, force: true });

  // Scan the actual working tree; untracked JS must not evade the CI policy.
  const policyApp = await mkdtemp(path.join(root, "app/typecheck-probe-"));
  const policyLib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  dirs.push(policyApp, policyLib);
  for (const [dir, name] of [
    [policyApp, "new.js"],
    [policyApp, "new.jsx"],
    [policyLib, "new.mjs"],
    [policyLib, "new.cjs"],
  ])
    await writeFile(path.join(dir, name), "export const value = 1;\n");
  const policy = run("scripts/check-production-typescript.js");
  assert.equal(policy.status, 1, policy.stdout + policy.stderr);
  for (const ext of ["js", "jsx", "mjs", "cjs"])
    assert.ok(policy.stderr.includes(`new.${ext}`), policy.stderr);
  await rm(policyApp, { recursive: true, force: true });
  await rm(policyLib, { recursive: true, force: true });

  // A deleted/migrated path must leave the baseline, so it cannot be reused
  // later to sneak a new JS file through a grandfathered exception.
  const baselinePath = path.join(root, "scripts/production-js-baseline.json");
  const savedBaseline = await readFile(baselinePath, "utf8");
  try {
    await writeFile(
      baselinePath,
      JSON.stringify([...JSON.parse(savedBaseline), "lib/deleted-probe.js"]),
    );
    const stale = run("scripts/check-production-typescript.js");
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stderr, /lib\/deleted-probe\.js/);
  } finally {
    await writeFile(baselinePath, savedBaseline);
  }

  // The TS parser and recommended rules must run, rather than ignore TS files.
  const lint = run(
    "node_modules/eslint/bin/eslint.js",
    ["--stdin", "--stdin-filename", "lib/typecheck-probe.ts"],
    "// @ts-ignore\nexport const unsafe: any = 1;\n",
  );
  assert.equal(lint.status, 1, lint.stdout + lint.stderr);
  assert.match(lint.stdout, /@typescript-eslint\/no-explicit-any/);
  assert.match(lint.stdout, /@typescript-eslint\/ban-ts-comment/);
  console.log(
    "Typecheck gates reject legacy API/DTO/null errors, strict TS/TSX errors, new JS and TS lint suppressions.",
  );
} finally {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}
function check(config) {
  const result = run("node_modules/@typescript/native/bin/tsc", [
    "-p",
    config,
    "--pretty",
    "false",
  ]);
  assert.ok([1, 2].includes(result.status), result.stderr || result.stdout);
  return result.stdout;
}
function run(script, args = [], input) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
}
