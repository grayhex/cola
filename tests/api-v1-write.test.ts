import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EmailPolicyError } from "../lib/email-policy.ts";
import { safely } from "../lib/api-v1/respond.ts";
import {
  ApiError,
  apiErrorCodes,
  errorStatus,
  type ApiErrorCode,
} from "../lib/api-v1/errors.ts";
import type { Queryable } from "../lib/db.ts";
import {
  IDEMPOTENCY_DAYS,
  type IdempotentResponse,
  idempotencyKey,
  idempotent,
} from "../lib/api-v1/idempotency.ts";
import { checkIfMatch, etagOf, parseJsonBody } from "../lib/api-v1/request.ts";
import { testDatabase } from "./support/database.ts";
import { one } from "./support/rows.ts";
import { labelledUser } from "./support/people.ts";

// Conventions of the writing operations of API v1 (#305): the body, idempotent
// creation and optimistic locking. The switches and the Origin rule are
// tests/api-v1-write-http.js; a race on one key is tests/api-v1-write-concurrency.js.

const db = await testDatabase();
after(() => db.close());

const addUser = async (label: string) => (await labelledUser(db, label)).id;
const refused = (code: ApiErrorCode) => (error: unknown) =>
  error instanceof ApiError && error.code === code;

test("error codes of writing: documented statuses, and the set is the old one plus the new", () => {
  const added: Partial<Record<ApiErrorCode, number>> = {
    email_verification_required: 403,
    conflict: 409,
    precondition_failed: 412,
    precondition_required: 428,
    payload_too_large: 413,
    unsupported_media_type: 415,
  };
  for (const [name, status] of Object.entries(added)) {
    const code = apiErrorCodes.find((known) => known === name);
    assert.ok(code, name);
    assert.equal(errorStatus[code], status, name);
  }
  for (const code of ["forbidden", "rate_limited", "not_found"])
    assert.ok(
      apiErrorCodes.some((known) => known === code),
      code,
    );
});

const body = (
  text: string,
  headers: Record<string, string> = { "content-type": "application/json" },
) =>
  new Request("https://cola.example/x", {
    method: "POST",
    headers,
    body: text,
  });
const schema = z.strictObject({ title: z.string().min(1) });

test("body: JSON only, bounded, validated", async () => {
  assert.deepEqual(await parseJsonBody(body('{"title":"a"}'), schema), {
    title: "a",
  });
  await assert.rejects(
    parseJsonBody(body("title=a", { "content-type": "text/plain" }), schema),
    refused("unsupported_media_type"),
  );
  await assert.rejects(
    parseJsonBody(body('{"title":"' + "x".repeat(200) + '"}'), schema, 64),
    refused("payload_too_large"),
  );
  await assert.rejects(
    parseJsonBody(body("{broken"), schema),
    refused("invalid_request"),
  );
  await assert.rejects(
    parseJsonBody(body('{"title":"a","extra":1}'), schema),
    (error: unknown) =>
      refused("invalid_request")(error) &&
      error instanceof ApiError &&
      (error.details?.length ?? 0) > 0,
  );
  await assert.rejects(
    parseJsonBody(
      new Request("https://cola.example/x", { method: "POST" }),
      schema,
    ),
    (error) => error instanceof ApiError,
  );
});

test("If-Match: the version the client saw, strongly compared", () => {
  const stamp = "2026-10-02T10:00:00.123456Z";
  const current = etagOf("comment", "id-1", stamp);
  assert.match(current, /^"[A-Za-z0-9_-]{27}"$/);
  assert.equal(current, etagOf("comment", "id-1", stamp), "stable");
  assert.notEqual(
    current,
    etagOf("comment", "id-1", "2026-10-02T10:00:00.123457Z"),
  );
  assert.notEqual(current, etagOf("comment", "id-2", stamp));
  assert.notEqual(current, etagOf("entry", "id-1", stamp));
  const headers = (value?: string) =>
    new Headers(value === undefined ? {} : { "if-match": value });
  checkIfMatch(headers(current), current);
  checkIfMatch(headers("*"), current);
  checkIfMatch(headers(`"other", ${current}`), current);
  assert.throws(
    () => checkIfMatch(headers(), current),
    refused("precondition_required"),
  );
  assert.doesNotThrow(() =>
    checkIfMatch(headers(), current, { required: false }),
  );
  assert.throws(
    () => checkIfMatch(headers('"other"'), current),
    refused("precondition_failed"),
  );
  assert.throws(
    () => checkIfMatch(headers("W/" + current), current),
    refused("precondition_failed"),
    "a weak validator never matches",
  );
  assert.throws(
    () => checkIfMatch(headers(""), current),
    refused("precondition_failed"),
  );
});

