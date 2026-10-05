import test, { after } from "node:test";
import assert from "node:assert/strict";
import { RideConflict } from "../lib/ride-gpx.ts";
import {
  respondRide,
  rideParticipation,
  type RideParticipation,
} from "../lib/rides.ts";
import {
  closeIntent,
  createIntent,
  intentKeysetPage,
  intentVersioned,
  updateIntent,
} from "../lib/ride-intents.ts";
import { stableUuid } from "../lib/stable-uuid.ts";
import { toRideIntent, toRideParticipation } from "../lib/api-v1/mappers.ts";
import {
  rideIntentRequestSchema,
  rideIntentSchema,
  rideParticipationSchema,
} from "../lib/api-v1/schemas.ts";
import { intentInput } from "../lib/ride-intent-input.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { labelledUser } from "./support/people.ts";
import { present } from "./support/assertions.ts";
import {
  intentDraft,
  intentRow,
  invitationRow,
  planRow,
  rsvpRow,
} from "./support/rides.ts";

// Planning together through API v1 (#343): the participation read (who may read
// which plan and date, what it says, what it never says), the answer that
// refuses an old date or old conditions, and the paging, versions and mapping of
// intentions. The HTTP layer is tests/api-v1-planning-http.js.

const db = await testDatabase();
after(() => db.close());

const hour = 3600000;
const inFuture = (hours: number) =>
  new Date(Math.round((Date.now() + hours * hour) / 60000) * 60000);
async function person(label: string, blocked = false) {
  return (await labelledUser(db, label, { blocked })).id;
}

const organizer = await person("organizer");
const guest = await person("guest");
const invitee = await person("invitee");
const outsider = await person("outsider");
const blockedPerson = await person("blocked", true);
const bike = (await bikeRow(db, organizer)).id;
const hiddenBike = (await bikeRow(db, organizer, { is_public: false })).id;

async function plan(
  startsInHours = 48,
  overrides: Parameters<typeof planRow>[4] = {},
) {
  return planRow(db, organizer, bike, inFuture(startsInHours), overrides);
}
async function read(
  ride: string,
  who: string,
  requested: Date | null = null,
): Promise<RideParticipation | null> {
  return rideParticipation(db, ride, who, requested);
}
const shown = async (ride: string, who: string, requested?: Date) =>
  toRideParticipation(
    present(await read(ride, who, requested ?? null), "participation"),
    who,
  );

test("who may read the participation: the organizer, an invitee, a public viewer; nobody else", async () => {
  const open = await plan();
  const closed = await plan(48, { is_public: false });
  const onHiddenBike = await planRow(
    db,
    organizer,
    hiddenBike,
    inFuture(48),
    {},
  );
  await invitationRow(db, closed.id, invitee);
  await invitationRow(db, onHiddenBike.id, invitee);

  for (const who of [organizer, guest, invitee])
    assert.ok(await read(open.id, who), "public plan");
  assert.equal((await read(open.id, organizer))?.access, "organizer");
  assert.equal((await read(open.id, invitee))?.access, "public");
  await invitationRow(db, open.id, invitee);
  assert.equal(
    (await read(open.id, invitee))?.access,
    "invited",
    "an invitation is the closer right",
  );

  assert.ok(await read(closed.id, organizer));
  assert.ok(
    await read(closed.id, invitee),
    "a closed plan opens to its invitee",
  );
  assert.equal(
    await read(closed.id, outsider),
    null,
    "closed plan, no invitation",
  );
  assert.ok(await read(onHiddenBike.id, invitee));
  assert.equal(await read(onHiddenBike.id, outsider), null);

  assert.equal(await read(open.id, blockedPerson), null, "blocked viewer");
  const ofBlocked = await planRow(
    db,
    blockedPerson,
    (await bikeRow(db, blockedPerson)).id,
    inFuture(48),
  );
  assert.equal(await read(ofBlocked.id, guest), null, "blocked organizer");
  assert.equal(
    await read("11111111-1111-4111-8111-111111111111", guest),
    null,
    "missing",
  );
  const finished = await db.query<{ id: string }>(
    "SELECT id FROM rides WHERE source_kind<>'planned' LIMIT 1",
  );
  if (finished.rows[0])
    assert.equal(
      await read(finished.rows[0].id, guest),
      null,
      "a recorded ride is not a plan",
    );
});

