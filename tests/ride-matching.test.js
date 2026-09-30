import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  evaluate,
  explain,
  timeFit,
  planDuration,
  groupSlots,
  compareMatches,
  normalizeLabel,
} from "../lib/ride-match-core.ts";
import {
  riderQuery,
  draftQuery,
  planQuery,
  groupsQuery,
  interestInvitationsInput,
  queryObject,
} from "../lib/ride-match-input.ts";
import {
  matchRides,
  planInterest,
  draftInterest,
  planOccurrences,
  interestGroups,
  inviteFromInterest,
} from "../lib/ride-matching.ts";
import { resolveLocal } from "../lib/ride-intent-time.ts";

const H = 3600000;
const at = (/** @type {string} */ iso) => Date.parse(iso);
const park = { label: "Парк", center: [37.6, 55.75], radiusM: 5000 };
const want = (windows, passport = {}, extra = {}) => ({
  windows,
  passport,
  ...extra,
});
const offer = (start, duration, passport = {}) => ({
  start,
  duration,
  passport,
});

test("time feasibility: start and whole duration inside one window, not just the same day", () => {
  const w = [
    { start: at("2030-05-04T08:00Z"), end: at("2030-05-04T10:00Z") },
    { start: at("2030-05-04T14:00Z"), end: at("2030-05-04T18:00Z") },
  ];
  const cases = [
    // [name, start, duration, expected code]
    ["exact", "2030-05-04T14:00Z", { min: 120, max: 120 }, "time_fits"],
    [
      "second window only",
      "2030-05-04T15:00Z",
      { min: 60, max: 180 },
      "time_fits",
    ],
    [
      "may overrun",
      "2030-05-04T16:00Z",
      { min: 60, max: 180 },
      "time_may_overrun",
    ],
    [
      "cannot finish",
      "2030-05-04T09:30Z",
      { min: 60, max: 60 },
      "time_ends_after_window",
    ],
    [
      "same day, between windows",
      "2030-05-04T11:00Z",
      { min: 30, max: 30 },
      "time_outside_window",
    ],
    ["unknown end", "2030-05-04T08:00Z", null, "time_end_unknown"],
    [
      "window end is exclusive",
      "2030-05-04T10:00Z",
      null,
      "time_outside_window",
    ],
  ];
  for (const [name, start, duration, code] of cases)
    assert.equal(timeFit(at(start), duration, w).code, code, name);
  assert.equal(
    timeFit(at("2030-05-04T09:00Z"), null, null).code,
    "time_unspecified",
  );
  assert.deepEqual(
    planDuration({
      start: 0,
      end: 90 * 60000,
      passport: { durationMinutes: { min: 1, max: 999 } },
    }),
    { min: 90, max: 90 },
  );
  assert.equal(planDuration({ start: 0, end: null, passport: {} }), null);
});

test("DST and time zones: windows are instants, a Berlin fold/gap never shifts a fit", () => {
  // 25 Oct 2026, 03:00 CEST → 02:00 CET: local 01:00–04:00 lasts four real hours.
  const start = resolveLocal("2026-10-25T01:00", "Europe/Berlin", "earlier"),
    end = resolveLocal("2026-10-25T04:00", "Europe/Berlin");
  const window = [{ start: at(start), end: at(end) }];
  assert.equal((at(end) - at(start)) / H, 4); // the repeated hour is real time
  // A 4-hour ride fits only because of the extra hour.
  assert.equal(
    timeFit(at(start), { min: 240, max: 240 }, window).code,
    "time_fits",
  );
  // The same local window in Moscow (no DST) is 3 hours: the ride does not fit.
  const msk = [
    {
      start: at(resolveLocal("2026-10-25T01:00", "Europe/Moscow")),
      end: at(resolveLocal("2026-10-25T04:00", "Europe/Moscow")),
    },
  ];
  assert.equal(
    timeFit(msk[0].start, { min: 240, max: 240 }, msk).code,
    "time_ends_after_window",
  );
});

test("soft criteria explain matches, unknowns and conflicts without a compatibility percentage", () => {
  const w = want([{ start: 0, end: 10 * H }], {
    area: park,
    purpose: "social",
    pace: "moderate",
    surface: "gravel",
    durationMinutes: { min: 60, max: 180 },
    distanceKm: { min: 20, max: 40 },
  });
  const exact = evaluate(
    w,
    offer(
      H,
      { min: 120, max: 120 },
      {
        area: { label: "Другой текст", center: [37.62, 55.76], radiusM: 3000 },
        purpose: "social",
        pace: "moderate",
        surface: "gravel",
        distanceKm: { min: 25, max: 30 },
      },
    ),
  );
  assert.equal(exact.eligible, true);
  assert.deepEqual(exact.conflicts, []);
  assert.deepEqual(exact.unknown, []);
  assert.deepEqual(exact.matched.sort(), [
    "area",
    "distance",
    "duration",
    "pace",
    "purpose",
    "surface",
    "time",
  ]);
  const partial = evaluate(
    w,
    offer(H, null, { pace: "sporty", surface: "mixed" }),
  );
  assert.equal(partial.eligible, true);
  assert.deepEqual(partial.unknown.sort(), [
    "area",
    "distance",
    "duration",
    "purpose",
  ]);
  assert.deepEqual(partial.partial.sort(), ["pace", "surface", "time"]);
  const conflict = evaluate(
    w,
    offer(
      H,
      { min: 300, max: 400 },
      {
        pace: "relaxed",
        purpose: "training",
        area: { ...park, center: [30.3, 59.9] },
      },
    ),
  );
  assert.equal(conflict.eligible, true, "soft conflicts never exclude");
  assert.deepEqual(conflict.conflicts.sort(), ["area", "duration", "purpose"]);
  assert.ok(
    compareMatches(
      { evaluation: exact, start: 5, id: "b" },
      { evaluation: partial, start: 1, id: "a" },
    ) < 0,
  );
  assert.ok(
    compareMatches(
      { evaluation: partial, start: 1, id: "a" },
      { evaluation: conflict, start: 1, id: "a" },
    ) < 0,
  );
  const json = JSON.stringify(explain(conflict));
  assert.doesNotMatch(
    json,
    /\d/,
    "codes only: no coordinates, distances or scores",
  );
  assert.equal("score" in explain(conflict), false);
});

