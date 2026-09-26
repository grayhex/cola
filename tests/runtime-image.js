// Run only via stdin inside the disposable Compose drill, never ship in the image.
import assert from "node:assert/strict";
import { access, readFile, readdir, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

assert.equal(process.env.COLA_DISPOSABLE_RUNTIME_TEST, "1", "Disposable drill opt-in required");
assert.equal(process.cwd(), "/app");
assert.notEqual(process.getuid(), 0, "The actual app container must run non-root");
const root = process.cwd();
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const require = createRequire(path.join(root, "package.json"));
const scripts = [
  "audit-photo-files.js", "bootstrap-admin.js", "check-runtime.js",
  "cleanup-rides.js", "migrate.js", "recalculate-photo-storage.js", "reset-password.js",
  "set-admin.js",
];
assert.deepEqual((await readdir("scripts")).sort(), scripts);
for (const name of scripts) execFileSync(process.execPath, ["--check", `scripts/${name}`]);
for (const file of ["docs", "tests", "workbench", "ops", "services", "scripts/fixtures"])
  await assert.rejects(access(file), { code: "ENOENT" });
for (const name of ["@electric-sql/pglite", "@playwright/test", "vitest", "prettier"])
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });

const { defaultSettings, defaultCatalog } = await load("lib/site-defaults.js");
const { bootstrapAdmin } = await load("scripts/bootstrap-admin.js");
await load("lib/rides.js");
await load("lib/factory-import.js");
const { default: sharp } = await import("sharp");
assert.ok((await sharp({ create: {
  width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
} }).webp().toBuffer()).length > 0, "Native image dependency works");
const mapDist = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist");
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  assert.deepEqual(await readFile(`public/maplibre/${name}`), await readFile(path.join(mapDist, name)));
  assert.equal((await fetch(`http://localhost:3000/maplibre/${name}`)).status, 200);
}
await access("public/fonts/sourcesans3-OFL.txt");
assert.equal((await fetch("http://localhost:3000/api/ready")).status, 200);
const cspPage = await fetch("http://localhost:3000/about");
assert.match(cspPage.headers.get("content-security-policy-report-only") || "", /nonce-/);
assert.match(cspPage.headers.get("cache-control") || "", /no-store/);
assert.equal((await fetch(process.env.BIKE_RESOLVER_URL + "/ready")).status, 200);

