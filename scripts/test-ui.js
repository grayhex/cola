// Focused local UI checks: one disposable DB and app process tree, no resolver.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const root = new URL("../", import.meta.url).pathname;
const args = process.argv.slice(2);
const dir = await mkdtemp(path.join(tmpdir(), "cola-ui-"));
const children = [],
  logs = [];
const env = {
  ...process.env,
  DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test",
  DATABASE_POOL_MAX: "1",
  COOKIE_SECURE: "false",
  APP_ORIGIN: "http://localhost:3100",
  TEST_ORIGIN: "http://localhost:3100",
  NEXT_TELEMETRY_DISABLED: "1",
  RIDES_DIR: path.join(dir, "rides"),
  UPLOAD_DIR: path.join(dir, "uploads"),
};
function start(args) {
  const log = path.join(dir, logs.length + ".log"),
    fd = openSync(log, "w");
  logs.push(log);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  children.push(child);
  return child;
}
try {
  start(["scripts/test-db.js"]);
  start([
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (children.some((p) => p.exitCode !== null))
      throw new Error("UI test service exited");
    try {
      if ((await fetch(env.TEST_ORIGIN + "/api/ready")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("UI test app did not become ready");
  const p = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      ...(args.some((v) => v.endsWith(".spec.js"))
        ? []
        : ["tests/e2e/gallery-interactions.spec.js"]),
      ...(args.some((v) => v.startsWith("--project"))
        ? []
        : ["--project=chromium"]),
      ...args,
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  children.push(p);
  const code = await new Promise((resolve) => p.once("exit", resolve));
  if (code !== 0) throw new Error("UI tests exited " + code);
} catch (e) {
  for (const log of logs)
    console.error((await readFile(log, "utf8")).slice(-3000));
  process.exitCode = 1;
  console.error(e.message);
} finally {
  await Promise.all(
    children
      .filter((p) => p.exitCode === null)
      .map(
        (p) =>
          new Promise((resolve) => {
            p.once("exit", resolve);
            p.kill("SIGTERM");
          }),
      ),
  );
  await rm(dir, { recursive: true, force: true });
}
