// Prove the native gate rejects real API/DTO/null errors, TSX and new JS.
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
    path.join(api, "route.ts"),
    `
import { currentUser } from ${JSON.stringify("../../../lib/auth.ts")};
import { publicAuthor } from ${JSON.stringify("../../../lib/profile-dto.ts")};
export async function GET(request: Request) {
  const viewer = await currentUser();
  if (viewer) viewer.role = 42;
  publicAuthor({ id: 42, username: "probe", name: "Probe" });
  return new Response(request.nonexistentProperty);
}
`,
  );
  const apiResult = check("tsconfig.json");
  assert.match(apiResult, /route\.ts.*TS2322/);
  assert.match(apiResult, /route\.ts.*TS2769/);
  assert.match(apiResult, /route\.ts.*TS2339/);
  await rm(api, { recursive: true, force: true });
  const lib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  dirs.push(lib);
  await writeFile(
    path.join(lib, "null.ts"),
    `
import { ownedBike } from ${JSON.stringify("../repository.ts")};
import { currentViewer } from ${JSON.stringify("../viewer.ts")};
import type { Queryable } from ${JSON.stringify("../repository.ts")};
export async function probe(db: Queryable) {
  const bike = await ownedBike(db, "id", "owner");
  const viewer = await currentViewer();
  return bike.name + viewer.id;
}
`,
  );
  const nullResult = check("tsconfig.json");
  assert.match(nullResult, /null\.ts.*TS18047: 'bike'/);
  assert.match(nullResult, /null\.ts.*TS18047: 'viewer'/);
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
import type { PublicAuthor, Viewer, BikeInput, Page } from ${JSON.stringify("../contracts.ts")};
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
import type { PublicAuthor, Viewer, BikeInput, ApiError, Page } from ${JSON.stringify("../contracts.ts")};
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
  // SQL values stay typed and nullable; an untyped query cannot leak unknown fields.
  await writeFile(
    path.join(nativeLib, "rows.ts"),
    `
import type { Queryable } from ${JSON.stringify("../db.ts")};
export async function rows(db: Queryable) {
  const typed = await db.query<{id: string; happened_at: Date | null}>("SELECT id,happened_at FROM probe");
  const id: number = typed.rows[0].id;
  const date = typed.rows[0].happened_at.toISOString();
  const untyped = await db.query("SELECT secret FROM probe");
  const secret: string = untyped.rows[0].secret;
  return {id, date, secret};
}
`,
  );
  const rowResult = check("tsconfig.json");
  assert.equal((rowResult.match(/rows\.ts.*TS2322/g) || []).length, 2);
  assert.match(rowResult, /rows\.ts.*TS2531/);
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
  // Real migrated UI boundaries must reject bad props, preferences and DTOs.
  await writeFile(
    path.join(nativeApp, "core.tsx"),
    `
import { CompactDialog } from ${JSON.stringify("../ui/compact-ui.tsx")};
import { useSite } from ${JSON.stringify("../ui/site-provider.tsx")};
import { socialApi } from ${JSON.stringify("../ui/social-primitives.tsx")};
import type { MeResponse, LegalMetadataDto } from ${JSON.stringify("../../lib/contracts.ts")};
export function CoreProbe() {
  const { viewer, setPreferences } = useSite();
  setPreferences({ showMileage: "yes" });
  return <CompactDialog open="yes" title="Probe" onClose={() => {}}>{viewer.email}</CompactDialog>;
}
export async function responseProbe() {
  const result = await socialApi<MeResponse>("me");
  return result.nonexistentProperty;
}
export function legalProbe(data: LegalMetadataDto): string {
  return data.documents.terms.revision;
}
`,
  );
  const coreResult = check("tsconfig.json");
  assert.equal((coreResult.match(/core\.tsx.*TS2322/g) || []).length, 3);
  assert.match(coreResult, /core\.tsx.*TS18047/);
  assert.match(coreResult, /core\.tsx.*TS2339/);
  // Admin setting keys, modal modes and feature DTOs must retain their exact contracts.
  await writeFile(
    path.join(nativeApp, "catalog.tsx"),
    `
import type { SettingsChange } from ${JSON.stringify("../admin/types.ts")};
import type { GarageModalState, BikeFormData } from ${JSON.stringify("../ui/garage/types.ts")};
import type { ExperienceSearchDto } from ${JSON.stringify("../../lib/contracts.ts")};
export function settingsProbe(change: SettingsChange) {
  change("autoScrollSpeed", "fast");
  change("brandLogoId", 42);
}
export const modal: GarageModalState = { type: "deletePhoto", section: "build" };
export function bikeProbe(data: BikeFormData) { data.is_public = "yes"; }
export function searchProbe(data: ExperienceSearchDto) {
  if (data.type === "users") return data.items[0].email;
  if (data.type === "journal") return data.items[0].weight;
}
`,
  );
  const catalogResult = check("tsconfig.json");
  assert.equal((catalogResult.match(/catalog\.tsx.*TS2345/g) || []).length, 2);
  assert.match(catalogResult, /catalog\.tsx.*TS2353/);
  assert.match(catalogResult, /catalog\.tsx.*TS2322/);
  assert.equal((catalogResult.match(/catalog\.tsx.*TS2339/g) || []).length, 2);
  // Content views consume distinct list/save DTOs and exact discussion targets.
  await writeFile(
    path.join(nativeApp, "content.tsx"),
    `
import Discussion from ${JSON.stringify("../ui/discussion.tsx")};
import type { FeedDto, JournalSaved, MarketContactDto } from ${JSON.stringify("../ui/content-types.ts")};
export function feedProbe(data: FeedDto) {
  data.total = "1";
  const item = data.items[0];
  if (item.kind === "market") return item.geometry;
  return item.author.email;
}
export function savedProbe(data: JournalSaved) { return data.photos; }
export function contactProbe(data: MarketContactDto): string { return data; }
export const discussion = <Discussion bike={{id:"probe"}} user={null} entityType="user" />;
`,
  );
  const contentResult = check("tsconfig.json");
  assert.equal((contentResult.match(/content\.tsx.*TS2322/g) || []).length, 3);
  assert.equal((contentResult.match(/content\.tsx.*TS2339/g) || []).length, 3);
  // Ride forms, telemetry and serialized integration DTOs remain distinct.
  await writeFile(
    path.join(nativeApp, "rides.tsx"),
    `
import PlanComposer from ${JSON.stringify("../ui/plan-composer.tsx")};
import type { RideDto } from ${JSON.stringify("../ui/content-types.ts")};
import type { RideResponse, RidePreview, RideAnalysisSeries, IntentPreferencesDto, ActivityDto } from ${JSON.stringify("../ui/ride-types.ts")};
export function responseProbe(data: RideResponse) { data.rsvp = "organizer"; }
export function previewProbe(data: RidePreview) { data.previewId = 1; }
export function analysisProbe(data: RideAnalysisSeries) { data.segments[0][0].hrBpm = "1"; }
export function authorProbe(data: RideDto) { return data.author.email; }
export function preferencesProbe(data: IntentPreferencesDto) { return data.windows; }
export function activityProbe(data: ActivityDto) { return data.accessToken; }
export const planner = <PlanComposer onClose={() => {}} onSaved={() => {}} draft={{passport: {distanceKm: {min: "1"}}}} />;
`,
  );
  const ridesResult = check("tsconfig.json");
  assert.equal((ridesResult.match(/rides\.tsx.*TS2322/g) || []).length, 4);
  assert.equal((ridesResult.match(/rides\.tsx.*TS2339/g) || []).length, 3);
  await rm(nativeApp, { recursive: true, force: true });
  await rm(nativeApi, { recursive: true, force: true });

  // Scan the actual working tree; untracked JS must not evade the CI policy.
  const policyApp = await mkdtemp(path.join(root, "app/typecheck-probe-"));
  const policyLib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  const policyApi = await mkdtemp(path.join(root, "app/api/typecheck-probe-"));
  dirs.push(policyApp, policyLib, policyApi);
  for (const [dir, name] of [
    [policyApp, "new.js"],
    [policyApp, "new.jsx"],
    [policyLib, "new.mjs"],
    [policyLib, "new.cjs"],
    [policyApi, "route.js"],
    [policyApp, "version.js"],
    [policyLib, "version.js"],
  ])
    await writeFile(path.join(dir, name), "export const value = 1;\n");
  const policy = run("scripts/check-production-typescript.js");
  assert.equal(policy.status, 1, policy.stdout + policy.stderr);
  for (const ext of ["js", "jsx", "mjs", "cjs"])
    assert.ok(policy.stderr.includes(`new.${ext}`), policy.stderr);
  assert.ok(policy.stderr.includes("route.js"), policy.stderr);
  for (const dir of [policyApp, policyLib])
    assert.ok(
      policy.stderr.includes(`${path.relative(root, dir)}/version.js`),
      policy.stderr,
    );
  await rm(policyApp, { recursive: true, force: true });
  await rm(policyLib, { recursive: true, force: true });
  await rm(policyApi, { recursive: true, force: true });

  // Shared modules also run directly in workers and ops, without a TS loader.
  const runtimeLib = await mkdtemp(path.join(root, "lib/typecheck-probe-"));
  dirs.push(runtimeLib);
  await writeFile(
    path.join(runtimeLib, "unsupported.ts"),
    "export class Unsupported { constructor(public value: string) {} }\n",
  );
  const runtimePolicy = run("scripts/check-production-typescript.js");
  assert.equal(
    runtimePolicy.status,
    1,
    runtimePolicy.stdout + runtimePolicy.stderr,
  );
  assert.match(runtimePolicy.stderr, /unsupported\.ts/);
  assert.match(runtimePolicy.stderr, /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/);
  await rm(runtimeLib, { recursive: true, force: true });

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
    "Typecheck gates reject native API/DTO/null errors, strict TS/TSX errors, new JS, non-erasable shared TS and TS lint suppressions.",
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
