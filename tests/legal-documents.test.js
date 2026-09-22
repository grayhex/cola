import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { getSchema } from "@tiptap/core";
import {
  richExtensions,
  parseRichText,
  serializeRichText,
  richPlainText,
  safeRichLink,
} from "../lib/rich-text.js";
import {
  legalMetadata,
  adminLegalDocuments,
  saveLegalDocument,
  publishedLegalDocument,
  checkLegalAcceptance,
  recordLegalAcceptance,
} from "../lib/legal-documents.js";
const schema = getSchema(richExtensions());
const walk = (n) => [n, ...(n.content || []).flatMap(walk)];

test("shared rich text round-trips headings, nested marks, underline, lists, quotes and safe links", () => {
  const source =
    "# Документ\n\n**Важный** текст с *курсивом* и ++подчёркиванием++.\n\n1. Первый\n2. Второй\n\n- Пункт\n\n> Цитата\n\n[Сайт](https://example.test/path?q=1)";
  const doc = parseRichText(source),
    result = parseRichText(serializeRichText(doc));
  schema.nodeFromJSON(doc).check();
  schema.nodeFromJSON(result).check();
  assert.deepEqual(result, doc);
  const nodes = walk(doc);
  for (const type of ["heading", "bulletList", "orderedList", "blockquote"])
    assert(
      nodes.some((n) => n.type === type),
      type,
    );
  for (const type of ["bold", "italic", "underline", "link"])
    assert(
      nodes.some((n) => n.marks?.some((m) => m.type === type)),
      type,
    );
  assert(richPlainText(source).includes("Важный текст"));
});

test("HTML, scripts, event attributes and external images remain inert text", () => {
  for (const source of [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>',
    '<iframe src="https://tracking.test"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    "![tracking](https://tracking.test/pixel)",
  ]) {
    const doc = parseRichText(source);
    schema.nodeFromJSON(doc).check();
    assert(richPlainText(source).includes(source), source);
    assert(
      !walk(doc).some((n) =>
        ["image", "html", "iframe", "script"].includes(n.type),
      ),
    );
  }
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "//evil.test",
    "/\\evil.test",
    "https://u:p@example.test/",
    "https://example.test/\n",
  ])
    assert.equal(safeRichLink(href), null, href);
  for (const href of [
    "https://example.test",
    "http://example.test/path",
    "/legal/terms?revision=1",
  ])
    assert(safeRichLink(href));
  assert(
    !walk(parseRichText("[unsafe](javascript:alert%281%29)")).some((n) =>
      n.marks?.some((m) => m.type === "link"),
    ),
  );
});

test("authorized photo references survive source/edit round-trips; legacy plain bodies retain line breaks", () => {
  const id = randomUUID(),
    source = `Начало\n\n![Схема](photo:${id})\n\nКонец`;
  const doc = parseRichText(source);
  schema.nodeFromJSON(doc).check();
  assert.equal(walk(doc).find((n) => n.type === "photoReference").attrs.id, id);
  assert.deepEqual(parseRichText(serializeRichText(doc)), doc);
  assert.equal(
    richPlainText("Первая строка\nВторая строка"),
    "Первая строка\nВторая строка",
  );
});

