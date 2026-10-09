// Evidence of a sharded browser run (#386). Every shard job keeps two files: the
// manifest (the whole list of tests of its project and the list of its shard,
// both from `playwright test --list`) and the JSON report of the run. The
// summary job reads all of them and
//
//   - refuses the run if a shard is missing, repeated or red, if the shards of a
//     project do not add up to its whole list, or if a listed test has no result;
//   - writes the table of the run: counts, wall time, the slowest tests and
//     files, and where the time of each job went.
//
// A missing or unreadable file is a failure, never an absence of failures.
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The test as the report and the manifest both name it. */
export const testId = (project, file, line, title) =>
  `${project}|${file}:${line}|${title}`;

/** Every test of a `--list` / run report as `{ id, project, file, test }`. */
export function collectTests(report) {
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        out.push({
          id: testId(test.projectName, spec.file, spec.line, spec.title),
          project: test.projectName,
          file: spec.file,
          test,
        });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

/** The ids of a `--list` report, sorted. */
export const listedIds = (report) =>
  collectTests(report)
    .map((entry) => entry.id)
    .sort();

/** What happened to each test of a run report. */
export function summarizeRun(report) {
  const tests = collectTests(report).map(({ id, file, test }) => {
    const results = test.results ?? [];
    const duration = results.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    return {
      id,
      file,
      status: test.status, // expected | unexpected | skipped | flaky
      duration,
      attempts: results.length,
      ran: results.some((r) => r.status !== "skipped"),
    };
  });
  const count = (predicate) => tests.filter(predicate).length;
  return {
    tests,
    wall: report.stats?.duration ?? 0,
    counts: {
      discovered: tests.length,
      run: count((t) => t.ran),
      passed: count((t) => t.status === "expected" && t.ran),
      skipped: count((t) => t.status === "skipped"),
      failed: count((t) => t.status === "unexpected"),
      flaky: count((t) => t.status === "flaky"),
      retried: count((t) => t.attempts > 1),
    },
  };
}

const keyOf = ({ project, shard }) =>
  `${project}/${shard ? shard.current + "of" + shard.total : "all"}`;

/**
 * The problems of a run, or an empty list. `shards` are
 * `{ project, shard: {current,total}, full, listed, summary }` where `summary`
 * is missing when the report of the shard is.
 */
export function verifyRun(shards, { projects, total }) {
  const problems = [];
  const seen = new Map();
  for (const item of shards) {
    const key = keyOf(item);
    if (seen.has(key)) problems.push(`Shard ${key} is reported twice`);
    seen.set(key, item);
  }
  for (const project of projects) {
    const own = [];
    for (let current = 1; current <= total; current++) {
      const key = keyOf({ project, shard: { current, total } });
      const item = seen.get(key);
      if (!item) {
        problems.push(`Shard ${key} is missing: no manifest was kept`);
        continue;
      }
      own.push(item);
      if (!item.summary) problems.push(`Shard ${key} has no report of its run`);
    }
    for (const item of shards)
      if (
        item.project === project &&
        (!item.shard || item.shard.total !== total)
      )
        problems.push(
          `Shard ${keyOf(item)} does not belong to a split into ${total}`,
        );
    if (!own.length) continue;
    const full = own[0].full;
    for (const item of own)
      if (JSON.stringify(item.full) !== JSON.stringify(full))
        problems.push(
          `Shard ${keyOf(item)} saw another whole list of ${project} than shard ${keyOf(own[0])}`,
        );
    // The shards together are the whole list: nothing lost, nothing twice.
    const union = own.flatMap((item) => item.listed);
    const unionSet = new Set(union);
    if (union.length !== unionSet.size)
      problems.push(`A test of ${project} belongs to more than one shard`);
    const fullSet = new Set(full);
    for (const id of full)
      if (!unionSet.has(id)) problems.push(`Not in any shard: ${id}`);
    for (const id of union)
      if (!fullSet.has(id)) problems.push(`In a shard, not in the list: ${id}`);
    for (const item of own) {
      if (!item.summary) continue;
      const key = keyOf(item);
      const reported = new Set(item.summary.tests.map((t) => t.id));
      for (const id of item.listed)
        if (!reported.has(id)) problems.push(`${key} has no result for ${id}`);
      for (const id of reported)
        if (!item.listed.includes(id))
          problems.push(`${key} reports a test it was not given: ${id}`);
      const { failed, flaky, retried } = item.summary.counts;
      if (failed) problems.push(`${key}: ${failed} test(s) failed`);
      if (flaky)
        problems.push(`${key}: ${flaky} test(s) passed only on a retry`);
      if (retried && !flaky && !failed)
        problems.push(`${key}: ${retried} test(s) were retried`);
    }
  }
  for (const item of shards)
    if (!projects.includes(item.project))
      problems.push(`Shard ${keyOf(item)} is of an unexpected project`);
  return problems;
}

const seconds = (ms) => (ms / 1000).toFixed(1) + " s";
const minutes = (ms) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Where the time of the jobs of the run went: queue, setup, tests, artifacts. */
export function jobTimings(jobs) {
  const at = (value) => (value ? Date.parse(value) : NaN);
  return jobs
    .filter((job) => job.started_at && job.completed_at)
    .map((job) => {
      const part = { setup: 0, tests: 0, artifacts: 0 };
      for (const step of job.steps ?? []) {
        if (!step.started_at || !step.completed_at) continue;
        if (/^(Set up job|Complete job|Post )/.test(step.name)) continue;
        const length = at(step.completed_at) - at(step.started_at);
        const kind = /^Browser tests|^HTTP integration|^Application unit/.test(
          step.name,
        )
          ? "tests"
          : /upload|evidence|artifact|review|summary/i.test(step.name)
            ? "artifacts"
            : "setup";
        part[kind] += Number.isFinite(length) ? length : 0;
      }
      return {
        name: job.name,
        queue: Math.max(0, at(job.started_at) - at(job.created_at)) || 0,
        total: at(job.completed_at) - at(job.started_at),
        ...part,
      };
    });
}

/** The Markdown of the job summary. */
export function renderSummary(
  shards,
  problems,
  { timings = [], top = 10 } = {},
) {
  const lines = ["### Browser tests by shard", ""];
  lines.push(
    "| Project | Shard | Discovered | Run | Passed | Skipped | Failed | Flaky | Retried | Wall |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const item of [...shards].sort((a, b) =>
    keyOf(a).localeCompare(keyOf(b)),
  )) {
    const c = item.summary?.counts;
    lines.push(
      c
        ? `| ${item.project} | ${item.shard.current}/${item.shard.total} | ${c.discovered} | ${c.run} | ${c.passed} | ${c.skipped} | ${c.failed} | ${c.flaky} | ${c.retried} | ${minutes(item.summary.wall)} |`
        : `| ${item.project} | ${item.shard?.current}/${item.shard?.total} | — | — | — | — | — | — | — | no report |`,
    );
  }
  const all = shards.flatMap((item) =>
    (item.summary?.tests ?? []).map((t) => ({ ...t, shard: keyOf(item) })),
  );
  lines.push(
    "",
    `### The ${top} slowest tests`,
    "",
    "| Time | Shard | Test |",
    "| ---: | --- | --- |",
  );
  for (const t of [...all]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, top))
    lines.push(
      `| ${seconds(t.duration)} | ${t.shard} | ${t.id.split("|").slice(1).join(" ").replaceAll("|", "\\|")} |`,
    );
  const byFile = new Map();
  for (const t of all) {
    const key = `${t.shard} ${t.file}`;
    byFile.set(key, (byFile.get(key) ?? 0) + t.duration);
  }
  lines.push(
    "",
    `### The ${top} heaviest files`,
    "",
    "| Time | Shard · file |",
    "| ---: | --- |",
  );
  for (const [key, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, top))
    lines.push(`| ${seconds(ms)} | ${key} |`);
  if (timings.length) {
    lines.push(
      "",
      "### Where the time of each job went",
      "",
      "| Job | Queue | Setup | Tests | Artifacts | Total |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const t of timings)
      lines.push(
        `| ${t.name} | ${minutes(t.queue)} | ${minutes(t.setup)} | ${minutes(t.tests)} | ${minutes(t.artifacts)} | ${minutes(t.total)} |`,
      );
    const max = Math.max(...shards.map((s) => s.summary?.wall ?? 0));
    const min = Math.min(...shards.map((s) => s.summary?.wall ?? 0));
    lines.push(
      "",
      `Slowest shard ${minutes(max)}, fastest ${minutes(min)}; runner time of the browser jobs ${minutes(
        timings
          .filter((t) => t.name.startsWith("Browser"))
          .reduce((sum, t) => sum + t.total, 0),
      )}.`,
    );
  }
  lines.push("");
  if (problems.length)
    lines.push("### Problems", "", ...problems.map((p) => `- ${p}`), "");
  else
    lines.push(
      "Every shard reported, and together they are the whole list.",
      "",
    );
  return lines.join("\n");
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The files of the latest attempt of every shard. The artifact of a job is
 * `e2e-evidence-<shard>-<attempt>`; "re-run failed jobs" keeps the green shards
 * of the earlier attempt and uploads the repeated one under a new number, so
 * the newest number of a shard is the one that counts. Files that are not in
 * such a folder are all read.
 */
function latestAttempts(files) {
  const newest = new Map();
  const attempt = (file) =>
    /^(e2e-evidence-.+)-(\d+)$/.exec(file.split(path.sep)[0]);
  for (const file of files) {
    const found = attempt(file);
    if (found)
      newest.set(
        found[1],
        Math.max(newest.get(found[1]) ?? 0, Number(found[2])),
      );
  }
  return files.filter((file) => {
    const found = attempt(file);
    return !found || newest.get(found[1]) === Number(found[2]);
  });
}

/** Reads the evidence directory the jobs left: `manifest-*.json`, `results-*.json`. */
export async function loadEvidence(dir) {
  const files = latestAttempts(
    (await readdir(dir, { recursive: true })).map((f) => String(f)),
  );
  const shards = [];
  for (const file of files.filter(
    (f) => path.basename(f).startsWith("manifest-") && f.endsWith(".json"),
  )) {
    const manifest = await readJson(path.join(dir, file));
    if (!manifest) throw new Error(`Unreadable manifest ${file}`);
    const resultFile = files.find(
      (f) =>
        path.dirname(f) === path.dirname(file) &&
        path.basename(f) ===
          path.basename(file).replace("manifest-", "results-"),
    );
    const report = resultFile
      ? await readJson(path.join(dir, resultFile))
      : null;
    shards.push({
      project: manifest.project,
      shard: manifest.shard,
      full: manifest.full,
      listed: manifest.listed,
      summary: report ? summarizeRun(report) : null,
    });
  }
  return shards;
}

async function main(argv) {
  const dir = argv[0];
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  if (!dir || !flag("--projects") || !flag("--shards"))
    throw new Error(
      "usage: e2e-report.js <evidence dir> --projects a,b --shards N [--jobs jobs.json] [--summary file.md]",
    );
  const projects = flag("--projects").split(",");
  const total = Number(flag("--shards"));
  const shards = await loadEvidence(dir);
  const problems = verifyRun(shards, { projects, total });
  const jobsFile = flag("--jobs");
  const jobs = jobsFile ? ((await readJson(jobsFile))?.jobs ?? []) : [];
  const markdown = renderSummary(shards, problems, {
    timings: jobTimings(jobs),
  });
  if (flag("--summary"))
    await writeFile(flag("--summary"), markdown, { flag: "a" });
  else console.log(markdown);
  if (problems.length) {
    for (const problem of problems) console.error("::error::" + problem);
    process.exitCode = 1;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).catch((error) => {
    console.error("::error::" + error.message);
    process.exitCode = 1;
  });
