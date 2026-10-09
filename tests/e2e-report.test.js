import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  collectTests,
  jobTimings,
  listedIds,
  loadEvidence,
  renderSummary,
  summarizeRun,
  testId,
  verifyRun,
} from "../scripts/e2e-report.js";

const run = promisify(execFile);
// A Playwright JSON report: files with titled tests, each with its results.
function report(project, files, { duration = 60000 } = {}) {
  return {
    stats: { duration },
    suites: Object.entries(files).map(([file, specs]) => ({
      title: file,
      specs: [],
      suites: [
        {
          title: "group",
          specs: specs.map(({ title, line, status = "expected", results }) => ({
            title,
            file,
            line,
            tests: [
              {
                projectName: project,
                status,
                results: results ?? [
                  {
                    status: status === "skipped" ? "skipped" : "passed",
                    duration: 1000,
                  },
                ],
              },
            ],
          })),
        },
      ],
    })),
  };
}
const ids = (project, files) => listedIds(report(project, files));
const A = {
  "a.spec.js": [
    { title: "one", line: 3 },
    { title: "two", line: 9 },
  ],
};
const B = { "b.spec.js": [{ title: "three", line: 4 }] };
const both = { ...A, ...B };
function shard(project, current, own, whole = both, total = 2, run = own) {
  return {
    project,
    shard: { current, total },
    full: ids(project, whole),
    listed: ids(project, own),
    summary: run ? summarizeRun(report(project, run)) : null,
  };
}
const good = () => [
  shard("chromium", 1, A),
  shard("chromium", 2, B),
  shard("webkit-mobile", 1, A),
  shard("webkit-mobile", 2, B),
];
const expected = { projects: ["chromium", "webkit-mobile"], total: 2 };

test("tests are named by project, file, line and title, wherever the suite nests them", () => {
  assert.deepEqual(listedIds(report("chromium", A)), [
    testId("chromium", "a.spec.js", 3, "one"),
    testId("chromium", "a.spec.js", 9, "two"),
  ]);
  assert.equal(collectTests({ suites: [] }).length, 0);
});