test("area: equal labels are never a match; text filter is only partial; coordinates decide", () => {
  const moscow = { label: "Центральный район" },
    spb = { label: "Центральный район" };
  const byLabel = evaluate(
    want(null, { area: moscow }),
    offer(0, null, { area: spb }),
  );
  assert.equal(
    byLabel.reasons.find((r) => r.field === "area").code,
    "area_unknown",
  );
  const text = evaluate(
    want(null, {}, { areaText: "центральный", hard: ["area"] }),
    offer(0, null, { area: spb }),
  );
  assert.equal(
    text.reasons.find((r) => r.field === "area").code,
    "area_label_text",
  );
  assert.equal(text.eligible, true);
  const miss = evaluate(
    want(null, {}, { areaText: "Сокольники", hard: ["area"] }),
    offer(0, null, { area: spb }),
  );
  assert.equal(miss.eligible, false);
  assert.equal(normalizeLabel("  Сокольники, Ёлки! "), "сокольники елки");
});

test("hard filters: conflicts exclude, unknowns stay visible unless strict — never silently relaxed", () => {
  const base = { hard: ["purpose", "pace"] };
  const wish = { purpose: "training", pace: "sporty" };
  assert.equal(
    evaluate(want(null, wish, base), offer(0, null, { purpose: "social" }))
      .eligible,
    false,
  );
  assert.equal(
    evaluate(want(null, wish, base), offer(0, null, { pace: "relaxed" }))
      .eligible,
    false,
  );
  const unknown = evaluate(want(null, wish, base), offer(0, null, {}));
  assert.equal(unknown.eligible, true);
  assert.deepEqual(unknown.unknown.sort(), ["pace", "purpose", "time"]);
  assert.equal(
    evaluate(want(null, wish, { ...base, strict: true }), offer(0, null, {}))
      .eligible,
    false,
  );
  // Adjacent pace is a partial, not a silent match nor an exclusion.
  const near = evaluate(
    want(null, wish, base),
    offer(0, null, { pace: "moderate", purpose: "training" }),
  );
  assert.equal(near.eligible, true);
  assert.deepEqual(near.partial, ["pace"]);
});

test("group slots: a common window for everyone, never a chain of pairwise overlaps", () => {
  const t = at("2030-05-04T08:00Z");
  const w = (
    userId,
    from,
    to,
    readiness = "ready",
    intentId = randomUUID(),
  ) => ({
    userId,
    intentId,
    readiness,
    start: t + from * H,
    end: t + to * H,
  });
  const chain = [w("A", 0, 2), w("B", 1, 3), w("C", 2, 4)];
  const slots = groupSlots(chain, {
    duration: { min: 60, max: 60 },
    from: t,
    to: t + 10 * H,
  });
  assert.ok(slots.length >= 2);
  for (const s of slots) assert.ok(s.users.length <= 2, JSON.stringify(s));
  // Ranked by size, then time: A+B exactly at +1h, B+C exactly at +2h.
  assert.deepEqual(slots[0].users, ["A", "B"]);
  assert.equal(slots[0].startFrom, t + H);
  assert.equal(slots[0].startUntil, t + H);
  assert.deepEqual(slots[1].users, ["B", "C"]);
  // Longer rides shrink the overlap to nothing.
  assert.deepEqual(
    groupSlots(chain, {
      duration: { min: 120, max: 120 },
      from: t,
      to: t + 10 * H,
    }).every((s) => s.users.length === 1),
    true,
  );
  // One person with several intents/windows counts once; ready wins over considering.
  const many = [
    w("A", 0, 4, "considering"),
    w("A", 0, 4, "ready"),
    w("B", 0, 4, "considering"),
    w("C", 1, 5, "considering"),
  ];
  const [best] = groupSlots(many, {
    duration: { min: 60, max: 120 },
    from: t,
    to: t + 10 * H,
  });
  assert.deepEqual(best.users, ["A", "B", "C"]);
  assert.equal(best.ready, 1);
  assert.equal(best.considering, 2);
  assert.equal(best.fitsMaxDuration, 3);
  assert.deepEqual(
    groupSlots([], { duration: { min: 60, max: 60 }, from: t, to: t + H }),
    [],
  );
  // Overlapping windows of someone already counted do not split one group
  // into adjacent copies that would use up the slot limit.
  const repeated = groupSlots(
    [w("A", 0, 4), w("A", 1, 5), w("B", 0, 5), w("C", 10, 12), w("D", 10, 12)],
    { duration: { min: 60, max: 60 }, from: t, to: t + 20 * H },
  );
  assert.deepEqual(
    repeated.map((s) => [s.startFrom, s.startUntil, s.users]),
    [
      [t, t + 4 * H, ["A", "B"]],
      [t + 10 * H, t + 11 * H, ["C", "D"]],
    ],
  );
  // Deterministic regardless of input order.
  assert.deepEqual(
    groupSlots([...many].reverse(), {
      duration: { min: 60, max: 120 },
      from: t,
      to: t + 10 * H,
    }),
    groupSlots(many, {
      duration: { min: 60, max: 120 },
      from: t,
      to: t + 10 * H,
    }),
  );
});

