// Run only via stdin inside the disposable Compose drill, never ship in the image.
import assert from "node:assert/strict";
import { access, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

assert.equal(
  process.env.COLA_DISPOSABLE_RUNTIME_TEST,
  "1",
  "Disposable drill opt-in required",
);
assert.equal(process.cwd(), "/app");
assert.notEqual(
  process.getuid(),
  0,
  "The actual app container must run non-root",
);
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const scripts = ["check-runtime.js"];
assert.deepEqual((await readdir("scripts")).sort(), scripts);
for (const name of scripts)
  execFileSync(process.execPath, ["--check", `scripts/${name}`]);
for (const name of ["db", "scripts/migrate.js", "scripts/bootstrap-admin.js"])
  await assert.rejects(access(name), { code: "ENOENT" });
for (const file of [
  "docs",
  "tests",
  "workbench",
  "ops",
  "services",
  "scripts/fixtures",
])
  await assert.rejects(access(file), { code: "ENOENT" });
for (const name of [
  "@electric-sql/pglite",
  "@playwright/test",
  "vitest",
  "prettier",
])
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });

const { default: sharp } = await import("sharp");
assert.ok(
  (
    await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .webp()
      .toBuffer()
  ).length > 0,
  "Native image dependency works",
);
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  assert.ok((await readFile(`public/maplibre/${name}`)).length > 1000);
  assert.equal(
    (await fetch(`http://localhost:3000/maplibre/${name}`)).status,
    200,
  );
}
const runtimeVersions = await readdir("public/rive/runtime");
assert.equal(runtimeVersions.length, 1);
for (const file of ["rive.wasm", "rive_fallback.wasm"]) {
  const bytes = await readFile(
    `public/rive/runtime/${runtimeVersions[0]}/${file}`,
  );
  assert.equal(bytes.subarray(0, 4).toString("hex"), "0061736d");
  assert.equal(
    (
      await fetch(
        `http://localhost:3000/rive/runtime/${runtimeVersions[0]}/${file}`,
      )
    ).status,
    200,
  );
}
for (const name of ["maplibre-gl", "@tiptap/core", "lucide-react"])
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
await access("public/fonts/sourcesans3-OFL.txt");
assert.equal((await fetch("http://localhost:3000/api/ready")).status, 200);
const cspPage = await fetch("http://localhost:3000/about");
assert.match(
  cspPage.headers.get("content-security-policy-report-only") || "",
  /nonce-/,
);
assert.match(cspPage.headers.get("cache-control") || "", /no-store/);
assert.equal(
  (await fetch(process.env.BIKE_RESOLVER_URL + "/ready")).status,
  200,
);

for (const dir of [process.env.UPLOAD_DIR, process.env.RIDES_DIR]) {
  assert.ok(dir);
  assert.deepEqual(
    await readdir(dir),
    [],
    "Fresh startup must not create content files",
  );
  const probe = path.join(dir, ".runtime-probe-" + randomUUID());
  try {
    await writeFile(probe, "runtime-storage");
    assert.equal(await readFile(probe, "utf8"), "runtime-storage");
  } finally {
    await rm(probe, { force: true });
  }
}
execFileSync(process.execPath, ["scripts/check-runtime.js"]);
console.log(
  "Web image: standalone dependencies, non-root, maps, Rive, storage and health verified; no migration/operator tooling.",
);
