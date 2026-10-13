import test, { after } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./support/database.ts";
import { userRow, viewer } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow } from "./support/clubs.ts";
import { planRow, invitationRow, rsvpRow } from "./support/rides.ts";
import {
  changeMembership,
  manageClubMember,
  transferClub,
} from "../lib/club-membership.ts";
import { clubDetail, setClubArchived } from "../lib/clubs.ts";
import {
  apiRideRow,
  rideDetail,
  rideParticipation,
  respondRide,
  setRideRecruitment,
  cancelPlannedRide,
  deleteRide,
  manageClubRide,
  saveRide,
  planRide,
  rideDefaults,
  planInput,
  rideList,
} from "../lib/rides.ts";
import { ownRideTrack } from "../lib/account-data.ts";
import { entitySocial } from "../lib/entity-social.ts";
import { loadSocialPreview } from "../lib/social-preview.ts";
import { notificationPage } from "../lib/notifications.ts";
import { scheduleRideReminders } from "../lib/ride-notifications.ts";
const db = await testDatabase();
after(() => db.close());
const date = () => new Date(Date.now() + 86400000);
async function setup() {
  const owner = await userRow(db, { email_verified_at: new Date() }),
    member = await userRow(db, { email_verified_at: new Date() }),
    outsider = await userRow(db, { email_verified_at: new Date() });
  const bike = await bikeRow(db, owner.id, { is_public: true });
  const club = await db.transaction((q) => clubRow(q, owner.id));
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "join" }),
  );
  const when = date();
  const ride = await planRow(db, owner.id, bike.id, when, {
    club_id: club.id,
    club_audience: "members",
    is_public: false,
    has_track: true,
  });
  return { owner, member, outsider, bike, club, ride, when };
}
test("internal readers override legacy owner/invite shortcuts and never publish OG, counts or private bike labels", async () => {
  const { owner, member, outsider, bike, club, ride, when } = await setup();
  await invitationRow(db, ride.id, outsider.id);
  for (const user of [null, outsider.id]) {
    await assert.rejects(rideDetail(db, ride.share_id, user), /недоступ/);
    assert.equal(await apiRideRow(db, ride.id, user), undefined);
  }
  await db.query("UPDATE bikes SET is_public=false,name=$2 WHERE id=$1", [
    bike.id,
    "Secret bicycle",
  ]);
  const card = await rideDetail(db, ride.share_id, member.id);
  assert.equal(card.bike.name, "Велосипед организатора");
  assert.equal(card.meetingPoint, "");
  assert.equal(
    (await rideParticipation(db, ride.id, member.id))?.access,
    "club",
  );
  assert.equal(
    await loadSocialPreview(db, "ride", ride.public_id, { byPublicId: true }),
    null,
  );
  assert.equal(
    (await rideList(db, null)).rides.some((r) => r.id === ride.id),
    false,
  );
  await db.transaction((q) =>
    respondRide(q, ride.id, member.id, "accepted", when.toISOString()),
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).meetingPoint,
    "Secret gate 7",
  );
  await db.query(
    "UPDATE rides SET agreement_revision=agreement_revision+1 WHERE id=$1",
    [ride.id],
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).meetingPoint,
    "Secret gate 7",
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).participation,
    "reconfirm",
  );
  await db.transaction((q) =>
    manageClubMember(q, club.id, owner.id, member.id, { action: "exclude" }),
  );
  await assert.rejects(rideDetail(db, ride.share_id, member.id), /недоступ/);
  assert.equal(await ownRideTrack(db, member.id, ride.id), null);
});
test("leaving removes future internal answers/invitations/reminders; open answers survive and rejoining revives nothing", async () => {
  const { owner, member, bike, club, ride, when } = await setup();
  const open = await planRow(db, owner.id, bike.id, when, {
    club_id: club.id,
    club_audience: "open",
  });
  await invitationRow(db, ride.id, member.id);
  await rsvpRow(db, ride.id, member.id, when);
  await rsvpRow(db, open.id, member.id, when);
  await db.transaction((q) =>
    scheduleRideReminders(q, new Date(), { ride: ride.id, user: member.id }),
  );
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "leave" }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
        [ride.id, member.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2",
        [open.id, member.id],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM ride_invitations WHERE ride_id=$1 AND user_id=$2",
        [ride.id, member.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await notificationPage(db, member.id)).notifications.some(
      (n) => n.type === "ride_reminder",
    ),
    false,
  );
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "join" }),
  );
  assert.equal(
    (await rideParticipation(db, ride.id, member.id))?.participation,
    "none",
  );
});
test("loss of organizing role closes recruitment and blocks old creator edits; open RSVP remains public", async () => {
  const { owner, member, outsider, bike, club, when } = await setup();
  const mb = await bikeRow(db, member.id, { is_public: true });
  await db.transaction((q) =>
    manageClubMember(q, club.id, owner.id, member.id, {
      action: "role",
      role: "organizer",
    }),
  );
  const r = await planRow(db, member.id, mb.id, when, {
    club_id: club.id,
    club_audience: "members",
    is_public: false,
  });
  await db.transaction((q) =>
    manageClubMember(q, club.id, owner.id, member.id, {
      action: "role",
      role: "member",
    }),
  );
  assert.equal(
    (await rideDetail(db, r.share_id, owner.id)).recruitmentClosed,
    true,
  );
  await assert.rejects(
    db.transaction((q) =>
      setRideRecruitment(q, r.id, member.id, true, when.toISOString()),
    ),
    /Выезды создают/,
  );
  await assert.rejects(
    db.transaction((q) => cancelPlannedRide(q, r.id, member.id)),
    /Выезды создают/,
  );
  const open = await planRow(db, owner.id, bike.id, when, {
    club_id: club.id,
    club_audience: "open",
  });
  await db.transaction((q) =>
    respondRide(q, open.id, outsider.id, "accepted", when.toISOString()),
  );
  assert.equal(
    (await rideParticipation(db, open.id, outsider.id))?.participation,
    "accepted",
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM club_event_outbox WHERE ride_id=$1 AND kind='organizer_lost'",
        [r.id],
      )
    ).rowCount,
    1,
  );
});
test("archive cancels future series and keeps internal history private; restoration never resumes events", async () => {
  const { owner, member, outsider, club, ride } = await setup();
  await db.transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: true,
      version: club.version,
    }),
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "SELECT status FROM rides WHERE id=$1",
        [ride.id],
      )
    ).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).status,
    "cancelled",
  );
  await assert.rejects(rideDetail(db, ride.share_id, outsider.id), /недоступ/);
  const c = await clubDetail(db, club.id, owner.id);
  await db.transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: false,
      version: c.version,
    }),
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).status,
    "cancelled",
  );
});
test("archived members can explicitly withdraw; a hidden club owner can archive without making it readable", async () => {
  const { owner, member, club, ride } = await setup();
  await db.transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: true,
      version: club.version,
    }),
  );
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "leave" }),
  );
  await assert.rejects(rideDetail(db, ride.share_id, member.id), /недоступ/);
  const other = await setup();
  await db.query("UPDATE clubs SET hidden_at=now() WHERE id=$1", [
    other.club.id,
  ]);
  await assert.rejects(clubDetail(db, other.club.id), /недоступ/);
  const hidden = await clubDetail(db, other.club.id, other.owner.id);
  assert.equal(hidden.hidden, true);
  await db.transaction((q) =>
    setClubArchived(q, other.club.id, other.owner.id, {
      archived: true,
      version: hidden.version,
    }),
  );
  assert.equal(
    (await clubDetail(db, other.club.id, other.owner.id)).archived,
    true,
  );
});
test("audience cannot silently publish prior internal discussion, and club administration resolves an orphan without editing its bicycle", async () => {
  const { owner, member, outsider, club, ride, bike } = await setup();
  await db.transaction((q) =>
    entitySocial("ride").create(q, ride.id, viewer(member), {
      body: "Закрытые условия",
    }),
  );
  await assert.rejects(
    db.transaction((q) =>
      saveRide(
        q,
        owner.id,
        {
          bikeId: bike.id,
          title: ride.title,
          description: ride.description,
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
          clubAudience: "open",
        },
        rideDefaults,
        ride.id,
      ),
    ),
    /нельзя сделать открытым/,
  );
  assert.equal(await apiRideRow(db, ride.id, outsider.id), undefined);
  await assert.rejects(
    db.transaction((q) =>
      manageClubRide(q, club.id, ride.id, member.id, "cancel"),
    ),
    /Выезды создают|администрация/,
  );
  await db.transaction((q) =>
    manageClubRide(q, club.id, ride.id, owner.id, "cancel"),
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, owner.id)).status,
    "cancelled",
  );
});
test("membership revoked after the initial snapshot is rechecked before detail returns", async () => {
  const { club, member, ride } = await setup();
  let revoked = false;
  const q = {
    query: async <Row extends object>(sql: string, args: unknown[] = []) => {
      const result = await db.query<Row>(sql, args);
      if (!revoked && sql.includes("r.share_id=$2")) {
        revoked = true;
        await db.transaction((tx) =>
          changeMembership(tx, club.id, member.id, { action: "leave" }),
        );
      }
      return result;
    },
  };
  await assert.rejects(rideDetail(q, ride.share_id, member.id), /недоступ/);
  assert.equal(revoked, true);
});
test("ride comments share the engine but every page/reply and mutation respects current club access", async () => {
  const { member, outsider, club, ride } = await setup(),
    social = entitySocial("ride");
  const c = await db.transaction((q) =>
    social.create(q, ride.id, viewer(member), { body: "Внутренний текст" }),
  );
  assert.equal(
    (await social.page(db, ride.id, viewer(member))).comments[0].body,
    "Внутренний текст",
  );
  await assert.rejects(social.page(db, ride.id, viewer(outsider)), /недоступ/);
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "leave" }),
  );
  await assert.rejects(social.page(db, ride.id, viewer(member)), /недоступ/);
  await assert.rejects(
    db.transaction((q) =>
      social.create(q, ride.id, viewer(member), { body: "Старый доступ" }),
    ),
    /участникам/,
  );
  await db.transaction((q) => social.change(q, c.id, viewer(member), null));
  assert.equal(
    (
      await db.query<{ body: string }>(
        "SELECT body FROM ride_comments WHERE id=$1",
        [c.id],
      )
    ).rows[0].body,
    "",
  );
});
test("creation defaults to members, requires own bike/current organizing role and never permits attaching a club via generic edit", async () => {
  const { owner, member, bike, club } = await setup();
  const input = planInput.parse({
    bikeId: bike.id,
    isPublic: false,
    privacyEnabled: true,
    privacyRadiusM: 500,
    title: "Клубный план",
    scheduledAt: date().toISOString(),
    clubId: club.id,
    meetingPoint: "Парк",
    meetingVisibility: "participants",
  });
  const made = await db.transaction((q) =>
    planRide(q, owner.id, input, rideDefaults),
  );
  assert.equal(
    (await rideDetail(db, made.shareId, owner.id)).club?.audience,
    "members",
  );
  await assert.rejects(
    db.transaction((q) => planRide(q, member.id, input, rideDefaults)),
    /Выезды создают/,
  );
  await assert.rejects(
    db.transaction((q) =>
      saveRide(q, owner.id, { ...input }, rideDefaults, made.id),
    ),
    /unrecognized|Неизвест|Invalid/i,
  );
});

