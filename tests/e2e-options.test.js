import test from "node:test";
import assert from "node:assert/strict";
import {
  browserRun,
  parseShard,
  playwrightArgs,
  projects,
  shardLabel,
} from "../scripts/e2e-options.js";

test("a shard is index/total with 1 <= index <= total <= 16 and nothing else", () => {
  assert.deepEqual(parseShard("1/2"), { current: 1, total: 2 });
  assert.deepEqual(parseShard("16/16"), { current: 16, total: 16 });
  for (const bad of [
    "",
    "2",
    "0/2",
    "3/2",
    "1/0",
    "1/17",
    "01/2",
    "1/02",
    "a/b",
    "1/2/3",
    " 1/2",
    "-1/2",
    undefined,
    null,
  ])
    assert.throws(() => parseShard(bad), /Shard/, String(bad));
});

test("the run takes its project and shard from the command line before the environment", () => {
  assert.deepEqual(browserRun([], {}), {
    project: undefined,
    shard: null,
    files: [],
  });
  assert.deepEqual(
    browserRun([], {
      COLA_CI_PLAYWRIGHT_PROJECT: "webkit-mobile",
      COLA_CI_PLAYWRIGHT_SHARD: "2/2",
    }),
    { project: "webkit-mobile", shard: { current: 2, total: 2 }, files: [] },
  );
  assert.deepEqual(
    browserRun(["--e2e", "--shard=1/4", "--project", "chromium"], {
      COLA_CI_PLAYWRIGHT_PROJECT: "webkit-mobile",
      COLA_CI_PLAYWRIGHT_SHARD: "2/2",
    }),
    { project: "chromium", shard: { current: 1, total: 4 }, files: [] },
  );
  assert.deepEqual(
    browserRun(["--shard", "3/3"], { COLA_CI_PLAYWRIGHT_PROJECT: "chromium" }),
    { project: "chromium", shard: { current: 3, total: 3 }, files: [] },
  );
});

test("file filters are what is left after the options and their values", () => {
  assert.deepEqual(
    browserRun(
      [
        "--e2e",
        "--project",
        "chromium",
        "tests/e2e/a.spec.js",
        "--shard=1/2",
        "b",
      ],
      {},
    ).files,
    ["tests/e2e/a.spec.js", "b"],
  );
  assert.deepEqual(
    playwrightArgs({
      project: "chromium",
      shard: null,
      files: ["tests/e2e/a.spec.js"],
    }),
    ["test", "tests/e2e/a.spec.js", "--project", "chromium"],
  );
});

test("a typo is an error before anything starts, never a silent full run", () => {
  assert.throws(
    () => browserRun([], { COLA_CI_PLAYWRIGHT_PROJECT: "firefox" }),
    /Unknown Playwright project/,
  );
  assert.throws(() => browserRun(["--project=ie"], {}), /Unknown/);
  assert.throws(() => browserRun(["--shard=1/2"], {}), /needs its project/);
  assert.throws(
    () =>
      browserRun(["--shard=3/2"], { COLA_CI_PLAYWRIGHT_PROJECT: "chromium" }),
    /not valid/,
  );
  assert.throws(
    () =>
      browserRun(["--shard=1/2", "--shard=2/2"], {
        COLA_CI_PLAYWRIGHT_PROJECT: "chromium",
      }),
    /more than once/,
  );
  assert.throws(
    () => browserRun(["--shard="], { COLA_CI_PLAYWRIGHT_PROJECT: "chromium" }),
    /needs a value/,
  );
  for (const project of projects)
    assert.doesNotThrow(() =>
      browserRun([], { COLA_CI_PLAYWRIGHT_PROJECT: project }),
    );
});

test("the native Playwright command gets the project and the shard, and only them", () => {
  assert.deepEqual(playwrightArgs({ project: undefined, shard: null }), [
    "test",
  ]);
  assert.deepEqual(playwrightArgs({ project: "chromium", shard: null }), [
    "test",
    "--project",
    "chromium",
  ]);
  assert.deepEqual(
    playwrightArgs(
      { project: "webkit-mobile", shard: { current: 2, total: 3 } },
      ["--list"],
    ),
    ["test", "--project", "webkit-mobile", "--shard", "2/3", "--list"],
  );
  assert.equal(shardLabel({ current: 1, total: 2 }), "1of2");
  assert.equal(shardLabel(null), "all");
});
