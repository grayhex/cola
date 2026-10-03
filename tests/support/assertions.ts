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

/**
 * A property the declared type does not list (a DTO that grows keys by data,
 * like the metrics a ride shows), read as `unknown` for the assertion.
 */
export function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}