test("an event's former club owner cannot use original-track or owner-detail shortcuts after transfer and departure", async () => {
  const { owner, member, club, ride } = await setup();
  await bikeRow(db, member.id, { is_public: false });
  assert.notEqual(await ownRideTrack(db, owner.id, ride.id), null);
  const offer = await db.transaction((q) =>
    transferClub(q, club.id, owner.id, {
      action: "offer",
      targetId: member.id,
      version: club.version,
    }),
  );
  await db.transaction((q) =>
    transferClub(q, club.id, member.id, {
      action: "accept",
      version: offer.version,
    }),
  );
  await db.transaction((q) =>
    changeMembership(q, club.id, owner.id, { action: "leave" }),
  );
  assert.equal(await ownRideTrack(db, owner.id, ride.id), null);
  await assert.rejects(
    rideDetail(db, ride.share_id, owner.id, true),
    /недоступ/,
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).recruitmentClosed,
    true,
  );
});

test("former/deleted/foreign bicycles and blocked organizers cannot gain availability through club readers", async () => {
  const { owner, member, outsider, bike, club, ride } = await setup();
  await db.query("UPDATE bikes SET is_former=true WHERE id=$1", [bike.id]);
  await assert.rejects(rideDetail(db, ride.share_id, member.id), /недоступ/);
  assert.equal(await apiRideRow(db, ride.id, member.id), undefined);
  await db.query("UPDATE bikes SET is_former=false WHERE id=$1", [bike.id]);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [owner.id]);
  await assert.rejects(rideDetail(db, ride.share_id, member.id), /недоступ/);
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [owner.id]);
  assert.equal(
    (await rideDetail(db, ride.share_id, member.id)).recruitmentClosed,
    true,
  );
  await assert.rejects(
    db.query("UPDATE bikes SET owner_id=$2 WHERE id=$1", [
      bike.id,
      outsider.id,
    ]),
    /foreign key constraint/,
  );
  assert.equal(
    (await rideDetail(db, ride.share_id, owner.id, true)).club?.id,
    club.id,
  );
  await assert.rejects(
    db.query("DELETE FROM bikes WHERE id=$1", [bike.id]),
    /foreign key constraint/,
  );
  await db.transaction((q) => deleteRide(q, owner.id, ride.id));
  await db.query("DELETE FROM bikes WHERE id=$1", [bike.id]);
  assert.equal(await apiRideRow(db, ride.id, member.id), undefined);
  assert.equal(
    (await db.query("SELECT 1 FROM clubs WHERE id=$1", [club.id])).rowCount,
    1,
  );
});
