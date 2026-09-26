// Opt-in fixtures for scenarios that need a member allowed to publish.
// Exercise the real captured-mail token endpoint; never mark database rows verified.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
export async function verifyCapturedEmail(email) {
  const dir = process.env.MAIL_CAPTURE_DIR;
  assert.ok(dir, "A disposable mail capture directory is required");
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const file of (await readdir(dir).catch(() => [])).sort().reverse()) {
      let mail;
      try {
        mail = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      } catch (error) {
        // The capture writer may have created the file but not finished writing it.
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      if (mail.to !== email.trim().toLowerCase()) continue;
      const token = mail.text.match(/\/verify-email#([A-Za-z0-9_-]{43})/)?.[1];
      if (!token) continue;
      const response = await globalThis.fetch(origin + "/api/auth/verify-email", {
        method: "POST", headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      assert.equal(response.status, 200, "Captured verification link succeeds");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Verification email did not arrive for the test fixture");
}
export async function registerVerified(request, options) {
  const response = await request.post("/api/auth/register", options);
  if (response.status() === 201) await verifyCapturedEmail(options.data.email);
  return response;
}
export async function verifiedFetch(url, options) {
  const response = await globalThis.fetch(url, options);
  if (new URL(url).pathname === "/api/auth/register" && response.status === 201)
    await verifyCapturedEmail(JSON.parse(options.body).email);
  return response;
}
