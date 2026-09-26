import test from "node:test";
import assert from "node:assert/strict";
import { requireVerifiedEmail, EmailPolicyError } from "../lib/email-policy.js";
test("email capability has no role or SMTP bypass", () => {
  for (const role of ["user", "admin"]) {
    assert.throws(() => requireVerifiedEmail({ role, email_verified_at: null }), error => error instanceof EmailPolicyError && error.status === 403 && error.code === "EMAIL_VERIFICATION_REQUIRED");
    assert.doesNotThrow(() => requireVerifiedEmail({ role, email_verified_at: new Date() }));
  }
});
