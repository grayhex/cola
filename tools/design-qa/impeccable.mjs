// Development-only bridge to the locked CLI and linked skill engine.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(directory, "package.json"));
const target = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const platform = require.resolve(`@impeccable/cli-${target}/package.json`);
const binary = join(
  dirname(platform),
  "bin",
  process.platform === "win32" ? "impeccable.exe" : "impeccable",
);
if (process.argv[2] === "--engine-path") {
  process.stdout.write(binary + "\n");
  process.exit(0);
}
const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    IMPECCABLE_SKILL_DIR: resolve(directory, "../../.agents/skills/impeccable"),
    IMPECCABLE_SELF: "node tools/design-qa/impeccable.mjs",
  },
});
if (result.error) {
  process.stderr.write(result.error.message + "\n");
  process.exit(1);
}
process.exit(result.status ?? 1);
