import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiErrorCodes, errorStatus } from "../lib/api-v1/errors.ts";
import {
  pushDeviceRegistrationSchema,
  pushDeviceSchema,
} from "../lib/api-v1/schemas.ts";
import { fixtureDirectory } from "./support/notification-fixtures.ts";

// The published examples of the push registration (#342), checked against the
// schemas the server answers with, so a change of the contract that makes
// them stale fails here.

const file = JSON.parse(
  await readFile(path.join(fixtureDirectory, "devices.json"), "utf8"),
);

test("the registration examples are what the server takes and says", () => {
  const request = pushDeviceRegistrationSchema.parse(file.register.request);
  assert.equal(request.expectedGeneration, undefined);
  assert.equal(pushDeviceSchema.parse(file.register.response).generation, 1);
  const rotate = pushDeviceRegistrationSchema.parse(file.rotate.request);
  assert.equal(rotate.expectedGeneration, 1);
  assert.equal(
    pushDeviceSchema.parse(file.rotate.response).generation,
    rotate.expectedGeneration! + 1,
  );
  // The address is in the request and nowhere in an answer.
  for (const answer of [file.register.response, file.rotate.response])
    assert.ok(!JSON.stringify(answer).includes("address"));
  // A field nobody listed is refused, so a client cannot name an endpoint.
  assert.equal(
    pushDeviceRegistrationSchema.safeParse({
      ...file.register.request,
      endpoint: "https://evil.test",
    }).success,
    false,
  );
});

test("every documented error has the status its code has", () => {
  for (const error of file.errors) {
    assert.ok(
      (apiErrorCodes as readonly string[]).includes(error.code),
      error.name,
    );
    assert.equal(
      errorStatus[error.code as keyof typeof errorStatus],
      error.status,
      error.name,
    );
  }
});