test("legal migration, immutable publication, draft conflicts and atomic versioned receipts", async () => {
  const db = new PGlite(),
    actor = randomUUID(),
    existing = randomUUID(),
    newcomer = randomUUID(),
    audit = [];
  const log = async (_q, who, action, target) =>
    audit.push({ who, action, target });
  try {
    await db.exec("CREATE TABLE users(id uuid PRIMARY KEY)");
    await db.query("INSERT INTO users VALUES($1),($2)", [actor, existing]);
    await db.exec(
      await readFile(
        new URL("../db/019_legal_documents.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal((await legalMetadata(db)).ready, false);
    assert.equal(
      (await db.query("SELECT * FROM user_legal_acceptances")).rows.length,
      0,
    );
    const save = (input, publish) =>
      db.transaction((q) => saveLegalDocument(q, actor, input, publish, log));
    await assert.rejects(
      save({ kind: "terms", body: "  \n", version: 1 }, true),
      /пустой/,
    );
    await save({ kind: "terms", body: "Черновик СЕКРЕТ", version: 1 }, false);
    assert.equal(await publishedLegalDocument(db, "terms"), null);
    assert(!JSON.stringify(await legalMetadata(db)).includes("СЕКРЕТ"));
    await assert.rejects(
      save({ kind: "terms", body: "Lost update", version: 1 }, true),
      { code: "LEGAL_CONFLICT" },
    );
    const body =
      "## Пользовательское соглашение\n\n**Тестовая** редакция один.";
    const first = await save({ kind: "terms", body, version: 2 }, true);
    assert.equal(first.published.revision, 1);
    await save(
      {
        kind: "privacy",
        body: "Политика — тестовая редакция один.",
        version: 1,
      },
      true,
    );
    assert.equal((await legalMetadata(db)).ready, true);
    const one = {
      termsAccepted: true,
      privacyAccepted: true,
      termsRevision: 1,
      privacyRevision: 1,
    };
    for (const bad of [
      {},
      { ...one, termsAccepted: false },
      { ...one, privacyAccepted: false },
      { ...one, privacyAccepted: "true" },
      { ...one, termsRevision: "1" },
    ])
      await assert.rejects(checkLegalAcceptance(db, bad), {
        code: "LEGAL_ACCEPTANCE_REQUIRED",
      });
    await db.transaction(async (q) => {
      const consent = await checkLegalAcceptance(q, one);
      await q.query("INSERT INTO users VALUES($1)", [newcomer]);
      await recordLegalAcceptance(q, newcomer, consent);
    });
    const receipts = (
      await db.query(
        "SELECT kind,revision,accepted_at FROM user_legal_acceptances WHERE user_id=$1 ORDER BY kind",
        [newcomer],
      )
    ).rows;
    assert.deepEqual(
      receipts.map((r) => [r.kind, r.revision]),
      [
        ["privacy", 1],
        ["terms", 1],
      ],
    );
    assert(receipts.every((r) => r.accepted_at));
    await save(
      {
        kind: "terms",
        body: "Секретный второй черновик",
        version: first.version,
      },
      false,
    );
    assert.equal((await publishedLegalDocument(db, "terms")).body, body);
    let doc = (await adminLegalDocuments(db)).documents.find(
      (d) => d.kind === "terms",
    );
    await save(
      { kind: "terms", body: "Редакция два", version: doc.version },
      true,
    );
    await assert.rejects(
      db.transaction((q) => checkLegalAcceptance(q, one)),
      { code: "LEGAL_UPDATED" },
    );
    const old = await publishedLegalDocument(db, "terms", 1);
    assert.equal(old.body, body);
    assert.equal(
      old.content_hash,
      createHash("sha256").update(body).digest("hex"),
    );
    await assert.rejects(
      db.query(
        "UPDATE legal_document_versions SET body='changed' WHERE kind='terms' AND revision=1",
      ),
      /immutable/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT revision FROM user_legal_acceptances WHERE user_id=$1 AND kind='terms'",
          [newcomer],
        )
      ).rows[0].revision,
      1,
    );
    await db.query("DELETE FROM users WHERE id=$1", [actor]); // publisher FK may be cleared, content stays immutable
    assert.equal((await publishedLegalDocument(db, "terms", 1)).body, body);
    await db.query("DELETE FROM users WHERE id=$1", [newcomer]);
    assert.equal(
      (await db.query("SELECT * FROM user_legal_acceptances")).rows.length,
      0,
    );
    assert(audit.some((r) => r.action === "legal.publish"));
    assert(audit.some((r) => r.action === "legal.draft"));
  } finally {
    await db.close();
  }
});

test("a fresh site can bootstrap one owner without opening public registration or inventing consents", async () => {
  const { bootstrapAdmin } = await import("../scripts/bootstrap-admin.js");
  const { verifyPassword } = await import("../lib/password.js");
  const db = new PGlite();
  try {
    for (const name of ["001_initial", "002_admin", "019_legal_documents"])
      await db.exec(
        await readFile(new URL(`../db/${name}.sql`, import.meta.url), "utf8"),
      );
    const input = {
      email: "owner@example.test",
      name: "Owner",
      password: "owner-bootstrap-test-123",
    };
    await assert.rejects(
      db.transaction((q) => bootstrapAdmin(q, { ...input, password: "short" })),
    );
    const owner = await db.transaction((q) => bootstrapAdmin(q, input));
    const row = (await db.query("SELECT * FROM users WHERE id=$1", [owner.id]))
      .rows[0];
    assert.equal(row.role, "admin");
    assert(await verifyPassword(input.password, row.password_hash));
    assert.equal((await legalMetadata(db)).ready, false);
    assert.equal(
      (await db.query("SELECT * FROM user_legal_acceptances")).rows.length,
      0,
    );
    await assert.rejects(
      db.transaction((q) =>
        bootstrapAdmin(q, { ...input, email: "other@example.test" }),
      ),
      /уже существует/,
    );
    assert.equal((await db.query("SELECT * FROM users")).rows.length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM admin_audit WHERE action='admin.bootstrap'",
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
