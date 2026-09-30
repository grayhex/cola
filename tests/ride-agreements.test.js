import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import {
  agreementChanges,
  areaChanged,
  mayJoin,
  participationState,
  placeChanged,
} from "../lib/ride-agreement.js";
import {
  rideAnnouncement,
  rideFormatLabel,
  rideTimeLabel,
} from "../lib/ride-announcement.js";
import {
  attachRideTrack,
  cancelPlannedRide,
  planInput,
  planRide,
  respondRide,
  respondRideInvitation,
  rideDefaults,
  rideDetail,
  rideEdit,
  rideList,
  saveRide,
  setRideRecruitment,
  upcomingRides,
} from "../lib/rides.js";
import { loadSocialCard, loadSocialPreview } from "../lib/social-preview.ts";
import { cardContent } from "../lib/social-card.ts";
import { notificationPage } from "../lib/notifications.ts";
import { gpx, loop } from "./ride-fixtures.js";

const hour = 3600000;
const at = (hours) =>
  new Date(Math.round((Date.now() + hours * hour) / 60000) * 60000)
    .toISOString()
    .replace(".000Z", "Z");

test("a typo keeps the agreement; a new place, start or route is a new edition", () => {
  for (const [before, after] of [
    ["Кафе «Ромашка»", "кафе ромашка"],
    ["Парк Горкого, вход", "Парк Горького, вход"],
    ["у фантана", "у фонтана"],
    ["ПаркГорького", "Парк Горького"],
    ["Метро Ёлки", "метро елки"],
  ])
    assert.equal(placeChanged(before, after), false, `${before} → ${after}`);
  for (const [before, after] of [
    ["", "Кафе у станции"],
    ["Кафе у станции", ""],
    ["Выход 2", "Выход 3"],
    ["Сокол", "Сокольники"],
    ["Парк, главный вход", "Парк, главный выход"],
    ["Вход в парк", "Выход из парка"],
    ["Тверская улица", "Тверской бульвар"],
    ["ВДНХ", "ВДНК"],
  ])
    assert.equal(placeChanged(before, after), true, `${before} → ${after}`);
  const area = { label: "Сокольники", center: [37.67, 55.79] };
  assert.equal(areaChanged(area, { ...area, label: "Сокольнки" }), false);
  assert.equal(areaChanged(area, { ...area, center: [37.68, 55.8] }), false);
  assert.equal(areaChanged(area, { ...area, center: [37.4, 55.79] }), true);
  assert.equal(areaChanged(area, { label: "Измайлово" }), true);
  assert.equal(areaChanged(null, area), false, "adding an area is no move");
  const base = {
    occursAt: "2031-01-01T09:00:00Z",
    meetingPoint: "Кафе",
    area,
    hasTrack: false,
  };
  assert.deepEqual(agreementChanges(base, { ...base }), []);
  assert.deepEqual(
    agreementChanges(base, {
      ...base,
      occursAt: "2031-01-01T10:00:00Z",
      meetingPoint: "Вокзал",
      hasTrack: true,
    }),
    ["start", "place", "route"],
  );
  // One state per person and date.
  const state = (o) => participationState({ agreementRevision: 2, ...o });
  assert.equal(state({ owner: true, response: "accepted" }), "organizer");
  assert.equal(state({ invited: true }), "invited");
  assert.equal(state({}), "none");
  assert.equal(state({ response: "accepted", revision: 2 }), "accepted");
  assert.equal(state({ response: "accepted", revision: 1 }), "reconfirm");
  assert.equal(state({ response: "maybe", revision: 1 }), "reconfirm");
  assert.equal(state({ response: "declined", revision: 1 }), "declined");
  // A closed recruitment keeps those already in and the invited.
  assert.equal(mayJoin("none", { recruitmentClosed: true }), false);
  assert.equal(mayJoin("declined", { recruitmentClosed: true }), false);
  assert.equal(mayJoin("reconfirm", { recruitmentClosed: true }), true);
  assert.equal(mayJoin("maybe", { recruitmentClosed: true }), true);
  assert.equal(
    mayJoin("declined", { recruitmentClosed: true, invited: true }),
    true,
  );
  assert.equal(mayJoin("organizer", {}), false);
});

