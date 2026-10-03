// API v1, writing comments (#330), through the real server and PostgreSQL, for
// the four objects that have them: the conventions of #305 (Origin by
// credential, verified e-mail, body rules, budgets, idempotent creation), the
// rights of the site's own engine, and what a comment under another object's
// path may not do.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { commentSchema, errorSchema } from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "commentw-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label, verified = true) {
  const email = `commentw-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: "Райдер " + label,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  if (verified) await verifyCapturedEmail(email);
  // A cookie request, with the Origin the site sends unless a test says otherwise.
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  // A native client: a device session, a Bearer token and no Origin at all.
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const withToken = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    web,
    cookieValue: () => cookie,
    bearer: async () => "Bearer " + grant.body.accessToken,
    cookie: withCookie,
    token: withToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const bikeBody = (name, isPublic = true) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: isPublic,
});

try {
  const owner = await member("owner");
  const author = await member("author");
  const other = await member("other");
  const mailless = await member("mailless", false);
  const moderator = await member("moderator");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [moderator.id]);

  const bike = (await owner.web("/bikes", "POST", bikeBody("Публичный " + run)))
    .body.id;
  const closed = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;
  const entry = randomUUID();
  await db.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,components,created_at,updated_at,published_at)
     VALUES($1,$2,$3,$4,'build','Запись','Текст','published',true,'2026-08-30',100,'[]'::jsonb,now(),now(),now())`,
    [entry, randomUUID(), owner.id, bike],
  );
  const ride = randomUUID();
  await db.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,is_public,started_at,distance_m,point_count,public_point_count,public_geometry,privacy_enabled,privacy_radius_m,source_hash,recurrence,meeting_point,meeting_visibility,plan_passport,import_metrics,published_at)
     VALUES($1,$1,$2,$3,'Покатушка','описание','completed','gpx',false,true,now()-interval '2 days',12000,2,2,'[]',true,500,$4,'none','','public','{}','{}',now())`,
    [ride, owner.id, bike, "fixture-" + ride],
  );
  const part = `Shimano Comment ${run}`;
  await db.query(
    "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Тормоза',$3)",
    [randomUUID(), bike, part],
  );
  const model = (
    await db.query("SELECT id FROM component_models WHERE name=$1", [part])
  ).rows[0].id;

  const targets = [
    { path: "bikes", id: bike, label: "bike" },
    { path: "journal", id: entry, label: "journal" },
    { path: "rides", id: ride, label: "ride" },
    { path: "component-models", id: model, label: "component" },
  ];
  const created = {};
  for (const t of targets) {
    const collection = `/${t.path}/${t.id}/comments`;
    const body = { body: "Комментарий " + t.label };
    // Who may write.
    assertError(
      await guest(collection, { method: "POST", body }),
      401,
      "unauthorized",
      t.label + " guest",
    );
    assertError(
      await author.cookie(collection, {
        method: "POST",
        body,
        origin: "https://evil.example",
      }),
      403,
      "forbidden",
      t.label + " foreign origin",
    );
    assertError(
      await mailless.token(collection, { method: "POST", body }),
      403,
      "email_verification_required",
      t.label + " unverified",
    );
    // The body.
    assertError(
      await author.token(collection, { method: "POST", body: { body: "   " } }),
      400,
      "invalid_request",
      t.label + " blank",
    );
    assertError(
      await author.token(collection, {
        method: "POST",
        body: { body: "x".repeat(1001) },
      }),
      400,
      "invalid_request",
      t.label + " long",
    );
    assertError(
      await author.token(collection, {
        method: "POST",
        body: { body: "ok", extra: 1 },
      }),
      400,
      "invalid_request",
      t.label + " unknown field",
    );
    assertError(
      await author.token(collection, {
        method: "POST",
        body: { body: "ok", parentId: randomUUID() },
      }),
      404,
      "not_found",
      t.label + " unknown parent",
    );
    const text = await fetch(base + "/api/v1" + collection, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization: "Bearer " + (await author.bearer()).slice(7),
      },
      body: "hello",
    });
    assert.equal(text.status, 415, t.label + " content type");
    const big = await fetch(base + "/api/v1" + collection, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + (await author.bearer()).slice(7),
      },
      body: JSON.stringify({ body: "x".repeat(9000) }),
    });
    assert.equal(big.status, 413, t.label + " too large");
    // Create, by token and by cookie.
    const first = await author.token(collection, { method: "POST", body });
    assert.equal(first.status, 201, first.text);
    commentSchema.parse(first.body);
    assert.equal(first.body.body, body.body);
    assert.equal(first.body.author.username, author.username);
    assert.equal(first.body.parentId, null);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const viaCookie = await other.cookie(collection, {
      method: "POST",
      body: { body: "Ответ " + t.label, parentId: first.body.id },
    });
    assert.equal(viaCookie.status, 201, viaCookie.text);
    assert.equal(viaCookie.body.parentId, first.body.id);
    created[t.label] = { first: first.body.id, reply: viaCookie.body.id };
    // The list shows both.
    const list = await guest(collection);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.items[0].comment.id, first.body.id);
    assert.equal(list.body.items[0].replies[0].id, viaCookie.body.id);
    assert.equal(list.body.items[0].comment.replyCount, 1);
  }

  // The owner heard about the comments, as on the site.
  const heard = await owner.token("/me/notifications");
  assert.deepEqual(heard.body.items.map((item) => item.type).sort(), [
    "comment",
    "comment",
    "journal_comment",
    "journal_comment",
    "ride_comment",
    "ride_comment",
  ]);

  // A private object takes no comments, whoever asks (the owner too).
  assertError(
    await owner.token(`/bikes/${closed}/comments`, {
      method: "POST",
      body: { body: "себе" },
    }),
    404,
    "not_found",
    "private bike",
  );
  assertError(
    await author.token(`/bikes/${randomUUID()}/comments`, {
      method: "POST",
      body: { body: "никому" },
    }),
    404,
    "not_found",
    "unknown bike",
  );
  assertError(
    await author.token(`/bikes/nonsense/comments`, {
      method: "POST",
      body: { body: "никому" },
    }),
    404,
    "not_found",
    "malformed id",
  );

  // Idempotent creation: a repeated key answers with the first comment.
  const route = `/bikes/${bike}/comments`;
  const key = randomUUID();
  const one = await author.token(route, {
    method: "POST",
    body: { body: "Один раз" },
    headers: { "idempotency-key": key },
  });
  assert.equal(one.status, 201, one.text);
  const again = await author.token(route, {
    method: "POST",
    body: { body: "Один раз" },
    headers: { "idempotency-key": key },
  });
  assert.equal(again.status, 201, again.text);
  assert.equal(again.body.id, one.body.id);
  assert.equal(again.headers.get("idempotency-replayed"), "true");
  assert.equal(one.headers.get("idempotency-replayed"), null);
  assertError(
    await author.token(route, {
      method: "POST",
      body: { body: "Другой текст" },
      headers: { "idempotency-key": key },
    }),
    409,
    "conflict",
    "same key, another body",
  );
  assertError(
    await author.token(route, {
      method: "POST",
      body: { body: "x" },
      headers: { "idempotency-key": "not-a-uuid" },
    }),
    400,
    "invalid_request",
    "bad key",
  );
  // The same key by another person is another request.
  const theirs = await other.token(route, {
    method: "POST",
    body: { body: "Один раз" },
    headers: { "idempotency-key": key },
  });
  assert.equal(theirs.status, 201);
  assert.notEqual(theirs.body.id, one.body.id);
  // Simultaneous requests with one key make one comment.
  const racing = randomUUID();
  const burst = await Promise.all(
    Array.from({ length: 5 }, () =>
      author.token(route, {
        method: "POST",
        body: { body: "Гонка" },
        headers: { "idempotency-key": racing },
      }),
    ),
  );
  assert.ok(
    burst.every((r) => r.status === 201),
    burst.map((r) => r.status).join(),
  );
  assert.equal(new Set(burst.map((r) => r.body.id)).size, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM bike_comments WHERE body='Гонка' AND bike_id=$1",
        [bike],
      )
    ).rows[0].n,
    1,
  );

  // Editing: only the author, only under the right object.
  for (const t of targets) {
    const mine = created[t.label].first;
    const item = (id) => `/${t.path}/${t.id}/comments/${id}`;
    const edited = await author.token(item(mine), {
      method: "PATCH",
      body: { body: "Исправлено " + t.label },
    });
    assert.equal(edited.status, 200, edited.text);
    commentSchema.parse(edited.body);
    assert.equal(edited.body.body, "Исправлено " + t.label);
    assert.ok(edited.body.editedAt, "edited is marked");
    assertError(
      await other.token(item(mine), {
        method: "PATCH",
        body: { body: "чужое" },
      }),
      403,
      "forbidden",
      t.label + " foreign edit",
    );
    assertError(
      await mailless.token(item(mine), {
        method: "PATCH",
        body: { body: "x" },
      }),
      403,
      "email_verification_required",
      t.label + " unverified edit",
    );
    assertError(
      await author.token(item(mine), { method: "PATCH", body: { body: "" } }),
      400,
      "invalid_request",
      t.label + " blank edit",
    );
    assertError(
      await author.token(item(randomUUID()), {
        method: "PATCH",
        body: { body: "x" },
      }),
      404,
      "not_found",
      t.label + " unknown comment",
    );
    assertError(
      await guest(item(mine), { method: "PATCH", body: { body: "x" } }),
      401,
      "unauthorized",
      t.label + " guest edit",
    );
    assertError(
      await author.cookie(item(mine), {
        method: "PATCH",
        body: { body: "x" },
        origin: "https://evil.example",
      }),
      403,
      "forbidden",
      t.label + " edit origin",
    );
    assertError(
      await author.token(item(mine), { method: "GET" }),
      405,
      "method_not_allowed",
      t.label + " GET item",
    );
  }
  // A comment of one object is not reachable under another's path.
  assertError(
    await author.token(`/journal/${entry}/comments/${created.bike.first}`, {
      method: "PATCH",
      body: { body: "не туда" },
    }),
    404,
    "not_found",
    "comment of another object",
  );
  assertError(
    await author.token(`/rides/${ride}/comments/${created.bike.first}`, {
      method: "DELETE",
    }),
    404,
    "not_found",
    "delete under another object",
  );
  assert.equal(
    (
      await db.query("SELECT body FROM bike_comments WHERE id=$1", [
        created.bike.first,
      ])
    ).rows[0].body,
    "Исправлено bike",
  );

  // Deleting: the author, a moderator (on the record), a tombstone while replies remain.
  for (const t of targets) {
    const item = (id) => `/${t.path}/${t.id}/comments/${id}`;
    assertError(
      await other.token(item(created[t.label].first), { method: "DELETE" }),
      403,
      "forbidden",
      t.label + " foreign delete",
    );
    const removed = await author.token(item(created[t.label].first), {
      method: "DELETE",
    });
    assert.equal(removed.status, 204, removed.text);
    assert.equal(removed.text, "");
    assert.equal(
      (await author.token(item(created[t.label].first), { method: "DELETE" }))
        .status,
      204,
      t.label + " repeat delete",
    );
    assertError(
      await author.token(item(created[t.label].first), {
        method: "PATCH",
        body: { body: "x" },
      }),
      404,
      "not_found",
      t.label + " edit deleted",
    );
    const list = await guest(`/${t.path}/${t.id}/comments`);
    const thread = list.body.items.find(
      (entryItem) => entryItem.comment.id === created[t.label].first,
    );
    assert.ok(thread, "a tombstone stays while a reply remains");
    assert.equal(thread.comment.deleted, true);
    assert.equal(thread.comment.body, null);
    assert.equal(thread.comment.author, null);
  }
  const audited = await moderator.token(
    `/bikes/${bike}/comments/${created.bike.reply}`,
    { method: "DELETE" },
  );
  assert.equal(audited.status, 204, audited.text);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM admin_audit WHERE actor_id=$1 AND action='community.comment.delete' AND target=$2",
        [moderator.id, created.bike.reply],
      )
    ).rows[0].n,
    1,
  );

  // The budget of new comments is the site's: 20 a window, then 429.
  const talker = await member("talker");
  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await talker.token(route, {
      method: "POST",
      body: { body: "Раз " + i },
    });
    if (r.status === 429) limited = r;
    else assert.equal(r.status, 201, r.text);
  }
  assert.ok(limited, "the budget ends");
  assertError(limited, 429, "rate_limited", "budget");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  console.log("api v1 comments write http: ok");
} finally {
  await db.end();
}