test("query contract rejects ambiguous, partial and duplicate parameters", () => {
  const parse = (schema, text) =>
    schema.safeParse(queryObject(new URLSearchParams(text)));
  assert.equal(parse(riderQuery, "").success, true);
  assert.equal(parse(riderQuery, "pace=sporty&strict=1&page=2").success, true);
  for (const bad of [
    "from=2030-01-01T10:00:00Z",
    "durationMin=60",
    "durationMin=90&durationMax=60",
    "lng=37&lat=55",
    "lng=37&lat=55&radiusKm=500",
    "lng=37&lat=55&radiusKm=5&areaText=Парк",
    "pace=fast",
    "address=Tverskaya",
    "page=51",
    "intent=nope",
  ])
    assert.equal(parse(riderQuery, bad).success, false, bad);
  assert.throws(() =>
    queryObject(new URLSearchParams("pace=relaxed&pace=sporty")),
  );
  assert.equal(
    parse(draftQuery, "from=2030-01-01T10:00:00Z&to=2030-01-02T10:00:00Z")
      .success,
    false,
  );
  assert.equal(
    parse(draftQuery, "durationMin=60&durationMax=90").success,
    true,
  );
  assert.equal(
    parse(
      draftQuery,
      "start=2030-01-01T10:00:00Z&from=2030-01-01T10:00:00Z&to=2030-01-02T10:00:00Z&durationMin=60&durationMax=60",
    ).success,
    false,
  );
  assert.equal(
    parse(planQuery, "occurrenceAt=2030-01-01T10:00:00%2B03:00").success,
    true,
  );
  assert.equal(parse(planQuery, "pace=sporty").success, false);
});

async function migrated() {
  const db = new PGlite();
  for (const file of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
    );
  return db;
}
function fixtures(db) {
  let n = 0;
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
  return {
    async user(blocked = false) {
      const id = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,'Rider','hash',$3,$4)",
        [id, id + "@test.invalid", "match" + n++, blocked],
      );
      return id;
    },
    async bike(owner, isPublic = true) {
      const id = randomUUID();
      await db.query(
        "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Bike',2026,'gravel',$3)",
        [id, owner, isPublic],
      );
      return id;
    },
    async plan(owner, bike, start, o = {}) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO rides(id,owner_id,bike_id,share_id,title,source_hash,status,source_kind,has_track,meeting_point,
          started_at,plan_ends_at,is_public,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,
          recurrence,recurrence_timezone,plan_passport,meeting_visibility)
         VALUES($1::uuid,$2,$3,$1::uuid,$4,'planned:'||$1::text,$5,'planned',false,'Secret gate 7',$6,$7,$8,0,0,0,'[]',500,$9,$10,$11,'participants')`,
        [
          id,
          owner,
          bike,
          o.title || "Plan",
          o.status || "planned",
          iso(start),
          o.end ? iso(o.end) : null,
          o.isPublic ?? true,
          o.recurrence || "none",
          o.zone || "Europe/Moscow",
          JSON.stringify(o.passport || {}),
        ],
      );
      for (const user of o.invite || [])
        await db.query(
          "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
          [id, user],
        );
      return id;
    },
    async intent(owner, windows, o = {}) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO ride_intents(id,owner_id,readiness,time_zone,passport,visibility,allow_suggestions,status,request_hash)
         VALUES($1,$2,$3,'Europe/Moscow',$4,$5,$6,$7,'hash')`,
        [
          id,
          owner,
          o.readiness || "ready",
          JSON.stringify(
            o.passport || { area: { label: "Парк" }, purpose: "social" },
          ),
          o.visibility || "community",
          o.allow ?? true,
          o.status || "active",
        ],
      );
      for (const [start, end] of windows)
        await db.query(
          "INSERT INTO ride_intent_windows(intent_id,starts_at,ends_at) VALUES($1,$2,$3)",
          [id, iso(start), iso(end)],
        );
      return id;
    },
    rsvp: (ride, user, start, response = "accepted") =>
      db.query(
        "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response) VALUES($1,$2,$3,$4)",
        [ride, user, iso(start), response],
      ),
  };
}
const rq = (text = "") =>
  riderQuery.parse(queryObject(new URLSearchParams(text)));
const dq = (text = "") =>
  draftQuery.parse(queryObject(new URLSearchParams(text)));
const pq = (text = "") =>
  planQuery.parse(queryObject(new URLSearchParams(text)));
const gq = (text = "") =>
  groupsQuery.parse(queryObject(new URLSearchParams(text)));
// Two days ahead at 08:00 UTC keeps every fixture in the future and inside 90 days.
const day0 = (() => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2, 8);
})();
const h = (/** @type {number} */ n) => day0 + n * H;