test("Idempotency-Key header: a UUID or nothing", () => {
  assert.equal(idempotencyKey(new Headers()), null);
  const key = randomUUID();
  assert.equal(
    idempotencyKey(new Headers({ "idempotency-key": key.toUpperCase() })),
    key,
  );
  for (const bad of ["", "abc", key + "x", "1234"])
    assert.throws(
      () => idempotencyKey(new Headers({ "idempotency-key": bad })),
      refused("invalid_request"),
      bad,
    );
});

async function count(table: string, where: string, args: unknown[]) {
  return (
    await one<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
      args,
    )
  ).n;
}
await db.exec("CREATE TABLE made(id uuid PRIMARY KEY, title text NOT NULL)");
const create =
  (title: string) =>
  async (q: Queryable): Promise<IdempotentResponse> => {
    const id = randomUUID();
    await q.query("INSERT INTO made(id,title) VALUES($1,$2)", [id, title]);
    return {
      status: 201,
      body: { id, title },
      headers: { Location: "/made/" + id },
    };
  };
const options = (
  user: string,
  key: string | null,
  extra: { body?: unknown; route?: string; required?: boolean } = {},
) => ({
  userId: user,
  route: "POST /api/v1/things",
  key,
  body: { title: "один", tags: ["a", "b"], nested: { x: 1, y: 2 } },
  ...extra,
});

const madeBody = z.object({ id: z.string() });
const madeId = (answer: { response: IdempotentResponse }) =>
  madeBody.parse(answer.response.body).id;

test("idempotent creation: a repeat replays the first answer and creates nothing", async () => {
  const user = await addUser("first");
  const key = randomUUID();
  const first = await idempotent(
    db.transaction,
    options(user, key),
    create("один"),
  );
  assert.equal(first.replayed, false);
  assert.equal(first.response.status, 201);
  // The same body with the keys in another order is the same request.
  const second = await idempotent(
    db.transaction,
    options(user, key, {
      body: { nested: { y: 2, x: 1 }, tags: ["a", "b"], title: "один" },
    }),
    create("не должен выполниться"),
  );
  assert.equal(second.replayed, true);
  assert.equal(second.response.status, 201);
  assert.deepEqual(second.response.body, first.response.body);
  assert.deepEqual(second.response.headers, first.response.headers);
  assert.equal(await count("made", "id=$1", [madeId(first)]), 1);
  assert.equal(await count("made", "title=$1", ["не должен выполниться"]), 0);
});

test("idempotent creation: another body under the same key is a conflict", async () => {
  const user = await addUser("conflict");
  const key = randomUUID();
  await idempotent(db.transaction, options(user, key), create("а"));
  await assert.rejects(
    idempotent(
      db.transaction,
      options(user, key, { body: { title: "другое" } }),
      create("б"),
    ),
    refused("conflict"),
  );
  assert.equal(await count("made", "title=$1", ["б"]), 0);
});

test("idempotent creation: the key belongs to the person and to the request", async () => {
  const [a, b] = [await addUser("a"), await addUser("b")];
  const key = randomUUID();
  const one = await idempotent(db.transaction, options(a, key), create("a"));
  const other = await idempotent(db.transaction, options(b, key), create("b"));
  const elsewhere = await idempotent(
    db.transaction,
    options(a, key, { route: "POST /api/v1/other" }),
    create("c"),
  );
  assert.equal(other.replayed, false, "another person");
  assert.equal(elsewhere.replayed, false, "another request");
  assert.notEqual(madeId(other), madeId(one));
  assert.notEqual(madeId(elsewhere), madeId(one));
});

test("idempotent creation: a failed request leaves no key, so the repeat runs again", async () => {
  const user = await addUser("failing");
  const key = randomUUID();
  await assert.rejects(
    idempotent(db.transaction, options(user, key), async (q) => {
      await q.query("INSERT INTO made(id,title) VALUES($1,'ушло')", [
        randomUUID(),
      ]);
      throw new ApiError("forbidden", "нет");
    }),
    refused("forbidden"),
  );
  assert.equal(await count("api_idempotency", "user_id=$1", [user]), 0);
  assert.equal(
    await count("made", "title='ушло'", []),
    0,
    "nothing was created",
  );
  const retry = await idempotent(
    db.transaction,
    options(user, key),
    create("ok"),
  );
  assert.equal(retry.replayed, false);
  assert.equal(retry.response.status, 201);
});

