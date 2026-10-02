import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The runner image ships only a few lib files for the startup check
// (scripts/check-runtime.js). An import outside that list makes the web
// container crash at start, which only the Docker drill would notice.
test("the startup check imports only files the runner image copies", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const copied = new Set(
    dockerfile
      .match(/^COPY lib\/runtime-config\.ts (.+) \.\/lib\/$/m)[1]
      .split(/\s+/)
      .concat("lib/runtime-config.ts")
      .map((f) => path.normalize(f)),
  );
  copied.add(path.normalize("lib/version.js"));
  const seen = new Set();
  const check = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const [, spec] of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = path.normalize(path.join(path.dirname(file), spec));
      assert.ok(
        copied.has(target),
        `${file} imports ${target}, which the runner image does not copy`,
      );
      await check(target);
    }
  };
  const entry = await readFile("scripts/check-runtime.js", "utf8");
  for (const [, spec] of entry.matchAll(/from\s+"(\.[^"]+)"/g))
    await check(path.normalize(path.join("scripts", spec)));
});
