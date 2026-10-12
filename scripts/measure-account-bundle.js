// Authenticated local production builds, a disposable database and Chromium.
// Before/after are separate browser contexts; no production traffic or cookie.
import pg from "pg";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { spawn } from "node:child_process";
import { seedSiteDefaults } from "../tests/support/database.ts";
import { userRow, sessionRow } from "../tests/support/people.ts";
import { bikeRow } from "../tests/support/bikes.ts";
import { digest } from "../lib/password.ts";
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !["localhost", "127.0.0.1"].includes(new URL(connection).hostname)
)
  throw new Error("Use local disposable PostgreSQL");
const builds = process.argv.slice(2);
if (!builds.length) throw new Error("Pass paths to built checkout(s)");
const admin = new pg.Client({ connectionString: connection });
await admin.connect();
const name = "cola_bundle_" + randomUUID().replaceAll("-", "");
let db,
  browser,
  created = false;
try {
  await admin.query(`CREATE DATABASE ${name}`);
  created = true;
  const url = new URL(connection);
  url.pathname = "/" + name;
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.query(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await seedSiteDefaults(db);
  const owner = await userRow(db, { email_verified_at: new Date() }),
    token = randomUUID();
  await sessionRow(db, owner.id, { token_hash: digest(token) });
  for (let i = 0; i < 4; i++)
    await bikeRow(db, owner.id, {
      name: "Bundle bike " + i,
      is_public: i % 2 === 0,
    });
  browser = await chromium.launch({ headless: true });
  for (const directory of builds) {
    const cwd = path.resolve(directory),
      origin = "http://127.0.0.1:3102";
    const server = spawn(
      process.execPath,
      [
        path.join(cwd, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3102",
      ],
      {
        cwd,
        env: {
          ...process.env,
          DATABASE_URL: url.href,
          APP_ORIGIN: origin,
          COOKIE_SECURE: "false",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          ready = (await fetch(origin + "/api/ready")).ok;
          if (ready) break;
        } catch {
          /* Starting. */
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      if (!ready) throw new Error("Build server did not start");
      for (const tab of [
        "profile",
        "appearance",
        "account",
        "overview",
        "bikes",
        "rides",
        "integrations",
      ]) {
        const context = await browser.newContext({ baseURL: origin });
        try {
          await context.addCookies([
            { name: "cola_session", value: token, url: origin, httpOnly: true },
          ]);
          const page = await context.newPage(),
            scripts = [],
            bikeReads = [];
          page.on("requestfinished", (request) => {
            if (request.resourceType() === "script")
              scripts.push(
                request.response().then(async (response) => ({
                  url: request.url(),
                  bytes: gzipSync(await response.body()).length,
                })),
              );
          });
          page.on("request", (request) => {
            if (new URL(request.url()).pathname === "/api/bikes")
              bikeReads.push(new URL(request.url()).search);
          });
          const start = performance.now();
          await page.goto(
            "/account" + (tab === "overview" ? "" : "?tab=" + tab),
            { waitUntil: "networkidle" },
          );
          await page.locator(".account-layout").waitFor();
          const sizes = await Promise.all(scripts);
          console.log(
            JSON.stringify({
              build: cwd,
              tab,
              gzipBytes: sizes.reduce((sum, s) => sum + s.bytes, 0),
              scriptCount: sizes.length,
              bikeReads,
              elapsedToNetworkIdleMs: +(performance.now() - start).toFixed(1),
              note: "JS transfer only; elapsed includes networkidle, not LCP/INP",
            }),
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      server.kill("SIGTERM");
      await new Promise((done) => server.once("exit", done));
    }
  }
} finally {
  if (browser) await browser.close();
  if (db) await db.end();
  if (created) await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
}
