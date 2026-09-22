// Runs only against the disposable integration harness, never production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
function client() {
  let cookie = "";
  return async (url, method = "GET", data, requestOrigin = origin) => {
    const r = await fetch(origin + "/api/" + url, {
      method,
      headers: {
        origin: requestOrigin,
        cookie,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: r.status, data: await r.json(), cookie: set };
  };
}
const guest = client(),
  admin = client(),
  member = client(),
  ids = [];
const credentials = (name) => ({
  name,
  email: randomUUID() + "@legal.test",
  password: "legal-test-password-123",
});
const original = (await db.query("SELECT * FROM legal_documents ORDER BY kind"))
  .rows;
try {
  assert.equal((await guest("admin/legal")).status, 401);
  const registration = await admin("auth/register", "POST", {
    ...credentials("Legal admin"),
    ...testConsents,
  });
  assert.equal(registration.status, 201);
  const adminUser = registration.data.user;
  ids.push(adminUser.id);
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminUser.id]);
  const memberResult = await member("auth/register", "POST", {
    ...credentials("Legal member"),
    ...testConsents,
  });
  assert.equal(memberResult.status, 201);
  ids.push(memberResult.data.user.id);
  assert.equal((await member("admin/legal")).status, 403);
  const listed = await admin("admin/legal");
  assert.equal(listed.status, 200);
  let term = listed.data.documents.find((d) => d.kind === "terms");
  const initialBody = term.published.body,
    draftBody = "DRAFT_NOT_PUBLIC_" + randomUUID();
  assert.equal(
    (
      await admin(
        "admin/legal",
        "PUT",
        { kind: "terms", version: term.version, body: draftBody },
        "https://foreign.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await admin("admin/legal", "POST", {
        kind: "terms",
        version: term.version,
        body: "   ",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin("admin/legal", "PUT", {
        kind: "terms",
        version: term.version,
        body: "x".repeat(200001),
      })
    ).status,
    400,
  );
  term = (
    await admin("admin/legal", "PUT", {
      kind: "terms",
      version: term.version,
      body: draftBody,
    })
  ).data.document;
  const publicPage = await (await fetch(origin + "/legal/terms")).text();
  assert(!publicPage.includes(draftBody));
  assert(publicPage.includes(initialBody));
  assert(!JSON.stringify((await guest("legal")).data).includes(draftBody));
  assert.equal(
    (
      await admin("admin/legal", "PUT", {
        kind: "terms",
        version: term.version - 1,
        body: "lost update",
      })
    ).status,
    409,
  );
  for (const extra of [
    {},
    { ...testConsents, termsAccepted: false },
    { ...testConsents, privacyAccepted: false },
    { ...testConsents, termsAccepted: "true" },
    { ...testConsents, privacyRevision: "1" },
  ]) {
    const input = credentials("Must reject"),
      response = await guest("auth/register", "POST", { ...input, ...extra });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, "LEGAL_ACCEPTANCE_REQUIRED");
    assert.equal(response.cookie, null);
    assert.equal(
      (await db.query("SELECT id FROM users WHERE email=$1", [input.email]))
        .rows.length,
      0,
    );
  }
  assert.equal(
    (
      await guest("auth/register/extra", "POST", {
        ...credentials("No alternate route"),
        ...testConsents,
      })
    ).status,
    401,
  );
  await db.query(
    "UPDATE legal_documents SET published_revision=NULL WHERE kind='privacy'",
  );
  assert.equal((await guest("legal")).data.ready, false);
  assert.equal(
    (
      await guest("auth/register", "POST", {
        ...credentials("Unavailable"),
        ...testConsents,
      })
    ).status,
    503,
  );
  await db.query(
    "UPDATE legal_documents SET published_revision=1 WHERE kind='privacy'",
  );
  const published = await admin("admin/legal", "POST", {
    kind: "terms",
    version: term.version,
    body: "## Новая редакция\n\n**Важные** условия и ++текст++.\n\n<script>window.pwned=true</script>",
  });
  assert.equal(published.status, 200);
  term = published.data.document;
  assert.equal(term.published.revision, 2);
  const stale = credentials("Stale reader");
  assert.equal(
    (await guest("auth/register", "POST", { ...stale, ...testConsents })).data
      .code,
    "LEGAL_UPDATED",
  );
  assert.equal(
    (await db.query("SELECT id FROM users WHERE email=$1", [stale.email])).rows
      .length,
    0,
  );
  assert.equal(
    (await fetch(origin + "/legal/terms?revision=999999")).status,
    404,
  );
  assert.equal((await fetch(origin + "/legal/not-a-document")).status, 404);
  const v1 = await (await fetch(origin + "/legal/terms?revision=1")).text();
  assert(v1.includes(initialBody));
  assert(!v1.includes("Новая редакция"));
  const v2 = await (await fetch(origin + term.published.href)).text();
  assert(v2.includes("<strong>Важные</strong>"));
  assert(!v2.includes("<script>window.pwned=true</script>"));
  assert(v2.includes("&lt;script&gt;"));
  const registered = await guest("auth/register", "POST", {
    ...stale,
    ...testConsents,
    termsRevision: 2,
  });
  assert.equal(registered.status, 201);
  ids.push(registered.data.user.id);
  const receipts = (
    await db.query(
      "SELECT kind,revision,accepted_at FROM user_legal_acceptances WHERE user_id=$1 ORDER BY kind",
      [registered.data.user.id],
    )
  ).rows;
  assert.deepEqual(
    receipts.map((r) => [r.kind, r.revision]),
    [
      ["privacy", 1],
      ["terms", 2],
    ],
  );
  assert(receipts.every((r) => r.accepted_at));
  assert.equal((await guest("auth/logout", "POST")).status, 200);
  assert.equal(
    (await guest("auth/login", "POST", stale)).status,
    200,
    "login does not ask existing users for new consent",
  );
  assert(
    (
      await db.query(
        "SELECT id FROM admin_audit WHERE actor_id=$1 AND action='legal.publish'",
        [adminUser.id],
      )
    ).rows.length > 0,
  );
  console.log(
    "Legal HTTP: roles/origin, public/draft isolation, versions, strict consent, rollback, receipts and login passed",
  );
} finally {
  for (const d of original)
    await db.query(
      "UPDATE legal_documents SET draft_body=$2,draft_version=$3,published_revision=$4,updated_at=$5 WHERE kind=$1",
      [
        d.kind,
        d.draft_body,
        d.draft_version,
        d.published_revision,
        d.updated_at,
      ],
    );
  if (ids.length)
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM legal_document_versions WHERE revision>1");
  await db.end();
}