test("the public announcement carries date, zone, format, area and organizer only", () => {
  assert.equal(
    rideTimeLabel("2031-10-04T07:00:00Z", "Europe/Moscow"),
    "сб, 4 октября в 10:00 GMT+3",
  );
  assert.equal(
    rideFormatLabel({ purpose: "leisure", pace: "relaxed", surface: "gravel" }),
    "Прогулка · спокойный темп · Гравий / грунт",
  );
  const text = rideAnnouncement({
    status: "planned",
    occursAt: "2031-10-04T07:00:00Z",
    timeZone: "Europe/Moscow",
    recurrence: "weekly",
    passport: { pace: "sporty", area: { label: "Сокольники" } },
    organizer: "Анна",
    recruitmentClosed: true,
  });
  assert.equal(
    text,
    "сб, 4 октября в 10:00 GMT+3 · каждую неделю · спортивный темп · район: Сокольники · организатор: Анна · набор закрыт",
  );
  assert.equal(
    rideAnnouncement({ status: "cancelled", organizer: "Анна" }),
    "Покатушка отменена · организатор: Анна",
  );
  const card = cardContent("ride", "План", {
    status: "planned",
    planned: true,
    occursAt: "2031-10-04T07:00:00Z",
    timeZone: "Europe/Moscow",
    passport: { purpose: "social", areaLabel: "Сокольники" },
    bike: "Grizl",
  });
  assert.deepEqual(card.chips, ["сб, 4 октября в 10:00 GMT+3", "Сокольники"]);
  assert.equal(card.meta, "Общение");
});