test("rider matching: visibility, blocks, RSVP, invitations, time feasibility and ranking", async () => {
  const db = await migrated();
  try {
    const f = fixtures(db);
    const viewer = await f.user(),
      org = await f.user(),
      blocked = await f.user(true),
      stranger = await f.user();
    const bike = await f.bike(org),
      hiddenBike = await f.bike(org, false),
      blockedBike = await f.bike(blocked),
      ownBike = await f.bike(viewer);
    const wish = {
      area: park,
      purpose: "social",
      pace: "moderate",
      durationMinutes: { min: 60, max: 180 },
    };
    // A private intent is valid input for the owner's own search.
    const mine = await f.intent(viewer, [[h(0), h(5)]], {
      passport: wish,
      visibility: "private",
      allow: false,
    });
    const good = {
      area: { label: "Лес", center: [37.62, 55.76], radiusM: 3000 },
      purpose: "social",
      pace: "moderate",
    };
    const P = {
      exact: await f.plan(org, bike, h(1), { end: h(3), passport: good }),
      overrun: await f.plan(org, bike, h(3), {
        passport: { ...good, durationMinutes: { min: 60, max: 180 } },
      }),
      unknown: await f.plan(org, bike, h(2), {
        passport: { area: { label: "Сокольники" } },
      }),
      far: await f.plan(org, bike, h(1), {
        end: h(2),
        passport: { ...good, area: { ...park, center: [30.3, 59.9] } },
      }),
      invited: await f.plan(org, bike, h(2), {
        end: h(4),
        isPublic: false,
        invite: [viewer],
      }),
      weekly: await f.plan(org, bike, h(1) - 7 * 24 * H, {
        end: h(2) - 7 * 24 * H,
        recurrence: "weekly",
        // Same as "exact" except an unspecified pace: ranks right after it.
        passport: { area: good.area, purpose: "social" },
      }),
      endsLate: await f.plan(org, bike, h(4), { end: h(6) }),
      outside: await f.plan(org, bike, h(6), { end: h(7) }),
      cancelled: await f.plan(org, bike, h(1), { status: "cancelled" }),
      privateNoInvite: await f.plan(org, bike, h(1), { isPublic: false }),
      privateBike: await f.plan(org, hiddenBike, h(1)),
      blockedAuthor: await f.plan(blocked, blockedBike, h(1)),
      own: await f.plan(viewer, ownBike, h(1)),
      accepted: await f.plan(org, bike, h(1), { end: h(2) }),
      declined: await f.plan(org, bike, h(1), { end: h(2) }),
    };
    await f.rsvp(P.accepted, viewer, h(1));
    await f.rsvp(P.declined, viewer, h(1), "declined");
    const result = await matchRides(db, viewer, rq());
    assert.equal(result.basis, "intents");
    const ids = result.items.map((i) => i.ride.id);
    assert.deepEqual(
      new Set(ids),
      new Set([P.exact, P.overrun, P.unknown, P.far, P.invited, P.weekly]),
    );
    assert.equal(result.total, 6);
    assert.equal(ids[0], P.exact, "best explained match first");
    assert.equal(ids[1], P.weekly);
    assert.ok(
      ids.indexOf(P.far) > ids.indexOf(P.weekly),
      "area conflict ranks lower",
    );
    const byId = Object.fromEntries(result.items.map((i) => [i.ride.id, i]));
    assert.equal(byId[P.exact].match.reasons[0].code, "time_fits");
    assert.equal(byId[P.overrun].match.reasons[0].code, "time_may_overrun");
    assert.equal(byId[P.unknown].match.reasons[0].code, "time_end_unknown");
    assert.ok(byId[P.unknown].match.unknown.includes("area"));
    assert.ok(byId[P.far].match.conflicts.includes("area"));
    assert.equal(byId[P.invited].invited, true);
    assert.equal(byId[P.weekly].occurrenceAt, new Date(h(1)).toISOString());
    assert.equal(byId[P.weekly].isNextOccurrence, true);
    assert.equal(byId[P.weekly].expectedEndAt, new Date(h(2)).toISOString());
    assert.equal(byId[P.exact].intentId, mine);
    const text = JSON.stringify(result);
    assert.doesNotMatch(text, /Secret gate|@test\.invalid|password/);
    // The private invitation does not open the plan to anyone else.
    const other = await matchRides(
      db,
      stranger,
      rq(
        "from=" +
          encodeURIComponent(new Date(h(0)).toISOString()) +
          "&to=" +
          encodeURIComponent(new Date(h(5)).toISOString()),
      ),
    );
    assert.equal(other.basis, "filters");
    assert.equal(
      other.items.some((i) => i.ride.id === P.invited),
      false,
    );
    assert.equal(
      other.items.some((i) => i.ride.id === P.accepted),
      true,
    );
    // Explicit filters are hard; strict also drops unknowns; nothing is relaxed silently.
    const training = await matchRides(db, viewer, rq("purpose=training"));
    assert.deepEqual(
      new Set(training.items.map((i) => i.ride.id)),
      new Set([P.unknown, P.invited]),
    );
    assert.equal(
      (await matchRides(db, viewer, rq("purpose=training&strict=1"))).total,
      0,
    );
    // Text filter: labelled "Сокольники" is a partial match; a plan without
    // any area stays as explicitly unknown, and strict removes it.
    const byText = await matchRides(db, viewer, rq("areaText=сокольники"));
    assert.deepEqual(
      byText.items.map((i) => i.ride.id),
      [P.unknown, P.invited],
    );
    assert.deepEqual(
      byText.items.map(
        (i) => i.match.reasons.find((r) => r.field === "area").code,
      ),
      ["area_label_text", "area_unknown"],
    );
    assert.deepEqual(
      (
        await matchRides(db, viewer, rq("areaText=сокольники&strict=1"))
      ).items.map((i) => i.ride.id),
      [P.unknown],
    );
    // Someone else's intent is not an input.
    const foreign = await f.intent(stranger, [[h(0), h(5)]]);
    await assert.rejects(matchRides(db, viewer, rq("intent=" + foreign)), {
      status: 404,
    });
    assert.equal(
      (await matchRides(db, viewer, rq("intent=" + mine))).basis,
      "intent",
    );
    // Blocked viewers get nothing.
    await assert.rejects(matchRides(db, blocked, rq()), { status: 401 });
    // Nothing to match on at all: an empty answer, not every public plan.
    const newcomer = await f.user();
    const none = await matchRides(db, newcomer, rq());
    assert.deepEqual([none.basis, none.items, none.total], ["none", [], 0]);
    // No intents: saved preferences only rank, time stays unspecified.
    await db.query(
      "INSERT INTO ride_intent_preferences(owner_id,value) VALUES($1,$2)",
      [stranger, JSON.stringify({ passport: { pace: "moderate" } })],
    );
    await db.query(
      "UPDATE ride_intents SET status='cancelled' WHERE owner_id=$1",
      [stranger],
    );
    const prefs = await matchRides(db, stranger, rq());
    assert.equal(prefs.basis, "preferences");
    assert.ok(prefs.items.every((i) => i.match.unknown.includes("time")));
    assert.equal(prefs.items[0].match.matched.includes("pace"), true);
    // Zero results are an honest empty page.
    const empty = await matchRides(
      db,
      viewer,
      rq("pace=sporty&strict=true&purpose=adventure"),
    );
    assert.deepEqual([empty.items, empty.total, empty.pages], [[], 0, 1]);
  } finally {
    await db.close();
  }
});

