// Synthetic documents for disposable test databases only. Never imported by the app.
import { createHash } from "node:crypto";
export const testConsents = Object.freeze({
  termsAccepted: true,
  privacyAccepted: true,
  termsRevision: 1,
  privacyRevision: 1,
});
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