async function setup() {
  const db = new PGlite(),
    dir = await mkdtemp(tmpdir() + "/cola-agreements-"),
    before = process.env.RIDES_DIR;
  process.env.RIDES_DIR = dir;
  for (const f of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  let n = 0;
  const user = async (name = "Rider") => {
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,'hash',$4)",
      [id, id + "@example.test", name, "agree" + n++],
    );
    return id;
  };
  const owner = await user("Организатор"),
    bike = randomUUID();
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Bike',2026,'gravel',true)",
    [bike, owner],
  );
  const tx = (fn) => db.transaction(fn);
  const plan = (o = {}) =>
    tx((q) =>
      planRide(
        q,
        owner,
        planInput.parse({
          bikeId: bike,
          title: "Вечерний круг",
          description: "",
          isPublic: true,
          privacyEnabled: false,
          privacyRadiusM: 500,
          scheduledAt: at(48),
          meetingPoint: "Кафе у станции",
          meetingVisibility: "participants",
          passport: {
            area: { label: "Сокольники" },
            pace: "relaxed",
            groupSize: { min: 2, max: 3 },
          },
          ...o,
        }),
        rideDefaults,
      ),
    );
  const edit = (ride, changes) =>
    tx(async (q) => {
      const current = await rideDetail(q, ride.shareId, owner, true);
      return saveRide(
        q,
        owner,
        rideEdit.parse({
          bikeId: bike,
          title: current.title,
          description: current.description,
          isPublic: current.isPublic,
          privacyEnabled: current.privacyEnabled,
          privacyRadiusM: current.privacyRadiusM,
          scheduledAt: new Date(current.startedAt).toISOString(),
          meetingPoint: current.meetingPoint,
          passport: current.passport,
          meetingVisibility: current.meetingVisibility,
          ...changes,
        }),
        rideDefaults,
        ride.id,
      );
    });
  return {
    db,
    tx,
    user,
    owner,
    bike,
    plan,
    edit,
    close: async () => {
      if (before === undefined) delete process.env.RIDES_DIR;
      else process.env.RIDES_DIR = before;
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("one participation state per person and date, public and private, with and without a bike", async () => {
  const t = await setup();
  const { db, tx, owner } = t;
  try {
    const ride = await t.plan();
    const rider = await t.user(), // no bike: may still answer
      friend = await t.user(),
      stranger = await t.user();
    const detail = (viewer) => rideDetail(db, ride.shareId, viewer);
    const respond = (viewer, response, when) =>
      tx((q) => respondRide(q, ride.id, viewer, response, when));
    let d = await detail(rider);
    assert.equal(d.participation, "none");
    assert.equal(d.canJoin, true);
    assert.equal(d.meetingHidden, true);
    assert.equal(d.answers, undefined, "only the organizer sees answers");
    await respond(rider, "accepted", d.scheduledAt);
    // A repeated answer is idempotent.
    await respond(rider, "accepted", d.scheduledAt);
    d = await detail(rider);
    assert.equal(d.participation, "accepted");
    assert.equal(d.rsvp, "accepted");
    assert.deepEqual(d.rsvpCounts, { accepted: 1 });
    assert.equal(d.meetingPoint, "Кафе у станции");
    // The organizer answers nothing and sees people by name.
    await assert.rejects(respond(owner, "accepted", d.scheduledAt), {
      status: 409,
    });
    const organizer = await detail(owner);
    assert.equal(organizer.participation, "organizer");
    assert.deepEqual(organizer.answers.counts, { accepted: 1 });
    assert.equal(organizer.answers.people[0].author.id, rider);
    assert.doesNotMatch(JSON.stringify(organizer), /@example\.test/);
    // Invitation + RSVP at once: one state everywhere.
    await t.edit(ride, { invitations: ["agree2"] });
    d = await detail(friend);
    assert.equal(d.participation, "invited");
    assert.equal(d.invitation, "pending");
    await tx((q) => respondRideInvitation(q, ride.id, friend, "maybe"));
    d = await detail(friend);
    assert.equal(d.participation, "maybe");
    assert.equal(d.invitation, "maybe");
    const listed = (await rideList(db, friend, { status: "planned" })).rides;
    assert.equal(listed.find((r) => r.id === ride.id).participation, "maybe");
    assert.deepEqual(
      (await detail(owner)).invitations.map((i) => i.response),
      ["maybe"],
    );
    assert.deepEqual((await detail(owner)).answers.counts, {
      accepted: 1,
      maybe: 1,
    });
    // Others see counts, never the invited list or names.
    const guest = await detail(null);
    assert.equal(guest.participation, "none");
    assert.equal(guest.canJoin, false);
    assert.deepEqual(guest.invitations, []);
    assert.equal(guest.answers, undefined);
    assert.equal(
      (await rideDetail(db, ride.shareId, stranger)).invitations.length,
      0,
    );
    // Private: no access by URL, no answer by id.
    const closed = await t.plan({ isPublic: false, invitations: ["agree2"] });
    await assert.rejects(rideDetail(db, closed.shareId, stranger), {
      status: 404,
    });
    await assert.rejects(rideDetail(db, closed.shareId, null), {
      status: 404,
    });
    await assert.rejects(
      tx((q) => respondRide(q, closed.id, stranger, "accepted")),
      { status: 404 },
    );
    const invited = await rideDetail(db, closed.shareId, friend);
    assert.equal(invited.participation, "invited");
    assert.equal(await loadSocialPreview(db, "ride", closed.shareId), null);
    // Revoking the invitation ends access and the answer.
    await tx((q) => respondRide(q, closed.id, friend, "accepted"));
    assert.equal(
      (await rideDetail(db, closed.shareId, friend)).meetingPoint,
      "Кафе у станции",
    );
    await t.edit(closed, { invitations: [] });
    await assert.rejects(rideDetail(db, closed.shareId, friend), {
      status: 404,
    });
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
          [closed.id, friend],
        )
      ).rows[0].n,
      0,
    );
    assert(
      !(await notificationPage(db, friend)).notifications.some(
        (n) => n.type === "ride_invite" && n.ride?.id === closed.id,
      ),
    );
    // On a public plan the revoked person may join again while it is open.
    await t.edit(ride, { invitations: [] });
    d = await detail(friend);
    assert.equal(d.participation, "none");
    await respond(friend, "declined", d.scheduledAt);
    await respond(friend, "accepted", d.scheduledAt);
    assert.equal((await detail(friend)).participation, "accepted");
    // Blocked people and plans in the past answer nothing.
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [stranger]);
    await assert.rejects(respond(stranger, "accepted", d.scheduledAt), {
      status: 404,
    });
    await db.query(
      "UPDATE rides SET started_at=now()-interval '1 hour' WHERE id=$1",
      [closed.id],
    );
    await assert.rejects(
      tx((q) => respondRide(q, closed.id, friend, "accepted")),
      { status: 404 },
    );
  } finally {
    await t.close();
  }
});