test("organizer interest: unique people, private/blocked/withdrawn excluded, names only with consent", async () => {
  const db = await migrated();
  try {
    const f = fixtures(db);
    const org = await f.user(),
      bike = await f.bike(org);
    const plan = await f.plan(org, bike, h(1), {
      end: h(3),
      passport: { purpose: "social", area: park },
    });
    const [u1, u2, u3, u4, u5, u6, u7, u8] = await Promise.all(
      Array.from({ length: 8 }, (_, i) => f.user(i === 6)),
    );
    const i1 = await f.intent(u1, [[h(0), h(4)]]);
    await f.intent(u2, [[h(0), h(4)]], {
      readiness: "considering",
      allow: false,
    });
    await f.intent(u3, [[h(0), h(4)]], { visibility: "private", allow: true });
    await f.intent(u4, [[h(0), h(4)]], { status: "cancelled" });
    await f.intent(u5, [[h(2), h(6)]]); // starts after the ride starts
    await f.intent(u6, [[h(0), h(4)]], { readiness: "considering" });
    await f.intent(u6, [[h(-1), h(5)]], { readiness: "ready" });
    await f.intent(u7, [[h(0), h(4)]]); // blocked owner
    await f.intent(u8, [[h(0), h(4)]]);
    await f.intent(org, [[h(0), h(4)]]); // organizer is not their own audience
    await f.rsvp(plan, u8, h(1)); // already coming: not "interest"
    await db.query(
      "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
      [plan, u6],
    );
    const first = await planInterest(db, org, plan, pq());
    assert.equal(first.occurrenceAt, new Date(h(1)).toISOString());
    assert.deepEqual(
      {
        total: first.counts.total,
        ready: first.counts.ready,
        considering: first.counts.considering,
      },
      { total: 3, ready: 2, considering: 1 },
    );
    assert.equal(first.counts.timeConfirmed, 3);
    assert.deepEqual(
      new Set(first.people.items.map((p) => p.author.id)),
      new Set([u1, u6]),
    );
    const six = first.people.items.find((p) => p.author.id === u6);
    assert.equal(six.readiness, "ready");
    assert.equal(six.invited, true);
    assert.doesNotMatch(
      JSON.stringify(first),
      /@test\.invalid|allowSuggestions/,
    );
    // Access changes apply on the next read: nothing is cached across them.
    await db.query("UPDATE ride_intents SET visibility='private' WHERE id=$1", [
      i1,
    ]);
    const second = await planInterest(db, org, plan, pq());
    assert.equal(second.counts.total, 2);
    assert.equal(
      second.people.items.some((p) => p.author.id === u1),
      false,
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [u6]);
    assert.equal((await planInterest(db, org, plan, pq())).counts.total, 1);
    // Only the organizer, only live plans and only real occurrences.
    await assert.rejects(planInterest(db, u1, plan, pq()), { status: 404 });
    await assert.rejects(
      planInterest(
        db,
        org,
        plan,
        pq("occurrenceAt=" + encodeURIComponent(new Date(h(2)).toISOString())),
      ),
      { status: 409 },
    );
    await db.query("UPDATE rides SET status='cancelled' WHERE id=$1", [plan]);
    await assert.rejects(planInterest(db, org, plan, pq()), { status: 404 });
  } finally {
    await db.close();
  }
});