test("a run is counted: passed, skipped, failed, flaky and retried tests apart", () => {
  const summary = summarizeRun(
    report("chromium", {
      "x.spec.js": [
        { title: "ok", line: 1 },
        { title: "skipped", line: 2, status: "skipped" },
        {
          title: "red",
          line: 3,
          status: "unexpected",
          results: [{ status: "failed", duration: 500 }],
        },
        {
          title: "flaky",
          line: 4,
          status: "flaky",
          results: [
            { status: "failed", duration: 100 },
            { status: "passed", duration: 200 },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(summary.counts, {
    discovered: 4,
    run: 3,
    // A test that passed only on a retry is counted as flaky, not as passed.
    passed: 1,
    skipped: 1,
    failed: 1,
    flaky: 1,
    retried: 1,
  });
  assert.equal(summary.tests.find((t) => t.id.endsWith("flaky")).duration, 300);
});

test("the shards of every browser that add up to its whole list pass", () => {
  assert.deepEqual(verifyRun(good(), expected), []);
});

test("a missing, repeated or foreign shard is a problem", () => {
  const [a, b, c] = good();
  assert.match(
    verifyRun([a, c], expected).join("\n"),
    /chromium\/2of2 is missing/,
  );
  assert.match(
    verifyRun([a, b, c], expected).join("\n"),
    /webkit-mobile\/2of2 is missing/,
  );
  assert.match(
    verifyRun([...good(), a], expected).join("\n"),
    /reported twice/,
  );
  assert.match(
    verifyRun([...good(), shard("firefox", 1, A)], expected).join("\n"),
    /unexpected project/,
  );
  assert.match(
    verifyRun([...good(), shard("chromium", 1, A, both, 3)], expected).join(
      "\n",
    ),
    /does not belong to a split into 2/,
  );
  assert.deepEqual(verifyRun([], expected).length, 4);
});

test("shards that lose or repeat a test, or disagree on the list, are refused", () => {
  const lost = good();
  lost[1] = shard("chromium", 2, {});
  assert.match(
    verifyRun(lost, expected).join("\n"),
    /Not in any shard: chromium\|b\.spec\.js:4\|three/,
  );
  const twice = good();
  twice[1] = shard("chromium", 2, both);
  assert.match(verifyRun(twice, expected).join("\n"), /more than one shard/);
  const alien = good();
  alien[1] = shard("chromium", 2, { "c.spec.js": [{ title: "new", line: 1 }] });
  assert.match(
    verifyRun(alien, expected).join("\n"),
    /not in the list: chromium\|c\.spec\.js:1\|new/,
  );
  const other = good();
  other[1] = shard("chromium", 2, B, {
    ...both,
    ...{ "z.spec.js": [{ title: "z", line: 1 }] },
  });
  assert.match(verifyRun(other, expected).join("\n"), /another whole list/);
});

test("a red shard, a missing report and a test without a result are not a pass", () => {
  const red = good();
  red[0] = shard("chromium", 1, A, both, 2, {
    "a.spec.js": [
      {
        title: "one",
        line: 3,
        status: "unexpected",
        results: [{ status: "failed", duration: 1 }],
      },
      { title: "two", line: 9 },
    ],
  });
  assert.match(
    verifyRun(red, expected).join("\n"),
    /chromium\/1of2: 1 test\(s\) failed/,
  );
  const none = good();
  none[2] = shard("webkit-mobile", 1, A, both, 2, null);
  assert.match(
    verifyRun(none, expected).join("\n"),
    /webkit-mobile\/1of2 has no report/,
  );
  const short = good();
  short[3] = shard("webkit-mobile", 2, B, both, 2, {});
  assert.match(
    verifyRun(short, expected).join("\n"),
    /has no result for webkit-mobile\|b\.spec\.js:4\|three/,
  );
  const extra = good();
  extra[3] = shard("webkit-mobile", 2, B, both, 2, both);
  assert.match(
    verifyRun(extra, expected).join("\n"),
    /reports a test it was not given/,
  );
  const flaky = good();
  flaky[1] = shard("chromium", 2, B, both, 2, {
    "b.spec.js": [
      {
        title: "three",
        line: 4,
        status: "flaky",
        results: [
          { status: "failed", duration: 1 },
          { status: "passed", duration: 1 },
        ],
      },
    ],
  });
  assert.match(verifyRun(flaky, expected).join("\n"), /passed only on a retry/);
});

test("the summary has counts, wall time, the slowest tests and files, and where each job's time went", () => {
  const timings = jobTimings([
    {
      name: "Browser · chromium · 1/2",
      created_at: "2026-10-09T10:00:00Z",
      started_at: "2026-10-09T10:00:05Z",
      completed_at: "2026-10-09T10:15:05Z",
      steps: [
        {
          name: "Set up job",
          started_at: "2026-10-09T10:00:05Z",
          completed_at: "2026-10-09T10:00:07Z",
        },
        {
          name: "Production build for the isolated browser environment",
          started_at: "2026-10-09T10:00:10Z",
          completed_at: "2026-10-09T10:01:10Z",
        },
        {
          name: "Browser tests with an isolated database",
          started_at: "2026-10-09T10:02:00Z",
          completed_at: "2026-10-09T10:14:00Z",
        },
        {
          name: "Upload the browser review",
          started_at: "2026-10-09T10:14:00Z",
          completed_at: "2026-10-09T10:14:30Z",
        },
      ],
    },
    { name: "not started", created_at: "2026-10-09T10:00:00Z" },
  ]);
  assert.equal(timings.length, 1);
  assert.deepEqual(
    [
      timings[0].queue,
      timings[0].setup,
      timings[0].tests,
      timings[0].artifacts,
      timings[0].total,
    ],
    [5000, 60000, 720000, 30000, 900000],
  );
  const markdown = renderSummary(good(), [], { timings, top: 2 });
  assert.match(
    markdown,
    /\| chromium \| 1\/2 \| 2 \| 2 \| 2 \| 0 \| 0 \| 0 \| 0 \| 1:00 \|/,
  );
  assert.match(markdown, /The 2 slowest tests/);
  assert.match(markdown, /The 2 heaviest files/);
  assert.match(
    markdown,
    /Browser · chromium · 1\/2 \| 0:05 \| 1:00 \| 12:00 \| 0:30 \| 15:00/,
  );
  assert.match(markdown, /Every shard reported/);
  const bad = renderSummary(good(), ["a problem"]);
  assert.match(bad, /### Problems\n\n- a problem/);
  assert.doesNotMatch(bad, /Every shard reported/);
  assert.match(
    renderSummary([shard("chromium", 1, A, both, 2, null)], []),
    /no report/,
  );
});

test("the summary job reads what the shard jobs kept, from the folders the artifacts land in", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-report-"));
  try {
    const shards = good().map((item) => ({
      ...item,
      listed: item.listed,
    }));
    // Each shard reports exactly its own tests.
    for (const item of shards) {
      const own = item.listed.map((id) => id.split("|")[1].split(":")[0]);
      item.summary = summarizeRun(
        report(
          item.project,
          Object.fromEntries(
            Object.entries(both).filter(([file]) => own.includes(file)),
          ),
        ),
      );
    }
    const label = (item) => `${item.shard.current}of${item.shard.total}`;
    for (const item of shards) {
      const folder = path.join(
        dir,
        `e2e-evidence-${item.project}-${label(item)}-1`,
      );
      await mkdir(folder, { recursive: true });
      await writeFile(
        path.join(folder, `manifest-${item.project}-${label(item)}.json`),
        JSON.stringify({
          project: item.project,
          shard: item.shard,
          full: item.full,
          listed: item.listed,
        }),
      );
      const own = item.listed.map((id) => id.split("|")[1].split(":")[0]);
      await writeFile(
        path.join(folder, `results-${item.project}-${label(item)}.json`),
        JSON.stringify(
          report(
            item.project,
            Object.fromEntries(
              Object.entries(both).filter(([file]) => own.includes(file)),
            ),
          ),
        ),
      );
    }
    const loaded = await loadEvidence(dir);
    assert.equal(loaded.length, 4);
    assert.deepEqual(verifyRun(loaded, expected), []);
    // The command line: green with every shard, red when a report is gone.
    const summary = path.join(dir, "summary.md");
    const args = [
      "scripts/e2e-report.js",
      dir,
      "--projects",
      "chromium,webkit-mobile",
      "--shards",
      "2",
      "--summary",
      summary,
    ];
    await run(process.execPath, args);
    assert.match(await readFile(summary, "utf8"), /Every shard reported/);
    // "Re-run failed jobs": a red shard of attempt 1 stays red until its job is
    // repeated; the repeated one is uploaded as attempt 2 and only it counts,
    // while the green shards of attempt 1 are not asked for again.
    const first = path.join(dir, "e2e-evidence-webkit-mobile-1of2-1");
    const results = path.join(first, "results-webkit-mobile-1of2.json");
    const green = await readFile(results, "utf8");
    const red = JSON.parse(green);
    const [failing] = collectTests(red);
    failing.test.status = "unexpected";
    failing.test.results[0].status = "failed";
    await writeFile(results, JSON.stringify(red));
    await assert.rejects(run(process.execPath, args), (error) => {
      assert.equal(error.code, 1);
      return true;
    });
    const second = path.join(dir, "e2e-evidence-webkit-mobile-1of2-2");
    await mkdir(second, { recursive: true });
    await writeFile(
      path.join(second, "manifest-webkit-mobile-1of2.json"),
      await readFile(path.join(first, "manifest-webkit-mobile-1of2.json")),
    );
    await writeFile(
      path.join(second, "results-webkit-mobile-1of2.json"),
      green,
    );
    await run(process.execPath, args);
    const latest = await loadEvidence(dir);
    assert.equal(latest.length, 4);
    assert.deepEqual(verifyRun(latest, expected), []);
    // Back to attempt 1 alone, and a report that is gone is still a failure.
    await rm(second, { recursive: true });
    await writeFile(results, green);
    await rm(path.join(first, "results-webkit-mobile-1of2.json"));
    await assert.rejects(run(process.execPath, args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /webkit-mobile\/1of2 has no report/);
      return true;
    });
    await rm(path.join(dir, "e2e-evidence-chromium-2of2-1"), {
      recursive: true,
    });
    await assert.rejects(run(process.execPath, args), (error) => {
      assert.match(error.stderr, /chromium\/2of2 is missing/);
      return true;
    });
    await writeFile(
      path.join(
        dir,
        "e2e-evidence-chromium-1of2-1",
        "manifest-chromium-1of2.json",
      ),
      "{broken",
    );
    await assert.rejects(run(process.execPath, args), (error) => {
      assert.match(error.stderr, /Unreadable manifest/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty directory or missing options are errors, not a green run", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "e2e-report-"));
  try {
    await assert.rejects(
      run(process.execPath, [
        "scripts/e2e-report.js",
        dir,
        "--projects",
        "chromium",
        "--shards",
        "2",
      ]),
      (error) => /chromium\/1of2 is missing/.test(error.stderr),
    );
    await assert.rejects(
      run(process.execPath, ["scripts/e2e-report.js", dir]),
      (error) => /usage/.test(error.stderr),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