for (const dir of [process.env.UPLOAD_DIR, process.env.RIDES_DIR]) {
  assert.ok(dir);
  assert.deepEqual(await readdir(dir), [], "Fresh startup must not create content files");
  const probe = path.join(dir, ".runtime-probe-" + randomUUID());
  try {
    await writeFile(probe, "runtime-storage");
    assert.equal(await readFile(probe, "utf8"), "runtime-storage");
  } finally { await rm(probe, { force: true }); }
}
const migrationSource = await readFile("scripts/migrate.js", "utf8");
const versions = [...migrationSource.matchAll(/"(\d{3}_[a-z0-9_]+)"/g)].map((m) => m[1]);
assert.ok(versions.includes("020_bike_classification"));
assert.ok(versions.every((v) => !v.startsWith("013_")), "Retired number is never reused");
assert.deepEqual((await readdir("db")).sort(), versions.map((v) => v + ".sql").sort());
const beforeClassification = versions.slice(0, versions.indexOf("020_bike_classification"));
const history = async (q) => (await q.query(
  "SELECT version,applied_at::text FROM schema_migrations ORDER BY version",
)).rows;
const counts = async (q) => (await q.query(
  "SELECT (SELECT count(*)::int FROM users) users, (SELECT count(*)::int FROM bikes) bikes, (SELECT count(*)::int FROM rides) rides",
)).rows[0];
function runScript(file, env, args = []) {
  try {
    return execFileSync(process.execPath, [file, ...args], {
      cwd: root, env: { ...process.env, ...env }, encoding: "utf8",
    });
  } catch (error) {
    console.error(error.stdout?.toString(), error.stderr?.toString());
    throw error;
  }
}
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const { db: libraryPool } = await load("lib/db.js");
await admin.connect();
async function isolatedDatabase(label, check) {
  // Names are generated here, never supplied by the caller. Only created DBs are dropped.
  const name = "cola_pack_" + randomUUID().replaceAll("-", "");
  const dir = await mkdtemp(path.join(tmpdir(), "cola-package-"));
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = "/" + name;
  const env = { DATABASE_URL: url.toString(), UPLOAD_DIR: path.join(dir, "uploads"), RIDES_DIR: path.join(dir, "rides") };
  const q = new pg.Client({ connectionString: env.DATABASE_URL });
  let created = false;
  try {
    await mkdir(env.UPLOAD_DIR);
    await mkdir(env.RIDES_DIR);
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await q.connect();
    await check(q, env);
    assert.deepEqual(await readdir(env.UPLOAD_DIR), []);
    assert.deepEqual(await readdir(env.RIDES_DIR), []);
    console.log("Final-image migration contract:", label);
  } finally {
    await q.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await rm(dir, { recursive: true, force: true });
  }
}
try {
  assert.deepEqual(await counts(admin), { users: 0, bikes: 0, rides: 0 });
  assert.deepEqual((await history(admin)).map((r) => r.version), [...versions].sort());
  runScript("scripts/check-runtime.js");

  await isolatedDatabase("empty database, repeat, bootstrap rollback", async (q, env) => {
    runScript("scripts/migrate.js", env);
    const first = await history(q);
    assert.deepEqual(first.map((r) => r.version), [...versions].sort());
    assert.deepEqual(await counts(q), { users: 0, bikes: 0, rides: 0 });
    runScript("scripts/migrate.js", env);
    assert.deepEqual(await history(q), first, "A repeat must preserve applied_at and history");
    assert.deepEqual(await counts(q), { users: 0, bikes: 0, rides: 0 });
    await q.query("BEGIN");
    try {
      const account = await bootstrapAdmin(q, {
        email: "bootstrap@example.test", name: "Runtime fixture", password: "Runtime-fixture-password-123!",
      });
      assert.equal((await q.query("SELECT role FROM users WHERE id=$1", [account.id])).rows[0].role, "admin");
    } finally { await q.query("ROLLBACK"); }
    assert.deepEqual(await counts(q), { users: 0, bikes: 0, rides: 0 });
  });

  await isolatedDatabase("pre-020 schema, retired history row, retained user data", async (q, env) => {
    await q.query("CREATE TABLE schema_migrations(version text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
    for (const version of beforeClassification) {
      await q.query(await readFile(`db/${version}.sql`, "utf8"));
      await q.query("INSERT INTO schema_migrations(version,applied_at) VALUES($1,'2020-01-01T00:00:00Z')", [version]);
    }
    // This is a historical registry row, not a demo importer or a replacement migration.
    await q.query("INSERT INTO schema_migrations(version,applied_at) VALUES('013_hagsy_demo','2020-02-03T04:05:06Z')");
    await q.query("INSERT INTO site_settings(id,value) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [JSON.stringify(defaultSettings)]);
    await q.query("INSERT INTO site_catalog(id,value) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [JSON.stringify(defaultCatalog)]);
    const owner = randomUUID(), bike = randomUUID();
    await q.query("INSERT INTO users(id,email,name,password_hash,username) VALUES($1,'upgrade@example.test','Upgrade fixture','hash','runtime_fixture')", [owner]);
    await q.query("INSERT INTO bikes(id,share_id,owner_id,name,year,category,purposes,is_public) VALUES($1,$1,$2,'Retained bicycle',2021,'gravel',ARRAY['city'],true)", [bike, owner]);
    const oldHistory = await history(q);
    const selectBike = "SELECT id,share_id,owner_id,name,year,category,purposes,factory_spec FROM bikes WHERE id=$1";
    const oldBike = (await q.query(selectBike, [bike])).rows[0];
    const oldSettings = (await q.query("SELECT value FROM site_settings WHERE id=1")).rows[0].value;
    runScript("scripts/migrate.js", env);
    const upgraded = await history(q);
    assert.deepEqual(upgraded.filter((r) => oldHistory.some((old) => old.version === r.version)), oldHistory);
    assert.deepEqual(upgraded.map((r) => r.version), [...versions, "013_hagsy_demo"].sort());
    assert.deepEqual((await q.query(selectBike, [bike])).rows[0], oldBike);
    assert.deepEqual((await q.query("SELECT value FROM site_settings WHERE id=1")).rows[0].value, oldSettings);
    const classification = (await q.query("SELECT classification FROM bikes WHERE id=$1", [bike])).rows[0].classification;
    assert.equal(classification.category, "road_gravel");
    assert.equal(classification.subtype, "gravel");
    assert.equal(classification.suspension, null);
    assert.equal(classification.construction, null);
    assert.deepEqual(classification.uses, ["commuting"]);
    assert.deepEqual(await counts(q), { users: 1, bikes: 1, rides: 0 });
    runScript("scripts/migrate.js", env);
    assert.deepEqual(await history(q), upgraded);
    assert.deepEqual(await counts(q), { users: 1, bikes: 1, rides: 0 });
    runScript("scripts/set-admin.js", env, ["upgrade@example.test"]);
    assert.equal((await q.query("SELECT role FROM users WHERE id=$1", [owner])).rows[0].role, "admin");
    // Operator password reset reads stdin and ends every session of the account.
    await q.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", ["f".repeat(64), owner]);
    execFileSync(process.execPath, ["scripts/reset-password.js", "upgrade@example.test"], {
      cwd: root, env: { ...process.env, ...env }, input: "Runtime-reset-password-123\n", encoding: "utf8",
    });
    const reset = (await q.query("SELECT password_hash,password_changed_at FROM users WHERE id=$1", [owner])).rows[0];
    assert.notEqual(reset.password_hash, "hash");
    assert.ok(reset.password_changed_at);
    assert.equal((await q.query("SELECT count(*)::int n FROM sessions WHERE user_id=$1", [owner])).rows[0].n, 0);
    for (const file of ["audit-photo-files.js", "recalculate-photo-storage.js", "cleanup-rides.js"])
      runScript("scripts/" + file, env);
  });
  assert.deepEqual(await counts(admin), { users: 0, bikes: 0, rides: 0 }, "Runtime tests must not seed the app DB");
  console.log("Final image: production dependencies, non-root, maps, storage, migrations and operator commands verified.");
} finally {
  await admin.end();
  await libraryPool.end();
}