test("organizer draft: one start or common slots; A↔B and B↔C never make A+B+C", async () => {
  const db = await migrated();
  try {
    const f = fixtures(db);
    const org = await f.user(),
      [a, b, c] = await Promise.all([f.user(), f.user(), f.user()]);
    await f.intent(a, [[h(0), h(2)]]);
    await f.intent(b, [[h(1), h(3)]], { readiness: "considering" });
    await f.intent(c, [[h(2), h(4)]], { allow: false });
    const period = `from=${encodeURIComponent(new Date(h(-1)).toISOString())}&to=${encodeURIComponent(new Date(h(6)).toISOString())}`;
    const slots = await draftInterest(
      db,
      org,
      dq(period + "&durationMin=60&durationMax=60"),
    );
    assert.equal(slots.mode, "slots");
    assert.ok(slots.slots.every((s) => s.counts.total <= 2));
    assert.equal(slots.slots[0].counts.total, 2);
    assert.equal(slots.slots[0].startFrom, new Date(h(1)).toISOString());
    const bc = slots.slots.find(
      (s) => s.startFrom === new Date(h(2)).toISOString(),
    );
    assert.equal(bc.counts.total, 2);
    assert.deepEqual(
      bc.people.map((p) => p.author.id),
      [b],
      "c counted, not named",
    );
    const long = await draftInterest(
      db,
      org,
      dq(period + "&durationMin=150&durationMax=150"),
    );
    assert.deepEqual(long.slots, []);
    const one = await draftInterest(
      db,
      org,
      dq(
        "start=" +
          encodeURIComponent(new Date(h(1.5)).toISOString()) +
          "&durationMin=30&durationMax=60",
      ),
    );
    assert.equal(one.mode, "occurrence");
    assert.equal(one.counts.total, 2);
    await assert.rejects(
      draftInterest(db, org, dq("start=2000-01-01T00:00:00Z")),
      { status: 400 },
    );
    // More consenting people than 50 pages: reported pages stay requestable.
    await db.exec(`
INSERT INTO users(id,email,name,password_hash,username)
 SELECT md5('crowd'||g)::uuid,'crowd'||g||'@test.invalid','U','h','crowd'||g FROM generate_series(1,1010) g;
INSERT INTO ride_intents(id,owner_id,readiness,time_zone,passport,visibility,allow_suggestions,status,request_hash)
 SELECT md5('crowd-i'||g)::uuid,md5('crowd'||g)::uuid,'ready','Europe/Moscow','{}','community',true,'active','h'
 FROM generate_series(1,1010) g;
INSERT INTO ride_intent_windows(intent_id,starts_at,ends_at)
 SELECT md5('crowd-i'||g)::uuid,'${new Date(h(0)).toISOString()}','${new Date(h(4)).toISOString()}'
 FROM generate_series(1,1010) g;`);
    const start = encodeURIComponent(new Date(h(1.5)).toISOString());
    const crowd = await draftInterest(db, org, dq(`start=${start}&page=50`));
    assert.equal(crowd.people.total, 1012); // 1010 + a and b above
    assert.equal(crowd.people.pages, 50);
    assert.equal(crowd.people.items.length, 20);
  } finally {
    await db.close();
  }
});

test("organizer workspace (#234): consenting, fitting people only; counts without names", async () => {
  const db = await migrated();
  try {
    const f = fixtures(db);
    const org = await f.user();
    const [a, b, c, d, e, g, blocked] = await Promise.all(
      Array.from({ length: 7 }, (_, i) => f.user(i === 6)),
    );
    const social = { area: { label: "Парк Сокольники" }, purpose: "social" };
    await f.intent(a, [[h(0), h(4)]], { passport: social });
    // Two intents of one person count once.
    await f.intent(b, [[h(0), h(3)]], {
      readiness: "considering",
      passport: social,
    });
    await f.intent(b, [[h(1), h(5)]], { passport: social });
    await f.intent(c, [[h(0), h(4)]], { passport: social, allow: false });
    await f.intent(d, [[h(0), h(4)]], {
      passport: social,
      visibility: "private",
    });
    await f.intent(e, [[h(0), h(4)]], {
      passport: { area: { label: "Парк Сокольники" }, purpose: "training" },
    });
    await f.intent(g, [[h(0), h(4)]], {
      passport: { area: { label: "Измайлово" }, purpose: "social" },
    });
    await f.intent(blocked, [[h(0), h(4)]], { passport: social });
    await f.intent(org, [[h(0), h(4)]], { passport: social });
    const period = `from=${encodeURIComponent(new Date(h(-1)).toISOString())}&to=${encodeURIComponent(new Date(h(6)).toISOString())}`;
    const all = await interestGroups(
      db,
      org,
      gq(period + "&durationMin=60&durationMax=120"),
    );
    // a, b (once), e and g; c has not allowed suggestions, d is private.
    assert.equal(all.groups[0].counts.total, 4);
    assert.doesNotMatch(
      JSON.stringify(all),
      /author|username|intentId|@test\.invalid|Сокольники|Измайлово/,
    );
    const social60 = await interestGroups(
      db,
      org,
      gq(period + "&durationMin=60&durationMax=120&purpose=social"),
    );
    assert.equal(social60.groups[0].counts.total, 3);
    assert.deepEqual(social60.groups[0].formats.purpose, { social: 3 });
    const park = await interestGroups(
      db,
      org,
      gq(
        period +
          "&durationMin=60&durationMax=120&purpose=social&areaText=" +
          encodeURIComponent("сокольники"),
      ),
    );
    const best = park.groups.reduce((x, y) =>
      y.counts.total > x.counts.total ? y : x,
    );
    // a and b; e wants training, g rides elsewhere.
    assert.equal(best.counts.total, 2);
    // No common time for everyone: never a ready-made company.
    const long = await interestGroups(
      db,
      org,
      gq(period + "&durationMin=300&durationMax=300"),
    );
    assert.deepEqual(long.groups, []);
    assert.equal(
      groupsQuery.safeParse(queryObject(new URLSearchParams(period))).success,
      false,
      "duration is required",
    );
  } finally {
    await db.close();
  }
});

