// API v1, planning together (#343), through the real server and PostgreSQL:
// intentions to ride (create with a key, replay, versions, cancel, delete, the
// two lists) and a person's part in a planned ride (the read a notification
// opens, the answer that is refused for an old date or old conditions). The
// rules themselves are the site's; this checks that the transport keeps them.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  errorSchema,
  rideIntentPageSchema,
  rideIntentSchema,
  rideParticipationConflictSchema,
  rideParticipationSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "planning-http-password-123";

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
  const email = `planning-${label}-${run}@example.test`;
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
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
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
    web,
    bearer: "Bearer " + grant.body.accessToken,
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
const key = () => ({ "Idempotency-Key": randomUUID() });
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const draft = (overrides = {}) => ({
  readiness: "considering",
  timeZone: "Europe/Moscow",
  windows: [{ startLocal: tomorrow + "T10:00", endLocal: tomorrow + "T15:00" }],
  passport: {
    area: { label: "Парк", center: [37.12, 55.65], radiusM: 3000 },
    purpose: "social",
  },
  visibility: "private",
  allowSuggestions: false,
  ...overrides,
});

try {
  const author = await member("author");
  const reader = await member("reader");
  const mailless = await member("mailless", false);
  const host = await member("host");
  const invitee = await member("invitee");
  const stranger = await member("stranger");

  // ---- Intentions to ride -------------------------------------------------
  const collection = "/ride-intents";
  assertError(
    await guest(collection, { method: "POST", body: draft() }),
    401,
    "unauthorized",
    "guest create",
  );
  assertError(await guest(collection), 401, "unauthorized", "guest list");
  assertError(
    await guest("/me/ride-intents"),
    401,
    "unauthorized",
    "guest own list",
  );
  assertError(
    await author.cookie(collection, {
      method: "POST",
      body: draft(),
      headers: key(),
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "foreign origin",
  );
  assertError(
    await author.token(collection, { method: "POST", body: draft() }),
    400,
    "invalid_request",
    "the key is the identity: required",
  );
  assertError(
    await author.token(collection, {
      method: "POST",
      body: draft(),
      headers: { "Idempotency-Key": "not-a-uuid" },
    }),
    400,
    "invalid_request",
    "a key that is no UUID",
  );
  assertError(
    await mailless.token(collection, {
      method: "POST",
      body: draft({ visibility: "community" }),
      headers: key(),
    }),
    403,
    "email_verification_required",
    "community needs a confirmed address",
  );
  const privateOnly = await mailless.token(collection, {
    method: "POST",
    body: draft(),
    headers: key(),
  });
  assert.equal(privateOnly.status, 201, "a private intention needs no address");

  // The body.
  for (const [label, body, code] of [
    ["unknown field", { ...draft(), requestId: randomUUID() }, 400],
    ["no windows", draft({ windows: [] }), 400],
    [
      "unknown purpose",
      draft({ passport: { area: { label: "Парк" }, purpose: "x" } }),
      400,
    ],
    [
      "a window of the past",
      draft({
        windows: [
          { startLocal: "2020-01-01T10:00", endLocal: "2020-01-01T12:00" },
        ],
      }),
      400,
    ],
    ["not a zone", draft({ timeZone: "Moscow" }), 400],
  ]) {
    const r = await author.token(collection, {
      method: "POST",
      body,
      headers: key(),
    });
    assertError(r, code, "invalid_request", label);
  }
  const plain = await fetch(base + "/api/v1" + collection, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "idempotency-key": randomUUID(),
      authorization: author.bearer,
    },
    body: "hello",
  });
  assert.equal(plain.status, 415, "the body is JSON");
  const big = await fetch(base + "/api/v1" + collection, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      authorization: author.bearer,
    },
    body: JSON.stringify({ padding: "x".repeat(9000) }),
  });
  assert.equal(big.status, 413, "the body is bounded");

  // Create, replay, conflict.
  const first = key();
  const created = await author.token(collection, {
    method: "POST",
    body: draft({ visibility: "community", readiness: "ready" }),
    headers: first,
  });
  assert.equal(created.status, 201, created.text);
  rideIntentSchema.parse(created.body);
  assert.equal(created.body.own, true);
  assert.equal(created.body.status, "active");
  assert.equal(created.body.visibility, "community");
  assert.equal(created.body.allowSuggestions, false);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const etag = created.headers.get("etag");
  assert.match(etag, /^"[A-Za-z0-9_-]{27}"$/);
  const intent = created.body.id;

  const replay = await author.token(collection, {
    method: "POST",
    body: draft({ visibility: "community", readiness: "ready" }),
    headers: first,
  });
  assert.equal(replay.status, 201, "the stored answer");
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(replay.body, created.body);
  assert.equal(replay.headers.get("etag"), etag);
  assertError(
    await author.token(collection, {
      method: "POST",
      body: draft({ readiness: "considering" }),
      headers: first,
    }),
    409,
    "conflict",
    "the same key with another body",
  );
  const otherPerson = await reader.token(collection, {
    method: "POST",
    body: draft({ visibility: "community", readiness: "ready" }),
    headers: first,
  });
  assert.equal(otherPerson.status, 201, otherPerson.text);
  assert.notEqual(
    otherPerson.body.id,
    intent,
    "a key is the person's own, not shared",
  );
  const count = await db.query(
    "SELECT count(*)::int n FROM ride_intents WHERE owner_id=$1",
    [author.id],
  );
  assert.equal(count.rows[0].n, 1, "a retry made no second intention");

  // Reads.
  const one = await author.token(`${collection}/${intent}`);
  assert.equal(one.status, 200, one.text);
  assert.deepEqual(rideIntentSchema.parse(one.body), created.body);
  assert.equal(one.headers.get("etag"), etag);
  const seen = await reader.token(`${collection}/${intent}`);
  assert.equal(seen.status, 200, "a community intention is readable");
  assert.equal(seen.body.own, false);
  assert.equal("allowSuggestions" in seen.body, false);
  assertError(
    await stranger.token(`${collection}/${randomUUID()}`),
    404,
    "not_found",
    "missing",
  );
  assertError(
    await guest(`${collection}/${intent}`),
    401,
    "unauthorized",
    "guest read",
  );
  const privateId = privateOnly.body.id;
  assertError(
    await reader.token(`${collection}/${privateId}`),
    404,
    "not_found",
    "someone else's private intention looks missing",
  );

  const community = await reader.token(collection + "?limit=1");
  assert.equal(community.status, 200, community.text);
  rideIntentPageSchema.parse(community.body);
  assert.equal(community.body.items.length, 1);
  assert.ok(community.body.nextCursor, "two community intentions: a next page");
  const second = await reader.token(
    `${collection}?limit=1&cursor=${encodeURIComponent(community.body.nextCursor)}`,
  );
  assert.equal(second.status, 200, second.text);
  const ids = [community.body.items[0].id, second.body.items[0].id].sort();
  assert.deepEqual(ids, [intent, otherPerson.body.id].sort());
  assert.ok(
    !ids.includes(privateId),
    "a private one is not in the community list",
  );
  assertError(
    await reader.token(collection + "?cursor=garbage"),
    400,
    "invalid_request",
    "a cursor that is not ours",
  );
  const own = await author.token("/me/ride-intents");
  assert.deepEqual(
    own.body.items.map((item) => item.id),
    [intent],
  );

  // A full replacement with versions.
  const replaced = await author.token(`${collection}/${intent}`, {
    method: "PUT",
    body: draft({ visibility: "community", readiness: "considering" }),
    headers: { "If-Match": etag },
  });
  assert.equal(replaced.status, 200, replaced.text);
  assert.equal(replaced.body.readiness, "considering");
  const next = replaced.headers.get("etag");
  assert.notEqual(next, etag, "every edit is a new version");
  assertError(
    await author.token(`${collection}/${intent}`, {
      method: "PUT",
      body: draft({ readiness: "ready" }),
      headers: { "If-Match": etag },
    }),
    412,
    "precondition_failed",
    "the second device holds the old version",
  );
  const unconditional = await author.cookie(`${collection}/${intent}`, {
    method: "PUT",
    body: draft({ visibility: "community", readiness: "ready" }),
  });
  assert.equal(unconditional.status, 200, "If-Match is optional");
  assertError(
    await reader.token(`${collection}/${intent}`, {
      method: "PUT",
      body: draft(),
    }),
    404,
    "not_found",
    "a replacement of someone else's intention",
  );
  assertError(
    await author.cookie(`${collection}/${intent}`, {
      method: "PUT",
      body: draft(),
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "foreign origin on replacement",
  );

  // The area (#370): a label, a centre and a radius are one object. The client
  // may send a precise point; the site keeps and returns the coarse one. A label
  // alone stays valid (older records, no map), a centre without a radius or a
  // radius without a centre is refused, and an edit replaces the whole area.
  const mapper = await member("mapper");
  const areaOf = (area, extra = {}) =>
    draft({
      passport: { area, purpose: "social" },
      visibility: "private",
      ...extra,
    });
  const precise = await mapper.token(collection, {
    method: "POST",
    body: areaOf({
      label: "Измайловский парк",
      center: [37.75123, 55.79456],
      radiusM: 2000,
    }),
    headers: key(),
  });
  assert.equal(precise.status, 201, precise.text);
  assert.deepEqual(
    precise.body.passport.area,
    { label: "Измайловский парк", center: [37.75, 55.79], radiusM: 2000 },
    "the site keeps a coarse centre, never the typed point",
  );
  const stored = await db.query(
    "SELECT passport->'area' AS area, visibility FROM ride_intents WHERE id=$1",
    [precise.body.id],
  );
  assert.deepEqual(stored.rows[0].area.center, [37.75, 55.79]);
  assert.equal(stored.rows[0].visibility, "private");
  assert.ok(
    !JSON.stringify(stored.rows[0].area).includes("37.7512"),
    "the precise coordinates are not stored",
  );
  const noMap = await mapper.token(collection, {
    method: "POST",
    body: areaOf({ label: "Сокольники" }),
    headers: key(),
  });
  assert.equal(noMap.status, 201, noMap.text);
  assert.deepEqual(
    noMap.body.passport.area,
    { label: "Сокольники" },
    "a label alone is an area without a map",
  );
  for (const [label, area] of [
    ["a centre without a radius", { label: "Парк", center: [37.1, 55.7] }],
    ["a radius without a centre", { label: "Парк", radiusM: 3000 }],
    [
      "a radius under 1 km",
      { label: "Парк", center: [37.1, 55.7], radiusM: 500 },
    ],
    [
      "a radius over 100 km",
      { label: "Парк", center: [37.1, 55.7], radiusM: 200000 },
    ],
    [
      "a centre off the globe",
      { label: "Парк", center: [237, 55.7], radiusM: 3000 },
    ],
    ["no label", { center: [37.1, 55.7], radiusM: 3000 }],
    ["an empty label", { label: "  ", center: [37.1, 55.7], radiusM: 3000 }],
    [
      "an unknown field",
      { label: "Парк", center: [37.1, 55.7], radiusM: 3000, address: "дом 1" },
    ],
  ]) {
    assertError(
      await mapper.token(collection, {
        method: "POST",
        body: areaOf(area),
        headers: key(),
      }),
      400,
      "invalid_request",
      label,
    );
  }
  const replacedArea = await mapper.token(`${collection}/${precise.body.id}`, {
    method: "PUT",
    body: areaOf({
      label: "Парк Горького",
      center: [37.6, 55.73],
      radiusM: 1000,
    }),
  });
  assert.equal(replacedArea.status, 200, replacedArea.text);
  assert.deepEqual(
    replacedArea.body.passport.area,
    { label: "Парк Горького", center: [37.6, 55.73], radiusM: 1000 },
    "label, centre and radius change together",
  );
  const labelOnly = await mapper.token(`${collection}/${precise.body.id}`, {
    method: "PUT",
    body: areaOf({ label: "Коломенское" }),
  });
  assert.equal(labelOnly.status, 200, labelOnly.text);
  assert.deepEqual(
    labelOnly.body.passport.area,
    { label: "Коломенское" },
    "an old circle does not stay under a new name",
  );
  const reread = await mapper.token(`${collection}/${precise.body.id}`);
  assert.deepEqual(reread.body.passport.area, { label: "Коломенское" });
  // An omitted visibility is the engine's private default, never a publication.
  const unsaid = areaOf({ label: "Крылатские холмы" });
  delete unsaid.visibility;
  const quiet = await mapper.token(collection, {
    method: "POST",
    body: unsaid,
    headers: key(),
  });
  assert.equal(quiet.status, 201, quiet.text);
  assert.equal(quiet.body.visibility, "private");
  assertError(
    await reader.token(`${collection}/${quiet.body.id}`),
    404,
    "not_found",
    "an intention without a visibility is not shown to others",
  );

  // Cancel, delete.
  assertError(
    await reader.token(`${collection}/${intent}/cancel`, { method: "POST" }),
    404,
    "not_found",
    "cancel of someone else's",
  );
  const cancelled = await author.token(`${collection}/${intent}/cancel`, {
    method: "POST",
  });
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.body.status, "cancelled");
  assert.equal(
    (await author.token(`${collection}/${intent}/cancel`, { method: "POST" }))
      .status,
    200,
    "a repeat is the same",
  );
  assertError(
    await reader.token(`${collection}/${intent}`),
    404,
    "not_found",
    "a cancelled intention leaves the community",
  );
  assertError(
    await author.token(`${collection}/${intent}`, {
      method: "PUT",
      body: draft(),
    }),
    409,
    "conflict",
    "a cancelled intention is not edited",
  );
  assert.equal(
    (await author.token("/me/ride-intents")).body.items[0].status,
    "cancelled",
    "the author still sees it",
  );
  assert.equal(
    (await author.token(`${collection}/${intent}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal(
    (await author.token(`${collection}/${intent}`, { method: "DELETE" }))
      .status,
    204,
    "a repeat of the removal",
  );
  assertError(
    await author.token(`${collection}/${intent}`),
    404,
    "not_found",
    "deleted",
  );
  // A retry inside the day gets the stored answer and makes nothing; once the
  // key is forgotten a late retry meets the tombstone and is refused.
  const afterRemoval = await author.token(collection, {
    method: "POST",
    body: draft({ visibility: "community", readiness: "ready" }),
    headers: first,
  });
  assert.equal(afterRemoval.headers.get("idempotency-replayed"), "true");
  assertError(
    await author.token(`${collection}/${intent}`),
    404,
    "not_found",
    "the replay did not bring it back",
  );
  await db.query("DELETE FROM api_idempotency WHERE user_id=$1 AND key=$2", [
    author.id,
    first["Idempotency-Key"],
  ]);
  assertError(
    await author.token(collection, {
      method: "POST",
      body: draft({ visibility: "community", readiness: "ready" }),
      headers: first,
    }),
    409,
    "conflict",
    "a late retry does not revive what was removed",
  );
  assert.equal(
    (await guest(collection, { method: "PATCH", body: {} })).status,
    405,
  );

  // ---- Participation in a planned ride -----------------------------------
  const bike = (
    await host.web("/bikes", "POST", {
      name: "Публичный " + run,
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    })
  ).body.id;
  async function plan(isPublic) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,is_public,started_at,distance_m,point_count,public_point_count,public_geometry,privacy_enabled,privacy_radius_m,source_hash,recurrence,meeting_point,meeting_visibility,plan_passport,import_metrics)
       VALUES($1,$1,$2,$3,$4,'Описание плана','planned','planned',false,$5,date_trunc('minute',now())+interval '3 days',0,0,0,'[]',true,500,$6,'none','Secret gate 7','participants','{"purpose":"social"}','{}')`,
      [
        id,
        host.id,
        bike,
        "План " + (isPublic ? "открытый" : "закрытый") + " " + run,
        isPublic,
        "fixture-" + id,
      ],
    );
    return id;
  }
  const open = await plan(true);
  const closed = await plan(false);
  await db.query(
    "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
    [closed, invitee.id],
  );
  const path = (id) => `/rides/${id}/participation`;

  assertError(await guest(path(open)), 401, "unauthorized", "guest read");
  assertError(
    await stranger.token(path(closed)),
    404,
    "not_found",
    "a closed plan is not found for a stranger",
  );
  assertError(
    await stranger.token(`/rides/${closed}`),
    404,
    "not_found",
    "and the public card still does not open it",
  );
  assertError(
    await stranger.token(path("not-a-uuid")),
    404,
    "not_found",
    "bad id",
  );
  assertError(
    await stranger.token(path(open) + "?occurrenceAt=yesterday"),
    400,
    "invalid_request",
    "a date that is no date",
  );
  assertError(
    await stranger.token(path(open) + "?foo=1"),
    400,
    "invalid_request",
    "unknown parameter",
  );

  const forInvitee = await invitee.token(path(closed));
  assert.equal(forInvitee.status, 200, forInvitee.text);
  rideParticipationSchema.parse(forInvitee.body);
  assert.equal(forInvitee.body.viewer.role, "invitee");
  assert.equal(forInvitee.body.viewer.participation, "invited");
  assert.equal(
    forInvitee.body.meetingPoint,
    null,
    "the place is for participants",
  );
  assert.equal(forInvitee.body.meetingHidden, true);
  assert.equal(forInvitee.headers.get("cache-control"), "no-store");
  const scheduledAt = forInvitee.body.scheduledAt;
  assert.ok(scheduledAt);
  const revision = forInvitee.body.agreement.revision;

  const asked = await invitee.token(
    path(closed) + "?occurrenceAt=" + encodeURIComponent(scheduledAt),
  );
  assert.equal(asked.body.requested.status, "current");
  const moved = await invitee.token(
    path(closed) +
      "?occurrenceAt=" +
      encodeURIComponent(
        new Date(Date.parse(scheduledAt) + 86400000).toISOString(),
      ),
  );
  assert.equal(moved.body.requested.status, "moved");

  // The answer.
  const answer = (who, id, body, options = {}) =>
    who.token(path(id), { method: "PUT", body, ...options });
  assertError(
    await guest(path(open), {
      method: "PUT",
      body: {
        response: "accepted",
        occurrenceAt: scheduledAt,
        expectedAgreementRevision: 1,
      },
    }),
    401,
    "unauthorized",
    "guest answer",
  );
  assertError(
    await invitee.cookie(path(closed), {
      method: "PUT",
      body: {
        response: "accepted",
        occurrenceAt: scheduledAt,
        expectedAgreementRevision: revision,
      },
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "foreign origin",
  );
  assertError(
    await answer(invitee, closed, {
      response: "accepted",
      occurrenceAt: scheduledAt,
    }),
    400,
    "invalid_request",
    "agreeing needs the edition that was seen",
  );
  assertError(
    await answer(invitee, closed, {
      response: "perhaps",
      occurrenceAt: scheduledAt,
    }),
    400,
    "invalid_request",
    "unknown answer",
  );
  assertError(
    await answer(stranger, closed, {
      response: "accepted",
      occurrenceAt: scheduledAt,
      expectedAgreementRevision: revision,
    }),
    404,
    "not_found",
    "a stranger cannot answer a closed plan",
  );
  const organizerAnswer = await answer(host, closed, {
    response: "accepted",
    occurrenceAt: scheduledAt,
    expectedAgreementRevision: revision,
  });
  assert.equal(organizerAnswer.status, 409, "the organizer already takes part");
  rideParticipationConflictSchema.parse(organizerAnswer.body);
  assert.equal(organizerAnswer.body.error.code, "conflict");
  assert.equal(organizerAnswer.body.current.viewer.role, "organizer");

  const going = await answer(invitee, closed, {
    response: "accepted",
    occurrenceAt: scheduledAt,
    expectedAgreementRevision: revision,
  });
  assert.equal(going.status, 200, going.text);
  rideParticipationSchema.parse(going.body);
  assert.equal(going.body.viewer.participation, "accepted");
  assert.equal(going.body.viewer.response, "accepted");
  assert.equal(
    going.body.meetingPoint,
    "Secret gate 7",
    "going shows the place",
  );
  assert.deepEqual(going.body.participants, { going: 1, maybe: 0 });
  assert.equal(
    (
      await answer(invitee, closed, {
        response: "accepted",
        occurrenceAt: scheduledAt,
        expectedAgreementRevision: revision,
      })
    ).status,
    200,
    "a repeat changes nothing",
  );

  // The organizer changes the conditions; the old edition is refused, with the new state.
  await db.query(
    "UPDATE rides SET agreement_revision=agreement_revision+1,agreement_changes='{place}',agreement_changed_at=now() WHERE id=$1",
    [closed],
  );
  const stale = await answer(invitee, closed, {
    response: "accepted",
    occurrenceAt: scheduledAt,
    expectedAgreementRevision: revision,
  });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  rideParticipationConflictSchema.parse(stale.body);
  assert.equal(stale.body.current.agreement.revision, revision + 1);
  assert.deepEqual(stale.body.current.agreement.changes, ["place"]);
  assert.equal(stale.body.current.viewer.participation, "reconfirm");
  assert.equal(stale.body.current.viewer.changedAfterAnswer, true);
  assert.equal(stale.body.current.viewer.previousResponse, "accepted");
  const fresh = await invitee.token(path(closed));
  assert.equal(fresh.body.viewer.participation, "reconfirm");
  assert.equal(
    (
      await db.query(
        "SELECT revision FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
        [closed, invitee.id],
      )
    ).rows[0].revision,
    revision,
    "the refusal did not reconfirm anything",
  );
  const reconfirmed = await answer(invitee, closed, {
    response: "accepted",
    occurrenceAt: scheduledAt,
    expectedAgreementRevision: revision + 1,
  });
  assert.equal(reconfirmed.status, 200, reconfirmed.text);
  assert.equal(reconfirmed.body.viewer.participation, "accepted");
  assert.equal(reconfirmed.body.viewer.changedAfterAnswer, false);

  // A date that moved is refused too.
  const wrongDate = await answer(invitee, closed, {
    response: "maybe",
    occurrenceAt: new Date(Date.parse(scheduledAt) + 86400000).toISOString(),
    expectedAgreementRevision: revision + 1,
  });
  assert.equal(wrongDate.status, 409, wrongDate.text);
  assert.equal(wrongDate.body.current.requested.status, "moved");
  assert.equal(wrongDate.body.current.scheduledAt, scheduledAt);

  // Leaving needs no edition.
  const left = await answer(invitee, closed, {
    response: "declined",
    occurrenceAt: scheduledAt,
  });
  assert.equal(left.status, 200, left.text);
  assert.equal(left.body.viewer.participation, "declined");

  // A public plan, a person without a bike, and the budget.
  const publicRead = await stranger.token(path(open));
  assert.equal(publicRead.status, 200, publicRead.text);
  assert.equal(publicRead.body.viewer.role, "visitor");
  assert.deepEqual(publicRead.body.viewer.allowedResponses, [
    "accepted",
    "maybe",
    "declined",
  ]);
  const byStranger = await answer(stranger, open, {
    response: "maybe",
    occurrenceAt: publicRead.body.scheduledAt,
    expectedAgreementRevision: publicRead.body.agreement.revision,
  });
  assert.equal(byStranger.status, 200, "no bike is needed to answer");
  assert.deepEqual(byStranger.body.participants, { going: 0, maybe: 1 });
  assert.ok(
    !JSON.stringify(byStranger.body).includes(invitee.id),
    "the answer names no other participant",
  );
  assert.equal(
    (await guest(path(open), { method: "PATCH", body: {} })).status,
    405,
  );

  let limited = null;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await answer(stranger, open, {
      response: "declined",
      occurrenceAt: publicRead.body.scheduledAt,
    });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, "the budget of answers is the site's");
  assertError(limited, 429, "rate_limited", "budget");
  assert.ok(limited.headers.get("retry-after"));

  console.log("API v1 planning HTTP checks passed");
} finally {
  // The database is shared with the tests that follow: this test's plans and
  // intentions would be counted in their matches, so its people go with them.
  await db
    .query("DELETE FROM users WHERE email LIKE $1", [
      `planning-%-${run}@example.test`,
    ])
    .catch(() => {});
  await db.end();
}