test("closing recruitment keeps accepted and invited people, and reopens for the next date", async () => {
  const t = await setup();
  const { db, tx, owner } = t;
  try {
    const ride = await t.plan({
      recurrence: "weekly",
      recurrenceTimezone: "Europe/Moscow",
    });
    const [going, maybe, late, refused, invited] = await Promise.all(
      [1, 2, 3, 4, 5].map(() => t.user()),
    );
    let d = await rideDetail(db, ride.shareId, going);
    const date = d.scheduledAt;
    const respond = (viewer, response) =>
      tx((q) => respondRide(q, ride.id, viewer, response, date));
    await respond(going, "accepted");
    await respond(maybe, "maybe");
    await respond(refused, "declined");
    await assert.rejects(
      tx((q) => setRideRecruitment(q, ride.id, going, false, date)),
      { status: 404 },
      "only the organizer closes it",
    );
    await tx((q) => setRideRecruitment(q, ride.id, owner, false, date));
    await t.edit(ride, { invitations: ["agree5"] });
    d = await rideDetail(db, ride.shareId, late);
    assert.equal(d.recruitmentClosed, true);
    assert.equal(d.canJoin, false);
    await assert.rejects(respond(late, "accepted"), { status: 409 });
    await assert.rejects(respond(refused, "maybe"), { status: 409 });
    // Already in: switch freely; invited: may accept; anyone may leave.
    await respond(maybe, "accepted");
    await respond(going, "maybe");
    await respond(going, "accepted");
    assert.equal((await rideDetail(db, ride.shareId, invited)).canJoin, true);
    await respond(invited, "accepted");
    await respond(late, "declined");
    assert.deepEqual((await rideDetail(db, ride.shareId, owner)).rsvpCounts, {
      accepted: 3,
      declined: 2,
    });
    // The desired size (2–3) is no quota: a fourth invited person still joins.
    const preview = await loadSocialPreview(db, "ride", ride.shareId);
    assert.match(preview.description, /набор закрыт/);
    // Reopening lets new people in again.
    await tx((q) => setRideRecruitment(q, ride.id, owner, true, date));
    await respond(late, "accepted");
    await tx((q) => setRideRecruitment(q, ride.id, owner, false, date));
    // Once the closed date has passed (here: the mark points a week back),
    // the next date of the series is open without any action.
    await db.query(
      "UPDATE rides SET recruitment_closed_for=recruitment_closed_for-interval '7 days' WHERE id=$1",
      [ride.id],
    );
    d = await rideDetail(db, ride.shareId, refused);
    assert.equal(d.recruitmentClosed, false);
    await respond(refused, "accepted");
    // A date the plan does not have is refused.
    await assert.rejects(
      tx((q) => setRideRecruitment(q, ride.id, owner, false, at(24))),
      { status: 409 },
    );
  } finally {
    await t.close();
  }
});

test("a substantial edit asks to confirm again; a typo, title or format edit does not", async () => {
  const t = await setup();
  const { db, tx, owner } = t;
  try {
    const ride = await t.plan();
    const [going, maybe, refused] = await Promise.all(
      [1, 2, 3].map(() => t.user()),
    );
    let d = await rideDetail(db, ride.shareId, going);
    const respond = (viewer, response, when = d.scheduledAt) =>
      tx((q) => respondRide(q, ride.id, viewer, response, when));
    await respond(going, "accepted");
    await respond(maybe, "maybe");
    await respond(refused, "declined");
    await t.edit(ride, {
      title: "Вечерний круг по парку",
      meetingPoint: "Кафе у станцыи",
      passport: { area: { label: "Сокольники" }, pace: "moderate" },
    });
    d = await rideDetail(db, ride.shareId, going);
    assert.equal(d.agreement.revision, 1);
    assert.equal(d.participation, "accepted");
    // A new place: a new edition; "going" and "maybe" confirm again.
    await t.edit(ride, { meetingPoint: "Главный вход в парк" });
    d = await rideDetail(db, ride.shareId, going);
    assert.equal(d.agreement.revision, 2);
    assert.deepEqual(d.agreement.changes, ["place"]);
    assert.equal(d.participation, "reconfirm");
    assert.equal(d.rsvp, null, "the old answer is not agreement");
    assert.equal(d.previousRsvp, "accepted");
    assert.equal(d.meetingPoint, "Главный вход в парк");
    assert.equal(
      (await rideDetail(db, ride.shareId, maybe)).meetingHidden,
      true,
    );
    assert.equal(
      (await rideDetail(db, ride.shareId, refused)).participation,
      "declined",
    );
    const organizer = await rideDetail(db, ride.shareId, owner);
    assert.deepEqual(organizer.rsvpCounts, { reconfirm: 2, declined: 1 });
    assert.deepEqual(organizer.answers.counts, { reconfirm: 2, declined: 1 });
    const upcoming = await upcomingRides(db, going);
    assert.equal(upcoming[0].changedAfterAnswer, true);
    await respond(going, "accepted");
    d = await rideDetail(db, ride.shareId, going);
    assert.equal(d.participation, "accepted");
    assert.deepEqual(d.rsvpCounts, {
      accepted: 1,
      reconfirm: 1,
      declined: 1,
    });
    // A new start moves the answers to the new date and asks again.
    const later = at(72);
    await t.edit(ride, { scheduledAt: later });
    d = await rideDetail(db, ride.shareId, going);
    assert.equal(+new Date(d.scheduledAt), +new Date(later));
    assert.deepEqual(d.agreement.changes, ["start"]);
    assert.equal(d.participation, "reconfirm");
    assert.equal(
      (await rideDetail(db, ride.shareId, refused)).participation,
      "declined",
    );
    await assert.rejects(respond(going, "accepted", at(48)), { status: 409 });
    await respond(going, "accepted", later);
    // A route added later is a new edition too.
    await tx((q) =>
      attachRideTrack(q, owner, ride.id, gpx([loop]), rideDefaults),
    );
    d = await rideDetail(db, ride.shareId, going);
    assert.deepEqual(d.agreement.changes, ["route"]);
    assert.equal(d.participation, "reconfirm");
    assert.equal(d.agreement.revision, 4);
  } finally {
    await t.close();
  }
});