test("invitations from interest (#234): re-checked on the server, refusals kept, capped and idempotent", async () => {
  const db = await migrated();
  try {
    const f = fixtures(db);
    const org = await f.user(),
      bike = await f.bike(org);
    const plan = await f.plan(org, bike, h(1), {
      end: h(3),
      passport: { purpose: "social" },
    });
    const [a, b, c, d, e, stranger, trainer] = await Promise.all(
      Array.from({ length: 7 }, () => f.user()),
    );
    const ia = await f.intent(a, [[h(0), h(4)]]);
    const ib = await f.intent(b, [[h(0), h(4)]]);
    await f.intent(c, [[h(0), h(4)]], { allow: false });
    await f.intent(d, [[h(0), h(4)]]);
    await f.intent(e, [[h(0), h(4)]]);
    await f.rsvp(plan, d, h(1), "declined");
    // Time fits, but the intent explicitly wants training, not a social ride.
    await f.intent(trainer, [[h(0), h(4)]], {
      passport: { area: { label: "Парк" }, purpose: "training" },
    });
    const input = (/** @type {string[]} */ userIds) =>
      interestInvitationsInput.parse({
        occurrenceAt: new Date(h(1)).toISOString(),
        userIds,
      });
    const view = await planInterest(db, org, plan, pq());
    assert.equal(
      view.people.items.find((p) => p.author.id === d).declined,
      true,
    );
    assert.equal(
      view.people.items.some((p) => p.author.id === trainer),
      false,
      "an explicit format conflict is not a candidate",
    );
    // Between the view and the send: a withdraws, b's window moves away.
    await db.query("UPDATE ride_intents SET status='cancelled' WHERE id=$1", [
      ia,
    ]);
    await db.query(
      "UPDATE ride_intent_windows SET starts_at=$2 WHERE intent_id=$1",
      [ib, new Date(h(2)).toISOString()],
    );
    const sent = await inviteFromInterest(
      db,
      org,
      plan,
      input([a, b, c, d, e, stranger, e, trainer]),
    );
    assert.deepEqual(
      Object.fromEntries(sent.results.map((r) => [r.userId, r.status])),
      {
        [a]: "unavailable",
        [b]: "unavailable",
        [c]: "unavailable",
        [d]: "declined",
        [e]: "invited",
        [stranger]: "unavailable",
        [trainer]: "unavailable",
      },
    );
    assert.equal(sent.invited, 1);
    const rows = (
      await db.query(
        "SELECT user_id,source FROM ride_invitations WHERE ride_id=$1",
        [plan],
      )
    ).rows;
    assert.deepEqual(rows, [{ user_id: e, source: "interest" }]);
    const notes = (
      await db.query(
        "SELECT recipient_id FROM notifications WHERE type='ride_invite' AND ride_id=$1",
        [plan],
      )
    ).rows;
    assert.deepEqual(notes, [{ recipient_id: e }]);
    // A repeat (double click) changes nothing and notifies nobody again.
    const again = await inviteFromInterest(db, org, plan, input([e]));
    assert.deepEqual(again.results, [{ userId: e, status: "already_invited" }]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='ride_invite' AND ride_id=$1",
          [plan],
        )
      ).rows[0].n,
      1,
    );
    // The per-ride cap of the plan form holds here too.
    const crowd = [];
    for (let i = 0; i < 40; i++) {
      const id = await f.user();
      await f.intent(id, [[h(0), h(4)]]);
      crowd.push(id);
    }
    const first = await inviteFromInterest(
      db,
      org,
      plan,
      input(crowd.slice(0, 20)),
    );
    assert.equal(first.invited, 20);
    const second = await inviteFromInterest(
      db,
      org,
      plan,
      input(crowd.slice(20, 40)),
    );
    assert.equal(second.invited, 9); // 1 + 20 + 9 = 30
    assert.equal(second.results.filter((r) => r.status === "limit").length, 11);
    // Only the owner of a live plan, only a real occurrence.
    await assert.rejects(inviteFromInterest(db, a, plan, input([b])), {
      status: 404,
    });
    await assert.rejects(
      inviteFromInterest(
        db,
        org,
        plan,
        interestInvitationsInput.parse({
          occurrenceAt: new Date(h(2)).toISOString(),
          userIds: [b],
        }),
      ),
      { status: 409 },
    );
    assert.equal(
      interestInvitationsInput.safeParse({
        occurrenceAt: new Date(h(1)).toISOString(),
        userIds: crowd.slice(0, 21),
      }).success,
      false,
      "batch limit",
    );
  } finally {
    await db.close();
  }
});

test("weekly occurrences in SQL keep local time across DST, like RSVP occurrences", async () => {
  const db = await migrated();
  try {
    // Fixed dates: this checks only the SQL expansion, not the "future" filter.
    const r = await db.query(
      `SELECT o.occurs_at FROM (VALUES ('2026-10-17T08:00:00Z'::timestamptz,'Europe/Berlin','weekly')) r(started_at,recurrence_timezone,recurrence)
       ${planOccurrences.replaceAll("$2::timestamptz", "'2026-10-20T00:00:00Z'::timestamptz").replaceAll("$3::timestamptz", "'2026-11-05T00:00:00Z'::timestamptz")}
       ORDER BY 1`,
    );
    const times = r.rows.map((x) => new Date(x.occurs_at).toISOString());
    // 10:00 CEST (08:00Z) stays 10:00 local after the switch to CET (09:00Z).
    assert.ok(times.includes("2026-10-24T08:00:00.000Z"));
    assert.ok(times.includes("2026-10-31T09:00:00.000Z"));
    assert.ok(times.every((t) => t >= "2026-10-17"));
  } finally {
    await db.close();
  }
});

