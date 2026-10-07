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
const chatTests = process.argv.includes("--chat");
const chatFixture = chatTests || process.argv.includes("--e2e");
let databaseAdmin,
  databaseCreated = false;
const databaseName = "cola_test_" + randomUUID().replaceAll("-", "");
const environment = {
  ...process.env,
  DATABASE_URL: externalDatabase || "postgres://test:test@127.0.0.1:5432/test",
  DATABASE_POOL_MAX: externalDatabase ? "10" : "1",
  BIKE_RESOLVER_URL: "http://127.0.0.1:8081",
  APP_ORIGIN: base,
  // Exercise the full browser matrix with blocking CSP; deployment defaults to Report-Only.
  CSP_MODE:
    process.env.CSP_MODE ||
    (process.argv.includes("--e2e") ? "enforce" : "report-only"),
  TEST_ORIGIN: base,
  COOKIE_SECURE: "false",
  MAX_PHOTOS_PER_USER: "20",
  UPLOAD_DIR: path.join(dir, "uploads"),
  RIDES_DIR: path.join(dir, "rides"),
  // Emails become JSON files that account tests read (never in production).
  MAIL_CAPTURE_DIR: path.join(dir, "mail"),
  // Credentials are fixtures. Vendor substitution lives only in tests/, loaded
  // by Node in this child process, never by application code or production images.
  STREAM_CHAT_ENABLED: chatFixture ? "true" : "false",
  STREAM_CHAT_API_KEY: chatFixture ? "test-key" : "",
  STREAM_CHAT_API_SECRET: chatFixture ? "test-secret" : "",
  COLA_CHAT_FIXTURE: chatFixture ? "1" : "0",
  RWGPS_ENABLED: "true",
  RWGPS_API_KEY: "fixture-api",
  RWGPS_CLIENT_ID: "fixture-client",
  RWGPS_CLIENT_SECRET: "fixture-secret",
  ACTIVITY_TOKEN_KEY: "12".repeat(32),
  COLA_RWGPS_FIXTURE: "1",
  RWGPS_FIXTURE_FILE: path.join(dir, "rwgps.json"),
  YANDEX_ID_ENABLED: "true",
  YANDEX_ID_CLIENT_ID: "fixture-yandex-client",
  YANDEX_ID_CLIENT_SECRET: "fixture-yandex-secret",
  COLA_YANDEX_FIXTURE: "1",
  NATIVE_AUTH_RETURN_URL: "https://colabike.ru/app/auth",
  // A fixture, not a real certificate: the statement of the well-known file.
  ANDROID_CERT_SHA256:
    "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
  // The registry of push addresses works (#342); no provider token, so push stays unavailable.
  PUSH_TOKEN_KEY: "Zml4dHVyZS1wdXNoLWtleS0zMi1ieXRlcy1sb25nISE=",
  RUSTORE_PUSH_PROJECTS: "fixture-project",
  MAP_STYLE_URL: process.argv.includes("--e2e")
    ? base + "/test-map-style.json"
    : "",
  // HTTP runs deliver error reports to the fake tracker in observability-http.js.
  ...(process.argv.includes("--e2e")
    ? {}
    : { ERROR_TRACKER_DSN: "http://integration@127.0.0.1:8099/7" }),
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
  for (const port of [
    ...(externalDatabase ? [] : [5432]),
    8081,
    3100,
    ...(process.argv.includes("--e2e") ? [] : [8099]),
  ])
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
    const fixtureDb = new pg.Client({
      connectionString: environment.DATABASE_URL,
    });
    await fixtureDb.connect();
    try {
      await seedLegalDocuments(fixtureDb);
    } finally {
      await fixtureDb.end();
    }
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
    ...(chatFixture ? ["--import", "./tests/fixtures/chat-provider.js"] : []),
    "--import",
    "./tests/fixtures/rwgps-provider.js",
    "--import",
    "./tests/fixtures/yandex-provider.js",
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ]);
  await ready(base + "/api/ready");
  start([
    "--import",
    "./tests/fixtures/rwgps-provider.js",
    "scripts/activity-sync.js",
  ]);
  const e2e = process.argv.includes("--e2e");
  for (const test of e2e
    ? ["node_modules/@playwright/test/cli.js"]
    : chatTests
      ? ["tests/chat-http.js", "tests/api-v1-chat-http.js"]
      : [
          // First: the tracker budget is still unused right after startup.
          "tests/observability-http.js",
          "tests/csp-http.js",
          "tests/csp-modes-http.js",
          "tests/chat-disabled-http.js",
          "tests/email-policy-http.js",
          "tests/identities-http.js",
          "tests/device-sessions-http.js",
          "tests/http-smoke.js",
          "tests/media-http.js",
          "tests/market-http.js",
          "tests/public-urls-http.js",
          "tests/indexing-http.js",
          "tests/experience-landing-http.js",
          "tests/component-catalog-http.js",
          "tests/component-community-http.js",
          "tests/component-photo-search-http.js",
          "tests/market-catalog-http.js",
          "tests/viewer-http.js",
          "tests/api-v1-http.js",
          "tests/api-v1-users-http.js",
          "tests/api-v1-journal-http.js",
          "tests/api-v1-rides-http.js",
          "tests/api-v1-write-http.js",
          "tests/api-v1-bikes-write-http.js",
          "tests/api-v1-bike-photos-http.js",
          "tests/api-v1-journal-write-http.js",
          "tests/api-v1-account-delete-http.js",
          "tests/api-v1-blocks-http.js",
          "tests/api-v1-native-auth-http.js",
          "tests/api-v1-search-http.js",
          "tests/api-v1-components-http.js",
          "tests/api-v1-market-http.js",
          "tests/api-v1-personal-http.js",
          "tests/api-v1-comments-write-http.js",
          "tests/api-v1-planning-http.js",
          "tests/api-v1-nearby-http.js",
          "tests/api-v1-media-http.js",
          "tests/admin-http.js",
          "tests/app-config-http.js",
          "tests/resolver-http.js",
          "tests/resolver-stores-http.js",
          "tests/layout-http.js",
          "tests/wizard-http.js",
          "tests/showcase-http.js",
          "tests/social-http.js",
          "tests/community-http.js",
          ...(externalDatabase
            ? [
                "tests/community-concurrency.js",
                "tests/comment-threads-concurrency.js",
              ]
            : []),
          "tests/rides-http.js",
          "tests/ride-agreements-http.js",
          ...(externalDatabase ? ["tests/ride-agreements-concurrency.js"] : []),
          "tests/ride-intents-http.js",
          "tests/ride-matches-http.js",
          "tests/activity-sync-http.js",
          ...(externalDatabase ? ["tests/activity-sync-concurrency.js"] : []),
          ...(externalDatabase ? ["tests/ride-storage-concurrency.js"] : []),
          ...(externalDatabase ? ["tests/device-sessions-concurrency.js"] : []),
          ...(externalDatabase ? ["tests/api-v1-write-concurrency.js"] : []),
          "tests/journal-http.js",
          "tests/discovery-http.js",
          "tests/gamification-http.js",
          "tests/legal-http.js",
          "tests/account-http.js",
          "tests/account-security-http.js",
          "tests/notification-email-http.js",
          "tests/notification-state-http.js",
          "tests/push-device-http.js",
          "tests/ride-notifications-http.js",
          ...(externalDatabase
            ? [
                "tests/notification-email-concurrency.js",
                "tests/notification-state-concurrency.js",
                "tests/notification-fanout-concurrency.js",
                "tests/push-delivery-concurrency.js",
                "tests/ride-notifications-concurrency.js",
                "tests/bike-week-concurrency.js",
              ]
            : []),
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