test("one date of a series is cancelled or revised without touching the others", async () => {
  const t = await setup();
  const { db, tx, owner } = t;
  try {
    const ride = await t.plan({
      recurrence: "weekly",
      recurrenceTimezone: "Europe/Moscow",
    });
    const rider = await t.user(),
      other = await t.user();
    const first = (await rideDetail(db, ride.shareId, rider)).scheduledAt;
    await tx((q) => respondRide(q, ride.id, rider, "accepted", first));
    await assert.rejects(
      tx((q) => cancelPlannedRide(q, ride.id, rider, first)),
      { status: 404 },
    );
    await assert.rejects(
      tx((q) => cancelPlannedRide(q, ride.id, owner, at(24))),
      { status: 409 },
    );
    const result = await tx((q) => cancelPlannedRide(q, ride.id, owner, first));
    assert.equal(result.scope, "occurrence");
    let d = await rideDetail(db, ride.shareId, rider);
    assert.equal(d.status, "planned");
    const second = d.scheduledAt;
    assert.equal(+new Date(second) - +new Date(first), 7 * 24 * hour);
    assert.deepEqual(
      d.cancelledOccurrences.map((x) => +new Date(x)),
      [+new Date(first)],
    );
    assert.equal(d.participation, "none", "a new date starts unanswered");
    // The answer to the cancelled date stays as it was, and is reported.
    const kept = (
      await db.query(
        "SELECT response FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2 AND occurs_at=$3",
        [ride.id, rider, first],
      )
    ).rows[0];
    assert.equal(kept.response, "accepted");
    const upcoming = await upcomingRides(db, rider);
    const cancelled = upcoming.find((r) => r.occurrenceCancelled);
    assert.equal(cancelled.role, "cancelled");
    assert.equal(+new Date(cancelled.scheduledAt), +new Date(first));
    assert.equal(cancelled.meetingPoint, "");
    // The next date takes its own answers.
    await tx((q) => respondRide(q, ride.id, other, "maybe", second));
    await assert.rejects(
      tx((q) => respondRide(q, ride.id, other, "accepted", first)),
      { status: 409 },
    );
    // A revision of the series now asks only the current date's answers.
    await t.edit(ride, { meetingPoint: "Другое кафе" });
    assert.equal(
      (await rideDetail(db, ride.shareId, other)).participation,
      "reconfirm",
    );
    assert.equal(
      (
        await db.query(
          "SELECT response FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2 AND occurs_at=$3",
          [ride.id, rider, first],
        )
      ).rows[0].response,
      "accepted",
    );
    // The same weekday at another time stays cancelled.
    await t.edit(ride, {
      scheduledAt: new Date(+new Date(first) + hour).toISOString(),
    });
    d = await rideDetail(db, ride.shareId, rider);
    assert.equal(
      +new Date(d.scheduledAt),
      +new Date(second) + hour,
      "the cancelled date does not come back",
    );
    // Matching does not offer the cancelled date either.
    const preview = await loadSocialPreview(db, "ride", ride.shareId);
    assert.match(preview.description, /каждую неделю/);
    const card = await loadSocialCard(db, preview);
    assert.equal(+new Date(card.occursAt), +new Date(d.scheduledAt));
    assert(!JSON.stringify({ preview, card }).includes("кафе"));
    // Cancelling the whole series still works.
    await tx((q) => cancelPlannedRide(q, ride.id, owner));
    assert.equal(
      (await rideDetail(db, ride.shareId, rider)).status,
      "cancelled",
    );
    assert.match(
      (await loadSocialPreview(db, "ride", ride.shareId)).description,
      /^Покатушка отменена/,
    );
  } finally {
    await t.close();
  }
});
