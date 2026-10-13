// Report-only scan: findings (2) are data; an operational error (1) stays red.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || "design-qa-report");
const targets = process.argv.slice(3);
if (!targets.length) targets.push("app/");
const scan = spawnSync(
  process.execPath,
  [join(directory, "impeccable.mjs"), "detect", "--json", ...targets],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
await mkdir(output, { recursive: true });
await writeFile(join(output, "findings.json"), scan.stdout || "[]\n");
await writeFile(
  join(output, "diagnostics.txt"),
  (scan.stderr || "") + (scan.error ? scan.error.message + "\n" : ""),
);
let findings;
try {
  findings = JSON.parse(scan.stdout || "[]");
  if (!Array.isArray(findings)) throw new Error("Expected a findings array");
} catch (error) {
  process.stderr.write(`Unreadable detector report: ${error.message}\n`);
}
const code = scan.error ? 1 : scan.status;
const failed = !findings || ![0, 2].includes(code);
const metadata = {
  cliVersion: "4.5.2",
  engineVersion: "0.1.14",
  skillCommit: "d631a8827f99414d2b6daba4ef08b7f8701751d7",
  targets,
  exitCode: code,
  outcome: failed ? "error" : code === 2 ? "findings" : "clean",
  primary: failed
    ? null
    : findings.filter((finding) => !finding.advisory).length,
  advisory: failed
    ? null
    : findings.filter((finding) => finding.advisory).length,
};
await writeFile(
  join(output, "scan.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
const summary = [
  "# Impeccable — report only",
  "",
  `Outcome: **${metadata.outcome}**; detector exit code: **${code}**.`,
  `Primary: ${metadata.primary ?? "unknown"}; advisory: ${metadata.advisory ?? "unknown"}.`,
  "",
  "A detector finding needs contextual verification; this is not the full UX audit.",
  "Exit 1 / missing output is a scan failure, never a clean result.",
  "",
].join("\n");
await writeFile(join(output, "summary.md"), summary);
process.stdout.write(summary);
process.exit(failed ? 1 : 0);