test("a plan that was called off is known to the people involved, in minimal form", async () => {
  const called = await plan(48, { status: "cancelled" });
  await invitationRow(db, called.id, invitee);
  await rsvpRow(
    db,
    called.id,
    guest,
    called.started_at ?? inFuture(48),
    "accepted",
  );

  const own = await shown(called.id, organizer);
  assert.equal(own.status, "cancelled");
  assert.equal(own.scheduledAt, null);
  assert.deepEqual(own.viewer.allowedResponses, []);
  const asked = await shown(called.id, invitee, inFuture(48));
  assert.equal(asked.requested?.status, "cancelled");
  assert.equal(asked.title, called.title);
  assert.equal(asked.description, null);
  assert.equal(asked.meetingPoint, null, "no place of a called-off plan");
  assert.equal(asked.passport, null);

  const answered = await read(called.id, guest);
  assert.equal(answered?.access, "answered");
  const minimal = toRideParticipation(present(answered, "answered"), guest);
  assert.equal(minimal.status, "cancelled");
  assert.equal(minimal.description, null);
  assert.equal(minimal.meetingPoint, null);
  assert.equal(
    await read(called.id, outsider),
    null,
    "a stranger does not learn of a called-off plan",
  );
});

test("the requested date: current, moved, cancelled or past", async () => {
  const start = inFuture(72);
  const ride = await plan(72);
  const current = await shown(ride.id, guest, start);
  assert.equal(current.requested?.status, "current");
  assert.equal(current.scheduledAt, start.toISOString());

  assert.equal(
    (await shown(ride.id, guest, inFuture(96))).requested?.status,
    "moved",
  );
  assert.equal(
    (await shown(ride.id, guest, inFuture(-2))).requested?.status,
    "past",
  );
  assert.equal((await shown(ride.id, guest)).requested, null);

  const later = inFuture(24 * 7 + 72);
  await db.query(
    "INSERT INTO ride_cancelled_occurrences(ride_id,occurs_on,occurs_at) VALUES($1,$2::timestamptz::date,$2)",
    [ride.id, later],
  );
  assert.equal(
    (await shown(ride.id, guest, later)).requested?.status,
    "cancelled",
    "a date the organizer called off",
  );

  const passed = await plan(-5);
  const state = await shown(passed.id, guest);
  assert.equal(
    state.scheduledAt,
    null,
    "nothing to answer for a date that passed",
  );
  assert.deepEqual(state.viewer.allowedResponses, []);
});

test("the answer, the conditions and what the person is offered", async () => {
  const start = inFuture(60);
  const ride = await plan(60);
  const before = await shown(ride.id, guest);
  assert.equal(before.viewer.participation, "none");
  assert.deepEqual(before.viewer.allowedResponses, [
    "accepted",
    "maybe",
    "declined",
  ]);
  assert.equal(before.viewer.role, "visitor");
  assert.equal(before.agreement.revision, 1);
  assert.deepEqual(before.participants, { going: 0, maybe: 0 });
  assert.equal(before.meetingPoint, null, "a place for participants only");
  assert.equal(before.meetingHidden, true);

  await respondRide(
    db,
    ride.id,
    guest,
    "accepted",
    start.toISOString(),
    false,
    1,
  );
  const going = await shown(ride.id, guest, start);
  assert.equal(going.viewer.participation, "accepted");
  assert.equal(going.viewer.response, "accepted");
  assert.equal(
    going.meetingPoint,
    "Secret gate 7",
    "an accepted answer sees the place",
  );
  assert.deepEqual(going.participants, { going: 1, maybe: 0 });
  assert.equal(going.viewer.changedAfterAnswer, false);

  // The organizer changes the conditions: a new edition, the answer is old.
  await db.query(
    "UPDATE rides SET agreement_revision=2,agreement_changes='{place,start}',agreement_changed_at=now() WHERE id=$1",
    [ride.id],
  );
  const stale = await shown(ride.id, guest, start);
  assert.equal(stale.viewer.participation, "reconfirm");
  assert.equal(
    stale.viewer.response,
    null,
    "an old answer is not an agreement",
  );
  assert.equal(stale.viewer.previousResponse, "accepted");
  assert.equal(stale.viewer.changedAfterAnswer, true);
  assert.deepEqual(stale.agreement.changes, ["place", "start"]);
  assert.ok(stale.agreement.changedAt);
  assert.equal(stale.agreement.revision, 2);
  assert.deepEqual(stale.viewer.allowedResponses, [
    "accepted",
    "maybe",
    "declined",
  ]);
});