test("idempotent creation: a key is forgotten after a day", async () => {
  assert.equal(IDEMPOTENCY_DAYS, 1);
  const user = await addUser("expiry");
  const key = randomUUID();
  const first = await idempotent(
    db.transaction,
    options(user, key),
    create("старый"),
  );
  await db.query(
    "UPDATE api_idempotency SET created_at=now()-interval '25 hours' WHERE user_id=$1",
    [user],
  );
  const again = await idempotent(
    db.transaction,
    options(user, key),
    create("новый"),
  );
  assert.equal(again.replayed, false);
  assert.notEqual(madeId(again), madeId(first));
  // Within the day the key still holds.
  await db.query(
    "UPDATE api_idempotency SET created_at=now()-interval '23 hours' WHERE user_id=$1",
    [user],
  );
  const held = await idempotent(
    db.transaction,
    options(user, key),
    create("лишний"),
  );
  assert.equal(held.replayed, true);
  assert.equal(madeId(held), madeId(again));
});

test("idempotent creation: without a key it just runs, unless the key is required", async () => {
  const user = await addUser("nokey");
  const a = await idempotent(db.transaction, options(user, null), create("x"));
  const b = await idempotent(db.transaction, options(user, null), create("x"));
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, false);
  assert.notEqual(madeId(a), madeId(b));
  assert.equal(await count("api_idempotency", "user_id=$1", [user]), 0);
  await assert.rejects(
    idempotent(
      db.transaction,
      options(user, null, { required: true }),
      create("y"),
    ),
    refused("invalid_request"),
  );
  assert.equal(await count("made", "title='y'", []), 0);
});

test("idempotency rows go with the account", async () => {
  const user = await addUser("gone");
  await idempotent(db.transaction, options(user, randomUUID()), create("z"));
  assert.equal(await count("api_idempotency", "user_id=$1", [user]), 1);
  await db.query("DELETE FROM users WHERE id=$1", [user]);
  assert.equal(await count("api_idempotency", "user_id=$1", [user]), 0);
});

test("the email policy of #139 reaches a client as email_verification_required", async () => {
  const response = await safely(async () => {
    throw new EmailPolicyError();
  });
  assert.equal(response.status, 403);
  const { error } = z
    .object({ error: z.object({ code: z.string(), message: z.string() }) })
    .parse(await response.json());
  assert.equal(error.code, "email_verification_required");
  assert.ok(error.message.length > 10);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("idempotency: expired rows of people who never come back are cleaned too, a batch at a time", async () => {
  const gone = await addUser("inactive");
  for (let i = 0; i < 3; i++)
    await idempotent(
      db.transaction,
      options(gone, randomUUID()),
      create("старая " + i),
    );
  await db.query(
    "UPDATE api_idempotency SET created_at=now()-interval '3 days' WHERE user_id=$1",
    [gone],
  );
  assert.equal(await count("api_idempotency", "user_id=$1", [gone]), 3);
  const other = await addUser("active");
  await idempotent(
    db.transaction,
    options(other, randomUUID()),
    create("свежая"),
  );
  assert.equal(await count("api_idempotency", "user_id=$1", [gone]), 0);
  assert.equal(await count("api_idempotency", "user_id=$1", [other]), 1);
});

test("comment bodies: trimmed text of one to a thousand characters, the keys of the contract only (#330)", async () => {
  const { createCommentRequestSchema, editCommentRequestSchema } =
    await import("../lib/api-v1/schemas.ts");
  const parent = randomUUID();
  assert.deepEqual(
    createCommentRequestSchema.parse({ body: "  Привет  ", parentId: parent }),
    { body: "Привет", parentId: parent },
  );
  assert.deepEqual(
    createCommentRequestSchema.parse({ body: "x".repeat(1000) }),
    {
      body: "x".repeat(1000),
    },
  );
  assert.equal(
    createCommentRequestSchema.parse({ body: "ok", parentId: null }).parentId,
    null,
  );
  for (const bad of [
    {},
    { body: "" },
    { body: "   " },
    { body: "x".repeat(1001) },
    { body: "a\0b" },
    { body: 5 },
    { body: "ok", parentId: "not-a-uuid" },
    { body: "ok", extra: true },
  ]) {
    assert.equal(
      createCommentRequestSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
    if ("parentId" in bad || "extra" in bad) continue;
    assert.equal(
      editCommentRequestSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
  }
  assert.equal(
    editCommentRequestSchema.safeParse({ body: "ok", parentId: parent })
      .success,
    false,
  );
  assert.equal(
    editCommentRequestSchema.parse({ body: " новый " }).body,
    "новый",
  );
});
