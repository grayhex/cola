// Synthetic documents for disposable test databases only. Never imported by the app.
import { createHash } from "node:crypto";
export const testConsents = Object.freeze({
  termsAccepted: true,
  privacyAccepted: true,
  termsRevision: 1,
  privacyRevision: 1,
});
// The page is replaced after a successful sign-up, and the form must start
// nothing more: a document refresh then was cancelled with the navigation, and
// WebKit dropped the navigation together with it (CI runs 37155008807 and
// 37181382571). Collects /api/legal requests sent after a 2xx answer.
export function legalRequestsAfterSignup(page) {
  let registered = false;
  const late = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/auth/register" &&
      response.ok()
    )
      registered = true;
  });
  page.on("request", (request) => {
    if (registered && new URL(request.url()).pathname === "/api/legal")
      late.push(request.method() + " " + request.url());
  });
  return late;
}
export async function seedLegalDocuments(q) {
  for (const kind of ["terms", "privacy"]) {
    const body = `TEST ONLY · ${kind} · Synthetic document for automated checks.`;
    await q.query(
      `INSERT INTO legal_document_versions(kind,revision,body,content_hash)
      VALUES($1,1,$2,$3) ON CONFLICT DO NOTHING`,
      [kind, body, createHash("sha256").update(body).digest("hex")],
    );
    await q.query(
      `UPDATE legal_documents SET draft_body=$2,published_revision=1 WHERE kind=$1 AND published_revision IS NULL`,
      [kind, body],
    );
  }
}
