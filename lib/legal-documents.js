import { createHash } from "node:crypto";
import { z } from "zod";
import { richPlainText, richTextLimit } from "./rich-text.js";
export const legalKinds = ["terms", "privacy"];
export const legalTitles = {
  terms: "Пользовательское соглашение",
  privacy: "Политика обработки персональных данных",
};
export class LegalError extends Error {
  constructor(message, status = 400, code = "LEGAL_INVALID") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const legalInput = z
  .object({
    kind: z.enum(legalKinds),
    body: z
      .string()
      .max(richTextLimit)
      .refine((v) => !v.includes("\0")),
    version: z.number().int().positive(),
  })
  .strict();
export const acceptanceInput = z.object({
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  termsRevision: z.number().int().positive(),
  privacyRevision: z.number().int().positive(),
});
export function legalHref(kind, revision) {
  return `/legal/${kind}${revision ? `?revision=${revision}` : ""}`;
}
export async function legalMetadata(q) {
  const { rows } = await q.query(
    "SELECT kind,published_revision FROM legal_documents ORDER BY kind",
  );
  const documents = Object.fromEntries(
    legalKinds.map((kind) => {
      const revision =
        rows.find((r) => r.kind === kind)?.published_revision || null;
      return [
        kind,
        { revision, href: legalHref(kind, revision), title: legalTitles[kind] },
      ];
    }),
  );
  return {
    ready: legalKinds.every((kind) => !!documents[kind].revision),
    documents,
  };
}
export async function publishedLegalDocument(q, kind, revision = null) {
  if (!legalKinds.includes(kind)) return null;
  const { rows } = await q.query(
    `SELECT v.kind,v.revision,v.body,v.content_hash,v.published_at
    FROM legal_document_versions v JOIN legal_documents d ON d.kind=v.kind
    WHERE v.kind=$1 AND v.revision=COALESCE($2::integer,d.published_revision)`,
    [kind, revision],
  );
  return rows[0] || null;
}
export async function adminLegalDocuments(q) {
  const { rows } =
    await q.query(`SELECT d.kind,d.draft_body,d.draft_version,d.published_revision,d.updated_at,
    v.body AS published_body,v.published_at FROM legal_documents d LEFT JOIN legal_document_versions v
    ON v.kind=d.kind AND v.revision=d.published_revision ORDER BY d.kind`);
  return {
    documents: rows.map((r) => ({
      kind: r.kind,
      title: legalTitles[r.kind],
      body: r.draft_body,
      version: r.draft_version,
      updatedAt: r.updated_at,
      published: r.published_revision
        ? {
            revision: r.published_revision,
            body: r.published_body,
            publishedAt: r.published_at,
            href: legalHref(r.kind, r.published_revision),
          }
        : null,
    })),
  };
}
// Call within transaction. Publication and draft save use the same optimistic
// version; registration holds FOR SHARE on both rows until account + receipts commit.
export async function saveLegalDocument(q, actor, raw, publish, audit) {
  const input = legalInput.parse(raw);
  if (publish && !richPlainText(input.body))
    throw new LegalError("Нельзя опубликовать пустой документ.");
  const { rows } = await q.query(
    "SELECT * FROM legal_documents WHERE kind=$1 FOR UPDATE",
    [input.kind],
  );
  const old = rows[0];
  if (!old) throw new LegalError("Документ не найден", 404);
  if (old.draft_version !== input.version)
    throw new LegalError(
      "Документ изменён другим администратором. Обновите данные; ваш текст остаётся в редакторе.",
      409,
      "LEGAL_CONFLICT",
    );
  let revision = old.published_revision;
  if (publish) {
    const current = revision
      ? await publishedLegalDocument(q, input.kind, revision)
      : null;
    if (current?.body !== input.body) {
      revision = (revision || 0) + 1;
      await q.query(
        "INSERT INTO legal_document_versions(kind,revision,body,content_hash,published_by) VALUES($1,$2,$3,$4,$5)",
        [
          input.kind,
          revision,
          input.body,
          createHash("sha256").update(input.body).digest("hex"),
          actor,
        ],
      );
    }
  }
  await q.query(
    "UPDATE legal_documents SET draft_body=$2,draft_version=draft_version+1,published_revision=$3,updated_at=now() WHERE kind=$1",
    [input.kind, input.body, revision],
  );
  await audit(
    q,
    actor,
    publish ? "legal.publish" : "legal.draft",
    input.kind + ":" + (publish ? revision : old.draft_version + 1),
  );
  return (await adminLegalDocuments(q)).documents.find(
    (d) => d.kind === input.kind,
  );
}
export async function checkLegalAcceptance(q, raw) {
  const parsed = acceptanceInput.safeParse(raw);
  if (!parsed.success)
    throw new LegalError(
      "Явно примите пользовательское соглашение и политику обработки персональных данных.",
      400,
      "LEGAL_ACCEPTANCE_REQUIRED",
    );
  const { rows } = await q.query(
    "SELECT kind,published_revision FROM legal_documents ORDER BY kind FOR SHARE",
  );
  if (
    legalKinds.some(
      (kind) => !rows.find((d) => d.kind === kind)?.published_revision,
    )
  )
    throw new LegalError(
      "Регистрация временно недоступна: документы ещё не опубликованы.",
      503,
      "LEGAL_UNAVAILABLE",
    );
  if (
    legalKinds.some(
      (kind) =>
        rows.find((d) => d.kind === kind).published_revision !==
        parsed.data[kind + "Revision"],
    )
  )
    throw new LegalError(
      "Документы обновились. Ознакомьтесь с новыми версиями и отметьте оба согласия заново.",
      409,
      "LEGAL_UPDATED",
    );
  return parsed.data;
}
export async function recordLegalAcceptance(q, userId, accepted) {
  await q.query(
    `INSERT INTO user_legal_acceptances(user_id,kind,revision) VALUES($1,'terms',$2),($1,'privacy',$3)`,
    [userId, accepted.termsRevision, accepted.privacyRevision],
  );
}
