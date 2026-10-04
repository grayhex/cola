// What a person does with their notifications (#341), through the real server
// and PostgreSQL: marking one, some and all as read by cookie and by token, the
// mark of the list that leaves a notice that came later unread, the filters,
// and the settings with their version. Only for the person, with the Origin
// rule of a cookie and the budgets the site's buttons share.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  errorSchema,
  notificationCountSchema,
  notificationPageSchema,
  notificationReadResultSchema,
  notificationSettingsSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "notification-state-password-123";

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
  const email = `notices-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body, origin = base) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin,
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
      device: { name: "Телефон " + label, platform: "android" },
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
    cookie: withCookie,
    token: withToken,
    bearer: "Bearer " + grant.body.accessToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
  assert.equal(r.headers.get("cache-control"), "no-store", label);
}
const bikeBody = (name) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
});
const idsOf = (r) => r.body.items.map((item) => item.id);
const typesOf = (r) => r.body.items.map((item) => item.type).sort();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

try {
  const me = await member("me");
  const actor = await member("actor");
  const stranger = await member("stranger");
  const fresh = await member("fresh", false);
  const busy = await member("busy", false);
  const bikes = {};
  for (const name of ["a", "b", "c", "d", "e", "f"])
    bikes[name] = (
      await me.web("/bikes", "POST", bikeBody("Мой " + name + " " + run))
    ).body.id;
  const comment = async (who, bike) => {
    const r = await who.web(`/community/bikes/${bike}/comments`, "POST", {
      body: "Хороший велосипед",
    });
    assert.equal(r.status, 201, r.text);
  };
  const count = async (who = me) => {
    const r = await who.token("/me/notifications/count");
    assert.equal(r.status, 200, r.text);
    return notificationCountSchema.parse(r.body);
  };

  // ---- Nobody without a session -------------------------------------------
  for (const [path, options] of [
    ["/me/notifications/" + randomUUID() + "/read", { method: "PUT" }],
    [
      "/me/notifications/read",
      { method: "POST", body: { ids: [randomUUID()] } },
    ],
    [
      "/me/notifications/read-all",
      { method: "POST", body: { watermark: "x" } },
    ],
    ["/me/notification-settings", {}],
    ["/me/notification-settings", { method: "PATCH", body: {} }],
  ])
    assertError(
      await guest(path, { origin: base, ...options }),
      401,
      "unauthorized",
      "guest " + (options.method ?? "GET") + " " + path,
    );

  // ---- Notices made the way people make them ------------------------------
  assert.equal(
    (await actor.token(`/users/${me.username}/follow`, { method: "PUT" }))
      .status,
    200,
  );
  assert.equal(
    (await actor.token(`/bikes/${bikes.a}/like`, { method: "PUT" })).status,
    200,
  );
  await comment(actor, bikes.a);

  const listed = await me.token("/me/notifications");
  assert.equal(listed.status, 200, listed.text);
  notificationPageSchema.parse(listed.body);
  assert.deepEqual(typesOf(listed), ["comment", "follow", "like"]);
  assert.equal(typeof listed.body.watermark, "string");
  const byType = Object.fromEntries(
    listed.body.items.map((item) => [item.type, item]),
  );
  // A category and the typed target, so an app need not read an address.
  assert.equal(byType.follow.category, "reactions");
  assert.equal(byType.like.category, "reactions");
  assert.equal(byType.comment.category, "discussions");
  assert.equal(byType.comment.target.type, "bike");
  assert.equal(byType.comment.target.id, bikes.a);
  assert.match(byType.comment.target.commentId, uuid);
  assert.ok(
    byType.comment.target.path.includes(byType.comment.target.commentId),
  );
  assert.equal(byType.like.target.commentId, null);
  assert.equal(byType.like.target.occurrenceAt, null);
  assert.equal(byType.like.target.agreementRevision, null);

  // The count carries the same mark; reading marks nothing.
  const first = await count();
  assert.deepEqual(
    { unread: first.unread, capped: first.capped },
    { unread: 3, capped: false },
  );
  assert.equal(first.watermark, listed.body.watermark);
  for (let i = 0; i < 3; i++) await me.token("/me/notifications");
  assert.equal((await count()).unread, 3, "a list marks nothing");

  // ---- Filters ------------------------------------------------------------
  const filtered = async (query) => {
    const r = await me.token("/me/notifications" + query);
    assert.equal(r.status, 200, r.text);
    notificationPageSchema.parse(r.body);
    return r;
  };
  assert.deepEqual(typesOf(await filtered("?unread=1")), [
    "comment",
    "follow",
    "like",
  ]);
  assert.deepEqual(typesOf(await filtered("?category=reactions")), [
    "follow",
    "like",
  ]);
  assert.deepEqual(typesOf(await filtered("?category=discussions")), [
    "comment",
  ]);
  assert.deepEqual((await filtered("?category=rides")).body.items, []);
  assert.deepEqual((await filtered("?category=site&unread=1")).body.items, []);
  // A cursor works with a filter: the pages are the filtered list.
  const walked = [];
  let cursor = null;
  for (let guard = 0; guard < 4; guard++) {
    const page = await filtered(
      "?unread=1&category=reactions&limit=1" +
        (cursor ? "&cursor=" + cursor : ""),
    );
    walked.push(...idsOf(page));
    if (!page.body.nextCursor) break;
    cursor = page.body.nextCursor;
  }
  assert.deepEqual(
    walked,
    (await filtered("?category=reactions")).body.items.map((item) => item.id),
  );
  for (const query of ["?category=chat", "?category=nope", "?unread=2"])
    assertError(
      await me.token("/me/notifications" + query),
      400,
      "invalid_request",
      query,
    );

  // ---- Marking one --------------------------------------------------------
  const commentRead = (who, path, options = {}) =>
    who(`/me/notifications/${path}/read`, { method: "PUT", ...options });
  // A cookie needs the site's Origin; a token does not.
  assertError(
    await commentRead(me.cookie, byType.comment.id, { origin: undefined }),
    403,
    "forbidden",
    "cookie without Origin",
  );
  assertError(
    await commentRead(me.cookie, byType.comment.id, {
      origin: "https://evil.test",
    }),
    403,
    "forbidden",
    "foreign Origin",
  );
  assertError(
    await commentRead(me.cookie, byType.comment.id, {
      headers: { authorization: me.bearer },
    }),
    400,
    "ambiguous_authentication",
    "cookie and token together",
  );
  assert.equal((await count()).unread, 3, "a refused call marks nothing");
  const marked = await commentRead(me.token, byType.comment.id);
  assert.equal(marked.status, 200, marked.text);
  assert.deepEqual(notificationReadResultSchema.parse(marked.body), {
    marked: 1,
    unread: 2,
    capped: false,
  });
  assert.equal(marked.headers.get("cache-control"), "no-store");
  // Again: the same answer without a mark, and by cookie as well.
  assert.deepEqual((await commentRead(me.cookie, byType.comment.id)).body, {
    marked: 0,
    unread: 2,
    capped: false,
  });
  const afterOne = await me.token("/me/notifications");
  assert.ok(
    afterOne.body.items.find((item) => item.id === byType.comment.id).readAt,
  );
  assert.deepEqual(typesOf(await filtered("?unread=1")), ["follow", "like"]);
  // Someone else's, unknown and not an id are all the same 404, and mark nothing.
  for (const [who, id, label] of [
    [stranger, byType.like.id, "someone else's"],
    [me, randomUUID(), "unknown"],
    [me, "not-an-id", "not an id"],
  ])
    assertError(await commentRead(who.token, id), 404, "not_found", label);
  assert.equal((await count()).unread, 2);
  assert.equal((await count(stranger)).unread, 0);

  // ---- Marking some -------------------------------------------------------
  const some = (ids, who = me) =>
    who.token("/me/notifications/read", { method: "POST", body: { ids } });
  // An id that is not the person's is not counted and is not an error.
  const selected = await some([byType.like.id, randomUUID()]);
  assert.equal(selected.status, 200, selected.text);
  assert.deepEqual(notificationReadResultSchema.parse(selected.body), {
    marked: 1,
    unread: 1,
    capped: false,
  });
  assert.equal((await some([byType.follow.id], stranger)).body.marked, 0);
  assert.equal((await count()).unread, 1, "nobody marks another's notices");
  for (const body of [
    {},
    { ids: [] },
    { ids: ["x"] },
    { ids: Array.from({ length: 101 }, () => randomUUID()) },
    { ids: [byType.follow.id], extra: true },
  ])
    assertError(
      await me.token("/me/notifications/read", { method: "POST", body }),
      400,
      "invalid_request",
      "selection " + JSON.stringify(body).slice(0, 40),
    );

  // ---- The mark of the list: what came after stays unread -----------------
  const shown = await count();
  assert.equal(shown.unread, 1);
  await comment(actor, bikes.b);
  assert.equal((await count()).unread, 2);
  const all = (body, who = me) =>
    who.token("/me/notifications/read-all", { method: "POST", body });
  const upTo = await all({ watermark: shown.watermark });
  assert.equal(upTo.status, 200, upTo.text);
  assert.deepEqual(notificationReadResultSchema.parse(upTo.body), {
    marked: 1,
    unread: 1,
    capped: false,
  });
  const late = await filtered("?unread=1");
  assert.equal(late.body.items.length, 1);
  assert.equal(late.body.items[0].target.id, bikes.b, "the later one is new");
  const nowMark = await count();
  assert.deepEqual((await all({ watermark: nowMark.watermark })).body, {
    marked: 1,
    unread: 0,
    capped: false,
  });
  assert.deepEqual((await all({ watermark: nowMark.watermark })).body, {
    marked: 0,
    unread: 0,
    capped: false,
  });
  // The mark of one account is no mark at all for another.
  assertError(
    await all({ watermark: nowMark.watermark }, stranger),
    400,
    "invalid_request",
    "the mark of another account",
  );

  // What is hidden now was not shown: it stays new and is there when it is back.
  await comment(actor, bikes.c);
  assert.equal((await count()).unread, 1);
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bikes.c]);
  assert.equal((await count()).unread, 0);
  const hiddenMark = await count();
  assert.equal((await all({ watermark: hiddenMark.watermark })).body.marked, 0);
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bikes.c]);
  assert.equal((await count()).unread, 1, "a hidden notice was not read");
  assert.equal(
    (await all({ watermark: (await count()).watermark })).body.marked,
    1,
  );

  // One category: the rest is left as it was.
  await comment(stranger, bikes.a);
  assert.equal(
    (await actor.token(`/bikes/${bikes.b}/like`, { method: "PUT" })).status,
    200,
  );
  const both = await count();
  assert.equal(both.unread, 2);
  assert.deepEqual(
    (await all({ watermark: both.watermark, category: "market" })).body,
    { marked: 0, unread: 2, capped: false },
  );
  assert.deepEqual(
    (await all({ watermark: both.watermark, category: "discussions" })).body,
    { marked: 1, unread: 1, capped: false },
  );
  assert.deepEqual(typesOf(await filtered("?unread=1")), ["like"]);
  assert.equal((await all({ watermark: both.watermark })).body.unread, 0);

  // A mark the server did not give is refused; so is a cursor and a bad category.
  const page = await filtered("?limit=1");
  const bad = [
    [{ watermark: "garbage" }, "garbage"],
    [{ watermark: page.body.nextCursor ?? "x".repeat(40) }, "a page cursor"],
    [{}, "missing"],
    [{ watermark: "" }, "empty"],
    [
      { watermark: both.watermark, category: "chat" },
      "a category without events",
    ],
    [{ watermark: both.watermark, extra: 1 }, "extra field"],
  ];
  for (const [body, label] of bad)
    assertError(await all(body), 400, "invalid_request", label);
  assert.equal(
    (await all({ watermark: "garbage" })).body.error.details[0].path,
    "watermark",
  );

  // A mark is only for the person it was given to: the mark of another account
  // (an app that kept it after the account was switched) and a made-up one are
  // refused, and nothing of the person's is read by them.
  await comment(stranger, bikes.b);
  assert.equal(
    (await me.token(`/users/${actor.username}/follow`, { method: "PUT" }))
      .status,
    200,
  );
  const foreignMark = (await count(actor)).watermark;
  assert.equal(typeof foreignMark, "string", "the other account has a mark");
  const madeUp = Buffer.from(
    JSON.stringify({
      w: 1,
      t: "2099-01-01T00:00:00.000000Z",
      i: randomUUID(),
    }),
  ).toString("base64url");
  assert.equal((await count()).unread, 1);
  for (const [watermark, label] of [
    [foreignMark, "another account's mark"],
    [madeUp, "a made-up mark"],
  ]) {
    assertError(await all({ watermark }), 400, "invalid_request", label);
    assert.equal(
      (
        await me.web("/community/notifications/read-all", "PATCH", {
          watermark,
        })
      ).status,
      400,
      "the site refuses " + label,
    );
  }
  assert.equal((await count()).unread, 1, "a refused mark reads nothing");
  assert.equal((await count(actor)).unread, 1, "nor does it touch the other");
  assert.deepEqual(
    (await all({ watermark: (await count()).watermark })).body,
    { marked: 1, unread: 0, capped: false },
    "the person's own mark works",
  );

  // ---- The site's own routes share the state ------------------------------
  await comment(actor, bikes.d);
  const siteCount = await me.web("/community/notifications/count");
  assert.equal(siteCount.status, 200, siteCount.text);
  assert.equal(siteCount.body.unread, 1);
  assert.equal(typeof siteCount.body.watermark, "string");
  await comment(actor, bikes.e);
  assert.equal(
    (
      await me.web("/community/notifications/read-all", "PATCH", {
        watermark: siteCount.body.watermark,
      })
    ).body.unread,
    1,
    "the page's mark keeps the later notice",
  );
  assert.equal(
    (
      await me.web("/community/notifications/read-all", "PATCH", {
        watermark: "garbage",
      })
    ).status,
    400,
  );
  assert.equal(
    (await me.web("/community/notifications/read-all", "PATCH")).body.unread,
    0,
    "without a mark: everything there is",
  );
  assert.equal((await count()).unread, 0, "one state for both");
  assert.equal(
    (await me.web(`/community/notifications/${randomUUID()}/read`, "PATCH"))
      .status,
    404,
  );
  assert.equal(
    (
      await me.web(
        `/community/notifications/${byType.follow.id}/read`,
        "PATCH",
        undefined,
        "https://evil.test",
      )
    ).status,
    403,
  );

  // ---- The budget is one for the site and the API -------------------------
  for (let i = 0; i < 120; i++) {
    const r = await commentRead(busy.token, randomUUID());
    assert.equal(r.status, 404, "call " + (i + 1));
  }
  const limited = await commentRead(busy.token, randomUUID());
  assertError(limited, 429, "rate_limited", "121st call");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(
    (await busy.web("/community/notifications/read-all", "PATCH")).status,
    429,
    "the site spends the same budget",
  );
  assert.equal((await commentRead(me.token, byType.comment.id)).status, 200);

  // ---- Settings -----------------------------------------------------------
  const settings = async (who = me) => {
    const r = await who.token("/me/notification-settings");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return { ...r, settings: notificationSettingsSchema.parse(r.body) };
  };
  const patch = (body, options = {}, who = me) =>
    who.token("/me/notification-settings", {
      method: "PATCH",
      body,
      ...options,
    });
  const etag = (r) => r.headers.get("etag");

  const initial = await settings();
  assert.match(etag(initial), /^"[A-Za-z0-9_-]{27}"$/);
  assert.deepEqual(initial.settings.channels, {
    email: { available: true, verified: true, enabled: false },
    push: { available: false, enabled: false },
  });
  assert.deepEqual(initial.settings.categories.map((c) => c.key).sort(), [
    "discussions",
    "market",
    "rides",
  ]);
  assert.equal(initial.settings.reminders, true);
  assert.equal(initial.settings.updatedAt, null);
  assert.ok(!initial.text.includes("@example.test"), "no address in settings");
  assert.deepEqual((await settings(stranger)).settings, initial.settings);
  // By cookie as well (a read needs no Origin).
  assert.deepEqual(
    (await me.cookie("/me/notification-settings")).body,
    initial.body,
  );

  // The first change of an account applies to the version of the defaults.
  const enabled = await patch(
    { channels: { email: { enabled: true } } },
    { headers: { "if-match": etag(initial) } },
  );
  assert.equal(enabled.status, 200, enabled.text);
  assert.equal(
    notificationSettingsSchema.parse(enabled.body).channels.email.enabled,
    true,
  );
  assert.notEqual(etag(enabled), etag(initial), "a change is a new version");
  assert.ok(enabled.body.updatedAt);
  assert.equal((await settings()).headers.get("etag"), etag(enabled));
  // The same again, and nothing at all: no change, same version.
  for (const body of [{ channels: { email: { enabled: true } } }, {}]) {
    const same = await patch(body);
    assert.equal(same.status, 200, same.text);
    assert.equal(etag(same), etag(enabled));
    assert.deepEqual(same.body, enabled.body);
  }
  // If-Match: the version the client saw, or a refusal that changes nothing.
  assertError(
    await patch(
      { reminders: false },
      { headers: { "if-match": etag(initial) } },
    ),
    412,
    "precondition_failed",
    "stale If-Match",
  );
  assert.equal((await settings()).settings.reminders, true);
  const reminders = await patch(
    { reminders: false },
    { headers: { "if-match": etag(enabled) } },
  );
  assert.equal(reminders.status, 200, reminders.text);
  assert.equal(reminders.body.reminders, false);
  assert.notEqual(etag(reminders), etag(enabled));
  assert.equal(
    (await patch({ reminders: true }, { headers: { "if-match": "*" } })).status,
    200,
  );
  // The site's form is a view of the same settings.
  const form = await me.web("/account/notifications");
  assert.equal(form.status, 200, form.text);
  assert.equal(form.body.enabled, true);
  assert.equal(form.body.reminders, true);
  const before = etag(await settings());
  assert.equal(
    (
      await me.web("/account/notifications", "PATCH", {
        enabled: true,
        discussions: false,
        rides: true,
        market: true,
      })
    ).status,
    200,
  );
  const afterForm = await settings();
  assert.notEqual(etag(afterForm), before);
  assert.deepEqual(
    Object.fromEntries(
      afterForm.settings.categories.map((c) => [c.key, c.email.enabled]),
    ),
    { rides: true, discussions: false, market: true },
  );
  // And back: a switch in the API shows in the form.
  assert.equal(
    (await patch({ categories: [{ key: "market", email: false }] })).status,
    200,
  );
  assert.equal((await me.web("/account/notifications")).body.market, false);

  // Push is not connected: it cannot be switched on, and refusing stores nothing.
  const quiet = await settings();
  assertError(
    await patch({ channels: { push: { enabled: true } } }),
    503,
    "service_unavailable",
    "push on",
  );
  assert.equal(etag(await settings()), etag(quiet));
  // Switching off is always allowed; switching a category back on is not.
  assert.equal(
    (await patch({ categories: [{ key: "rides", push: false }] })).status,
    200,
  );
  const pushOff = await settings();
  assert.equal(
    pushOff.settings.categories.find((c) => c.key === "rides").push.enabled,
    false,
  );
  assertError(
    await patch({ categories: [{ key: "rides", push: true }] }),
    503,
    "service_unavailable",
    "a push category on",
  );
  assert.equal(etag(await settings()), etag(pushOff));
  assert.equal(
    (await patch({ channels: { push: { enabled: false } } })).status,
    200,
  );

  // What is not a setting is refused whole.
  for (const [body, label] of [
    [{ userId: me.id }, "a field that is not there"],
    [{ channels: { sms: { enabled: true } } }, "a channel that is not there"],
    [{ channels: { email: { enabled: "yes" } } }, "a string for a switch"],
    [
      { categories: [{ key: "chat", email: true }] },
      "a category without events",
    ],
    [
      { categories: [{ key: "market", push: true }] },
      "a channel the category cannot use",
    ],
    [{ categories: [{ key: "rides" }, { key: "rides" }] }, "a category twice"],
    [{ reminders: "no" }, "reminders"],
  ])
    assertError(await patch(body), 400, "invalid_request", label);
  assert.equal(etag(await settings()), etag(await settings()));
  // Not JSON at all.
  assertError(
    await http("/api/v1/me/notification-settings", {
      method: "PATCH",
      headers: {
        authorization: me.bearer,
        "content-type": "application/json",
      },
    }),
    400,
    "invalid_request",
    "no body",
  );

  // Credentials: a cookie needs Origin for a change, a token does not.
  assertError(
    await me.cookie("/me/notification-settings", {
      method: "PATCH",
      body: {},
      origin: undefined,
    }),
    403,
    "forbidden",
    "cookie without Origin",
  );
  assertError(
    await me.cookie("/me/notification-settings", {
      method: "PATCH",
      body: {},
      origin: "https://evil.test",
    }),
    403,
    "forbidden",
    "foreign Origin",
  );
  assert.equal(
    (
      await me.cookie("/me/notification-settings", {
        method: "PATCH",
        body: { reminders: true },
      })
    ).status,
    200,
  );
  assertError(
    await me.cookie("/me/notification-settings", {
      method: "PATCH",
      body: {},
      headers: { authorization: me.bearer },
    }),
    400,
    "ambiguous_authentication",
    "cookie and token together",
  );
  assertError(
    await me.token("/me/notification-settings", { method: "PUT", body: {} }),
    405,
    "method_not_allowed",
    "PUT",
  );
  assertError(
    await me.token("/me/notifications/read", { method: "GET" }),
    405,
    "method_not_allowed",
    "GET read",
  );

  // An address that is not verified cannot be switched on; the rest still works.
  const notYet = await settings(fresh);
  assert.equal(notYet.settings.channels.email.verified, false);
  assertError(
    await patch({ channels: { email: { enabled: true } } }, {}, fresh),
    403,
    "email_verification_required",
    "unverified address",
  );
  assert.equal((await patch({ reminders: false }, {}, fresh)).status, 200);
  assert.equal((await settings(fresh)).settings.channels.email.enabled, false);
  // Nobody else's settings moved.
  assert.deepEqual((await settings(stranger)).settings, initial.settings);

  // The settings budget is the site form's.
  for (let i = 0; i < 30; i++)
    assert.equal((await patch({}, {}, busy)).status, 200, "change " + (i + 1));
  const spent = await patch({}, {}, busy);
  assertError(spent, 429, "rate_limited", "31st change");
  assert.ok(Number(spent.headers.get("retry-after")) > 0);
  assert.equal(
    (
      await busy.web("/account/notifications", "PATCH", {
        enabled: false,
        discussions: false,
        rides: false,
        market: false,
      })
    ).status,
    429,
    "the form spends the same budget",
  );

  console.log(
    "Notification state HTTP: read one, some and all, the mark of the list, filters, settings with versions, Origin and budgets passed.",
  );
} finally {
  await db.end();
}
