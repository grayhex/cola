import test from "node:test";
import assert from "node:assert/strict";
import {
  errorCode,
  errorConstraint,
  errorMessage,
  errorStatus,
} from "../lib/errors.ts";

test("error boundaries preserve known properties without trusting thrown values", () => {
  const error = Object.assign(new Error("Conflict"), {
    code: "23505",
    constraint: "users_username_ci",
    status: 409,
  });
  assert.equal(errorMessage(error), "Conflict");
  assert.equal(errorCode(error), "23505");
  assert.equal(errorConstraint(error), "users_username_ci");
  assert.equal(errorStatus(error), 409);
  for (const value of [
    null,
    undefined,
    "failure",
    42,
    {},
    { message: 42, code: 23505, constraint: false, status: "409" },
  ]) {
    assert.equal(errorMessage(value), "");
    assert.equal(errorCode(value), undefined);
    assert.equal(errorConstraint(value), undefined);
    assert.equal(errorStatus(value), undefined);
  }
});