test("an answer to old conditions or an old date is refused, leaving is not", async () => {
  const start = inFuture(80);
  const ride = await plan(80);
  await db.query("UPDATE rides SET agreement_revision=3 WHERE id=$1", [
    ride.id,
  ]);

  await assert.rejects(
    () =>
      respondRide(
        db,
        ride.id,
        guest,
        "accepted",
        start.toISOString(),
        false,
        2,
      ),
    (error: unknown) =>
      error instanceof RideConflict &&
      error.reason === "revision" &&
      error.status === 409,
  );
  await assert.rejects(
    () =>
      respondRide(db, ride.id, guest, "maybe", start.toISOString(), false, 1),
    RideConflict,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM ride_rsvps WHERE ride_id=$1", [ride.id]))
      .rowCount,
    0,
    "nothing was taken",
  );
  await assert.rejects(
    () =>
      respondRide(
        db,
        ride.id,
        guest,
        "accepted",
        inFuture(100).toISOString(),
        false,
        3,
      ),
    (error: unknown) =>
      error instanceof RideConflict && error.reason === "occurrence",
  );

  const declined = await respondRide(
    db,
    ride.id,
    guest,
    "declined",
    start.toISOString(),
    false,
    1,
  );
  assert.equal(
    declined.response,
    "declined",
    "leaving needs no current edition",
  );
  const done = await respondRide(
    db,
    ride.id,
    invitee,
    "accepted",
    start.toISOString(),
    false,
    3,
  );
  assert.equal(done.response, "accepted");
  const stored = await db.query<{ revision: number }>(
    "SELECT revision FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
    [ride.id, invitee],
  );
  assert.equal(
    stored.rows[0].revision,
    3,
    "the answer is to the current edition",
  );

  // The legacy callers do not pass a revision and keep working.
  const legacy = await respondRide(
    db,
    ride.id,
    outsider,
    "maybe",
    start.toISOString(),
  );
  assert.equal(legacy.response, "maybe");
});

test("recruitment closed: an outsider has nothing to answer, an invitee has", async () => {
  const start = inFuture(90);
  const ride = await plan(90, { recruitment_closed_for: start });
  await invitationRow(db, ride.id, invitee);
  const outside = await shown(ride.id, guest, start);
  assert.equal(outside.recruitmentClosed, true);
  assert.deepEqual(outside.viewer.allowedResponses, []);
  const invited = await shown(ride.id, invitee, start);
  assert.equal(invited.viewer.participation, "invited");
  assert.equal(invited.viewer.role, "invitee");
  assert.deepEqual(invited.viewer.allowedResponses, [
    "accepted",
    "maybe",
    "declined",
  ]);
  assert.deepEqual(
    (await shown(ride.id, organizer)).viewer.allowedResponses,
    [],
    "the organizer takes part by organising",
  );
});

test("the participation names nobody and carries nothing outside its schema", async () => {
  const start = inFuture(100);
  const ride = await plan(100);
  await rsvpRow(db, ride.id, invitee, start, "accepted");
  await rsvpRow(db, ride.id, outsider, start, "maybe");
  for (const who of [organizer, guest, invitee, outsider]) {
    const body = await shown(ride.id, who, start);
    assert.deepEqual(rideParticipationSchema.parse(body), body);
    const text = JSON.stringify(body);
    for (const other of [invitee, outsider, guest])
      if (other !== who)
        assert.ok(!text.includes(other), "another person's id appeared");
    assert.ok(!text.includes("test.invalid"), "an address appeared");
    assert.deepEqual(body.participants, { going: 1, maybe: 1 });
  }
  const mine = await shown(ride.id, invitee, start);
  assert.equal(mine.meetingPoint, "Secret gate 7");
});

test("intentions: pages of the own list and of the community, newest first", async () => {
  const owner = await person("intents-owner");
  const reader = await person("intents-reader");
  const stranger = await person("intents-stranger");
  const soon = inFuture(5);
  const later = inFuture(9);
  const makeIntent = (
    who: string,
    created: string,
    overrides: Parameters<typeof intentRow>[3] = {},
  ) =>
    intentRow(db, who, [[soon, later]], {
      created_at: new Date(created),
      ...overrides,
    });
  const a = await makeIntent(owner, "2026-10-01T10:00:00.000Z");
  const b = await makeIntent(owner, "2026-10-02T10:00:00.000Z", {
    visibility: "private",
  });
  const c = await makeIntent(owner, "2026-10-03T10:00:00.000Z");
  const cancelled = await makeIntent(owner, "2026-10-04T10:00:00.000Z", {
    status: "cancelled",
  });
  const deleted = await makeIntent(owner, "2026-10-05T10:00:00.000Z", {
    status: "deleted",
  });
  const ended = await intentRow(db, owner, [[inFuture(-9), inFuture(-5)]], {
    created_at: new Date("2026-10-06T10:00:00.000Z"),
  });
  const foreign = await makeIntent(stranger, "2026-10-07T10:00:00.000Z", {
    visibility: "private",
  });

  const own: string[] = [];
  let after = null;
  for (let guard = 0; guard < 5; guard++) {
    const page = await intentKeysetPage(db, owner, {
      own: true,
      limit: 2,
      after,
    });
    own.push(...page.items.map((item) => item.id));
    if (!page.next) break;
    after = page.next;
  }
  assert.deepEqual(own, [ended.id, cancelled.id, c.id, b.id, a.id]);
  assert.ok(!own.includes(deleted.id), "deleted is gone");
  assert.ok(!own.includes(foreign.id), "someone else's private");

  const community = await intentKeysetPage(db, reader, {
    own: false,
    limit: 10,
    after: null,
  });
  const ids = community.items.map((item) => item.id);
  assert.ok(ids.includes(a.id) && ids.includes(c.id));
  for (const hidden of [b, cancelled, deleted, ended, foreign])
    assert.ok(!ids.includes(hidden.id), "not for the community: " + hidden.id);
  const seen = community.items.find((item) => item.id === a.id);
  assert.equal(seen?.own, false);
  assert.ok(
    !("allowSuggestions" in (seen ?? {})),
    "a private choice of the author",
  );
  const mine = (
    await intentKeysetPage(db, owner, { own: true, limit: 10, after: null })
  ).items.find((item) => item.id === a.id);
  assert.equal(mine?.own, true);
  assert.equal(mine?.allowSuggestions, false);

  await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner]);
  const hiddenAuthor = await intentKeysetPage(db, reader, {
    own: false,
    limit: 50,
    after: null,
  });
  assert.ok(
    !hiddenAuthor.items.some((item) => item.id === a.id),
    "a blocked author is not shown",
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [owner]);
});

