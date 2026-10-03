import assert from "node:assert/strict";

/**
 * `value` itself, after proving it exists: the test fails with the name of
 * what is missing instead of a TypeError on the next line, and the compiler
 * knows the value is there.
 */
export function present<T>(value: T | null | undefined, what = "value"): T {
  assert.ok(value !== null && value !== undefined, `${what} is missing`);
  return value;
}
