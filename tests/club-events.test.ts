import test, { after } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow } from "./support/clubs.ts";
import { planInput, planRide, rideDefaults } from "../lib/rides.ts";
import { planRow, rsvpRow } from "./support/rides.ts";
import { changeMembership, manageClubMember } from "../lib/club-membership.ts";
import { clubDetail, setClubArchived } from "../lib/clubs.ts";
import {
  deliverClubEvent,
  clubNoticePreferences,
  setClubNoticePreferences,
} from "../lib/club-events.ts";
import { nearestClubRide } from "../lib/club-nearest.ts";
import { notificationPage } from "../lib/notifications.ts";
const db = await testDatabase();
after(() => db.close());
async function setup(application = false) {
  const owner = await userRow(db, { email_verified_at: new Date() }),
    member = await userRow(db, { email_verified_at: new Date() }),
    other = await userRow(db, { email_verified_at: new Date() });
  const bike = await bikeRow(db, owner.id, { is_public: false });
  const club = await db.transaction((q) =>
    clubRow(q, owner.id, { joinMode: application ? "application" : "open" }),
  );
  return { owner, member, other, bike, club };
}
async function drain(club: string) {
  const jobs = (
    await db.query<{ id: string }>(
      "SELECT id FROM club_event_outbox WHERE club_id=$1 AND delivered_at IS NULL ORDER BY created_at,id",
      [club],
    )
  ).rows;
  for (const job of jobs)
    await db.transaction((q) => deliverClubEvent(q, job.id));
}
const inbox = async (id: string) =>
  (await notificationPage(db, id)).notifications;
test("applications/results/invitations use one common inbox, current revision and role; replay does not duplicate", async () => {
  const p = await setup(true);
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "join" }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.owner.id)).filter((n) => n.type === "club_application")
      .length,
    1,
  );
  assert.equal((await inbox(p.other.id)).length, 0);
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.member.id, {
      action: "approve",
    }),
  );
  await drain(p.club.id);
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.owner.id)).filter((n) => n.type === "club_application")
      .length,
    0,
  );
  const result = (await inbox(p.member.id)).find(
    (n) => n.type === "club_membership_result",
  );
  assert.ok(result);
  assert.equal(result.target.type, "club");
  assert.equal(result.actor, null);
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.other.id, {
      action: "invite",
    }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.other.id)).filter((n) => n.type === "club_invitation")
      .length,
    1,
  );
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.other.id, {
      action: "revoke-invite",
    }),
  );
  assert.equal(
    (await inbox(p.other.id)).filter((n) => n.type === "club_invitation")
      .length,
    0,
  );
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.member.id, {
      action: "role",
      role: "organizer",
    }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_role").length,
    1,
  );
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "leave" }),
  );
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_role").length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM notification_email_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE club_id=$1)",
        [p.club.id],
      )
    ).rowCount,
    0,
  );
});
test("ride opt-in is off by default, current SQL fences late jobs/leave; nearest summary never returns internal event to outsiders", async () => {
  const p = await setup();
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "join" }),
  );
  assert.equal(
    (await clubNoticePreferences(db, p.club.id, p.member.id)).notifyRides,
    false,
  );
  await assert.rejects(
    clubNoticePreferences(db, p.club.id, p.other.id),
    /недоступны/,
  );
  const when = new Date(Date.now() + 86400000);
  await planRow(db, p.owner.id, p.bike.id, when, {
    club_id: p.club.id,
    club_audience: "members",
    is_public: false,
  });
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_ride_new").length,
    0,
  );
  await db.transaction((q) =>
    setClubNoticePreferences(q, p.club.id, p.member.id, { notifyRides: true }),
  );
  const ride = await db.transaction((q) =>
    planRide(
      q,
      p.owner.id,
      planInput.parse({
        bikeId: p.bike.id,
        isPublic: false,
        privacyEnabled: true,
        privacyRadiusM: 500,
        title: "Создание через планировщик",
        scheduledAt: new Date(when.getTime() + 3600000).toISOString(),
        clubId: p.club.id,
        meetingPoint: "Secret gate 7",
        meetingVisibility: "participants",
      }),
      rideDefaults,
    ),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_ride_new").length,
    1,
  );
  assert.equal((await nearestClubRide(db, p.club.id, p.other.id)).ride, null);
  assert.ok((await nearestClubRide(db, p.club.id, p.member.id)).ride);
  assert.doesNotMatch(
    JSON.stringify(await nearestClubRide(db, p.club.id, p.member.id)),
    /Secret gate|bikeId|meetingPoint/,
  );
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "leave" }),
  );
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_ride_new").length,
    0,
  );
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "join" }),
  );
  assert.equal(
    (await clubNoticePreferences(db, p.club.id, p.member.id)).notifyRides,
    false,
  );
  await db.transaction((q) =>
    setClubNoticePreferences(q, p.club.id, p.member.id, { notifyRides: true }),
  );
  await planRow(db, p.owner.id, p.bike.id, new Date(when.getTime() + 7200000), {
    club_id: p.club.id,
    club_audience: "members",
    is_public: false,
  });
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.member.id, {
      action: "exclude",
    }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "club_ride_new").length,
    0,
  );
  assert.ok(ride.id);
});
test("lost organizer and archive cancellation are durable, neutral and use current recipients/history", async () => {
  const p = await setup();
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "join" }),
  );
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.member.id, {
      action: "role",
      role: "organizer",
    }),
  );
  const mb = await bikeRow(db, p.member.id, { is_public: false }),
    when = new Date(Date.now() + 86400000);
  const r = await planRow(db, p.member.id, mb.id, when, {
    club_id: p.club.id,
    club_audience: "members",
    is_public: false,
  });
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.owner.id, p.member.id, {
      action: "role",
      role: "member",
    }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.owner.id)).filter((n) => n.type === "club_organizer_lost")
      .length,
    1,
  );
  await db.query("UPDATE rides SET club_suspended=false WHERE id=$1", [r.id]);
  assert.equal(
    (await inbox(p.owner.id)).filter((n) => n.type === "club_organizer_lost")
      .length,
    0,
  );
  const open = await planRow(db, p.owner.id, p.bike.id, when, {
    club_id: p.club.id,
    club_audience: "members",
    is_public: false,
  });
  await rsvpRow(db, open.id, p.member.id, when);
  const current = await clubDetail(db, p.club.id, p.owner.id);
  await db.transaction((q) =>
    setClubArchived(q, p.club.id, p.owner.id, {
      archived: true,
      version: current.version,
    }),
  );
  await drain(p.club.id);
  assert.equal(
    (await inbox(p.member.id)).filter((n) => n.type === "ride_cancelled")
      .length,
    1,
  );
  const pending = (
    await db.query(
      "SELECT 1 FROM club_event_outbox WHERE club_id=$1 AND delivered_at IS NULL",
      [p.club.id],
    )
  ).rowCount;
  assert.equal(pending, 0);
});