test("an intention has a version that changes with every edit, checked under the lock", async () => {
  const owner = await person("versions");
  const id = stableUuid("ride-intent:versions");
  const draft = intentDraft({ visibility: "private" });
  const first = await createIntent(db, owner, { ...draft, requestId: id });
  assert.equal(first.created, true);
  const v1 = (await intentVersioned(db, owner, id)).version;
  assert.match(v1, /^\d{4}-\d{2}-\d{2} /, "PostgreSQL's own text of the time");

  await assert.rejects(
    () =>
      updateIntent(
        db,
        owner,
        id,
        { ...draft, readiness: "ready" },
        (version) => {
          assert.equal(version, v1);
          throw new Error("precondition");
        },
      ),
    /precondition/,
  );
  assert.equal(
    (await intentVersioned(db, owner, id)).intent.readiness,
    "considering",
    "a refused precondition changes nothing",
  );

  await updateIntent(
    db,
    owner,
    id,
    { ...draft, readiness: "ready" },
    (version) => {
      assert.equal(version, v1);
    },
  );
  const v2 = (await intentVersioned(db, owner, id)).version;
  assert.notEqual(v2, v1);

  const again = await createIntent(db, owner, { ...draft, requestId: id });
  assert.equal(again.created, false, "the same identity is the same intention");
  await closeIntent(db, owner, id);
  assert.equal(
    (await intentVersioned(db, owner, id)).intent.status,
    "cancelled",
  );
  assert.notEqual((await intentVersioned(db, owner, id)).version, v2);
});

test("intentions in the contract: the schema parses what the mapper makes, and the request schema agrees with the engine", async () => {
  const owner = await person("contract");
  const other = await person("contract-other");
  const id = stableUuid("ride-intent:contract");
  const draft = intentDraft({
    visibility: "community",
    meetNewPeople: true,
    allowSuggestions: true,
  });
  await createIntent(db, owner, { ...draft, requestId: id });
  const own = toRideIntent((await intentVersioned(db, owner, id)).intent);
  assert.deepEqual(rideIntentSchema.parse(own), own);
  assert.equal(own.allowSuggestions, true);
  assert.equal(own.passport.area?.label, "Парк");
  assert.deepEqual(own.passport.area?.center, [37.12, 55.65], "a coarse point");
  assert.equal(own.windows.length, 1);
  const seen = toRideIntent((await intentVersioned(db, other, id)).intent);
  assert.deepEqual(rideIntentSchema.parse(seen), seen);
  assert.equal(seen.own, false);
  assert.ok(!("allowSuggestions" in seen));

  // The documented request is accepted by the engine's own parser, and the
  // engine's defaults are what the document says is required.
  const documented = {
    readiness: "ready",
    timeZone: "Europe/Moscow",
    windows: [{ startLocal: "2026-12-01T10:00", endLocal: "2026-12-01T12:00" }],
    passport: {
      area: { label: "Парк", center: [37.1, 55.7], radiusM: 3000 },
      purpose: "social",
      pace: "relaxed",
      distanceKm: { min: 10, max: 30 },
      beginnerFriendly: true,
    },
    visibility: "private",
    allowSuggestions: false,
  };
  assert.deepEqual(rideIntentRequestSchema.parse(documented), documented);
  assert.ok(intentInput.parse(documented));
  assert.throws(
    () => rideIntentRequestSchema.parse({ ...documented, requestId: id }),
    "an unknown field is refused",
  );
  assert.throws(() =>
    rideIntentRequestSchema.parse({
      ...documented,
      passport: { ...documented.passport, purpose: "unknown" },
    }),
  );
});