test("performance budget: constant query count, bounded candidates and index scans on a synthetic set", async () => {
  const db = await migrated();
  try {
    // 10k users, 5k rides (plans, weekly series, cancelled, completed, private),
    // 4k intents × 2 windows. Award triggers are irrelevant to matching reads.
    await db.exec(
      "ALTER TABLE rides DISABLE TRIGGER awards_ride; ALTER TABLE bikes DISABLE TRIGGER awards_bike;",
    );
    await db.exec(`
INSERT INTO users(id,email,name,password_hash,username)
 SELECT md5('u'||g)::uuid,'u'||g||'@test.invalid','U','h','perf'||g FROM generate_series(1,10000) g;
INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public)
 SELECT md5('b'||g)::uuid,md5('u'||g)::uuid,md5('b'||g)::uuid,'B',2026,'gravel',g%5<>0 FROM generate_series(1,3000) g;
INSERT INTO rides(id,owner_id,bike_id,share_id,title,source_hash,status,source_kind,has_track,started_at,plan_ends_at,is_public,
  distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,recurrence,recurrence_timezone,plan_passport)
 SELECT md5('r'||g)::uuid,md5('u'||(g%3000+1))::uuid,md5('b'||(g%3000+1))::uuid,md5('r'||g)::uuid,'P','s'||g,
  CASE WHEN g%10=0 THEN 'cancelled' WHEN g%7=0 THEN 'completed' ELSE 'planned' END,
  CASE WHEN g%7=0 THEN 'gpx' ELSE 'planned' END,false,
  now()+((g%2400)-400)*interval '1 hour',now()+((g%2400)-398)*interval '1 hour',g%4<>0,0,0,0,'[]',500,
  CASE WHEN g%9=0 THEN 'weekly' ELSE 'none' END,'Europe/Moscow',
  jsonb_build_object('purpose',(ARRAY['leisure','social','training'])[g%3+1],'pace',(ARRAY['relaxed','moderate','sporty'])[g%3+1])
 FROM generate_series(1,5000) g;
INSERT INTO ride_intents(id,owner_id,readiness,time_zone,passport,visibility,allow_suggestions,status,request_hash)
 SELECT md5('i'||g)::uuid,md5('u'||(g%10000+1))::uuid,CASE WHEN g%2=0 THEN 'ready' ELSE 'considering' END,'Europe/Moscow',
  jsonb_build_object('purpose','social','area',jsonb_build_object('label','Парк')),
  CASE WHEN g%3=0 THEN 'private' ELSE 'community' END,g%2=0,CASE WHEN g%11=0 THEN 'cancelled' ELSE 'active' END,'h'
 FROM generate_series(1,4000) g;
INSERT INTO ride_intent_windows(intent_id,starts_at,ends_at)
 SELECT md5('i'||g)::uuid,now()+((g*7)%2000)*interval '1 hour'+k*interval '30 hours',now()+((g*7)%2000)*interval '1 hour'+k*interval '30 hours'+interval '5 hours'
 FROM generate_series(1,4000) g,generate_series(0,1) k;`);
    await db.exec(
      "ALTER TABLE rides ENABLE TRIGGER awards_ride; ALTER TABLE bikes ENABLE TRIGGER awards_bike; ANALYZE;",
    );
    /** @type {{sql: string, params: any[]}[]} */
    let log = [];
    const q = {
      query: (sql, params = []) => {
        log.push({ sql, params });
        return db.query(sql, params);
      },
    };
    const id = async (sql) => (await db.query(sql)).rows[0];
    const rider = (await id("SELECT md5('u'||2)::uuid AS id")).id; // has intents
    const guest = (await id("SELECT md5('u'||9999)::uuid AS id")).id;
    const plan = await id(
      "SELECT owner_id,id FROM rides WHERE status='planned' AND recurrence='none' AND started_at>now()+interval '2 days' ORDER BY started_at,id LIMIT 1",
    );
    const cases = [
      ["rider intents", () => matchRides(q, rider, rq()), 4],
      [
        "rider filters",
        () => matchRides(q, guest, rq("pace=sporty&purpose=social")),
        4,
      ],
      [
        "organizer plan",
        () => planInterest(q, plan.owner_id, plan.id, pq()),
        4,
      ],
      [
        "organizer slots",
        () => draftInterest(q, guest, dq("durationMin=60&durationMax=120")),
        2,
      ],
    ];
    const plans = [],
      explains = [];
    for (const [name, run, queries] of cases) {
      log = [];
      const started = performance.now();
      const result = await run();
      const ms = performance.now() - started;
      assert.ok(
        log.length <= queries,
        `${name}: ${log.length} queries, no N+1`,
      );
      assert.ok(
        ms < 2000,
        `${name}: ${Math.round(ms)} ms within the PGlite budget`,
      );
      assert.ok(
        JSON.stringify(result).length < 200000,
        `${name}: bounded response`,
      );
      explains.push(...log);
    }
    // A small table with a wide horizon is legitimately seq-scanned; what must
    // hold is that the predicates can use the partial indexes as data grows.
    await db.exec("SET enable_seqscan = off");
    for (const { sql, params } of explains)
      plans.push(
        (await db.query("EXPLAIN " + sql, params)).rows
          .map((r) => r["QUERY PLAN"])
          .join("\n"),
      );
    await db.exec("RESET enable_seqscan");
    const explained = plans.join("\n");
    for (const index of [
      "rides_planned_once",
      "rides_planned_weekly",
      "ride_intent_windows_start",
    ])
      assert.match(explained, new RegExp(index), `${index} is used`);
  } finally {
    await db.close();
  }
});
