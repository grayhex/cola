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
const environment = {
  ...process.env,
  DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test",
  BIKE_RESOLVER_URL: "http://127.0.0.1:8081",
  APP_ORIGIN: base,
  TEST_ORIGIN: base,
  COOKIE_SECURE: "false",
  UPLOAD_DIR: path.join(dir, "uploads"),
};
function start(args, cwd = root) {
  const log = path.join(dir, children.length + ".log");
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
  start(["scripts/test-db.js"]);
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
  await ready(base + "/api/health");
  for (const test of [
    "tests/http-smoke.js",
    "tests/admin-http.js",
    "tests/resolver-http.js",
  ])
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [test], {
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
  await rm(dir, { recursive: true, force: true });
}
