import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cssBezier } from "../lib/motion-easing.ts";

test("the shared CSS easing reaches Motion as four numeric control points", async () => {
  const tokens = await readFile(
    new URL("../app/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const value = tokens.match(/--ease-out:\s*([^;]+);/)?.[1];
  assert.ok(value);
  const points = cssBezier(value);
  assert.ok(points, value);
  assert.equal(points.length, 4);
  assert.deepEqual(points, value.match(/[\d.]+/g).map(Number));
  assert.deepEqual(
    cssBezier("cubic-bezier(.2, -0.5, 0.8, 1.5)"),
    [0.2, -0.5, 0.8, 1.5],
  );
});

test("invalid CSS easing falls back to Motion's default", () => {
  for (const value of [
    "",
    "ease-out",
    "cubic-bezier(0,1,2)",
    "cubic-bezier(,0,1,1)",
    "cubic-bezier(NaN,0,1,1)",
    "cubic-bezier(-1,0,1,1)",
  ])
    assert.equal(cssBezier(value), undefined);
});
