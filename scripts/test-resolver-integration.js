import net from "node:net";
import { seedLegalDocuments } from "../tests/fixtures/legal.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
// Starts an isolated, disposable DB, fixture resolver and built app in one process tree.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), "cola-integration-"));
const children = [],
  logs = [];
const base = "http://localhost:3100";
const externalDatabase = process.env.TEST_DATABASE_URL;
let databaseAdmin,
  databaseCreated = false;
const databaseName = "cola_test_" + randomUUID().replaceAll("-", "");
const environment = {
  ...process.env,
  DATABASE_URL: externalDatabase || "postgres://test:test@127.0.0.1:5432/test",
  DATABASE_POOL_MAX: externalDatabase ? "10" : "1",
  BIKE_RESOLVER_URL: "http://127.0.0.1:8081",
  APP_ORIGIN: base,
  TEST_ORIGIN: base,
  COOKIE_SECURE: "false",
  MAX_PHOTOS_PER_USER: "20",
  UPLOAD_DIR: path.join(dir, "uploads"),
  RIDES_DIR: path.join(dir, "rides"),
  MAP_STYLE_URL: process.argv.includes("--e2e")
    ? base + "/test-map-style.json"
    : "",
};
function start(args, cwd = root) {
  const log = path.join(dir, logs.length + ".log");
  logs.push(log);
  const fd = openSync(log, "w");
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  children.push(child);
  return child;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    if (children.some((p) => p.exitCode !== null))
      throw new Error("A test service exited");
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Service not ready: " + url);
}
try {
  for (const port of externalDatabase ? [8081, 3100] : [5432, 8081, 3100])
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", () =>
        reject(new Error("Test port already occupied: " + port)),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
  if (externalDatabase) {
    databaseAdmin = new pg.Client({
      connectionString: externalDatabase,
      connectionTimeoutMillis: 5000,
    });
    await databaseAdmin.connect();
    // Never migrate or seed the database named in the supplied admin connection.
    await databaseAdmin.query('CREATE DATABASE "' + databaseName + '"');
    databaseCreated = true;
    const url = new URL(externalDatabase);
    url.pathname = "/" + databaseName;
    environment.DATABASE_URL = url.toString();
    const migration = start(["scripts/migrate.js"]);
    await new Promise((resolve, reject) =>
      migration.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Migration failed")),
      ),
    );
    children.splice(children.indexOf(migration), 1);
    const fixtureDb = new pg.Client({ connectionString: environment.DATABASE_URL });
    await fixtureDb.connect();
    try { await seedLegalDocuments(fixtureDb); } finally { await fixtureDb.end(); }
  } else {
    start(["scripts/test-db.js"]);
    console.log(
      "PGlite fallback: single connection; concurrent quota test requires TEST_DATABASE_URL (PostgreSQL 17 in CI).",
    );
  }
  start(
    ["--import", "tsx", "tests/fixture-server.ts"],
    path.join(root, "services/bike-resolver"),
  );
  await ready("http://127.0.0.1:8081/ready");
  start([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ]);
  await ready(base + "/api/ready");
  const e2e = process.argv.includes("--e2e");
  for (const test of e2e
    ? ["node_modules/@playwright/test/cli.js"]
    : [
        "tests/http-smoke.js",
        "tests/admin-http.js",
        "tests/resolver-http.js",
        "tests/layout-http.js",
        "tests/wizard-http.js",
        "tests/showcase-http.js",
        "tests/social-http.js",
        "tests/community-http.js",
        ...(externalDatabase ? ["tests/community-concurrency.js"] : []),
        "tests/rides-http.js",
        "tests/journal-http.js",
        "tests/discovery-http.js",
        "tests/gamification-http.js",
        "tests/legal-http.js",
        ...(externalDatabase ? ["tests/quota-http.js"] : []),
      ])
    await new Promise((resolve, reject) => {
      const project = environment.COLA_CI_PLAYWRIGHT_PROJECT;
      const args = e2e
        ? [test, "test", ...(project ? ["--project", project] : [])]
        : [test];
      const p = spawn(process.execPath, args, {
        cwd: root,
        env: environment,
        stdio: "inherit",
      });
      children.push(p);
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(test + " exited " + code)),
      );
    });
} catch (e) {
  for (const log of logs)
    console.error((await readFile(log, "utf8")).slice(-6000));
  throw e;
} finally {
  await Promise.all(
    children.map((p) =>
      p.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            p.once("exit", resolve);
            p.kill("SIGTERM");
          }),
    ),
  );
  try {
    if (databaseCreated)
      await databaseAdmin.query(
        'DROP DATABASE "' + databaseName + '" WITH (FORCE)',
      );
  } finally {
    await databaseAdmin?.end();
    await rm(dir, { recursive: true, force: true });
  }
}
