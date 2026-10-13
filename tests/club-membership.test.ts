import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import {
  createClub,
  clubCreateInput,
  clubDetail,
  setClubArchived,
} from "../lib/clubs.ts";
import {
  changeMembership,
  manageClubMember,
  clubMembers,
  transferClub,
  clubAdministrativeState,
} from "../lib/club-membership.ts";
import {
  publicClubBadges,
  ownBadgePreferences,
  saveBadgePreferences,
  publicClubBadgesSql,
} from "../lib/club-badges.ts";
import { CommunityError } from "../lib/community-validation.ts";
const db = await testDatabase();
after(() => db.close());
const person = () => userRow(db, { email_verified_at: new Date() });
async function owner() {
  const p = await person();
  await bikeRow(db, p.id, { is_public: false });
  return p;
}
const club = (user: string, open = false) =>
  db.transaction((q) =>
    createClub(
      q,
      user,
      clubCreateInput.parse({
        name: "Клуб " + randomUUID().slice(0, 8),
        requestId: randomUUID(),
        joinMode: open ? "open" : "application",
      }),
    ),
  );
const act = (
  id: string,
  user: string,
  action: Parameters<typeof changeMembership>[3]["action"],
) => db.transaction((q) => changeMembership(q, id, user, { action }));
const manage = (
  id: string,
  user: string,
  target: string,
  action: Parameters<typeof manageClubMember>[4]["action"],
  role?: "admin" | "organizer" | "member",
) =>
  db.transaction((q) =>
    manageClubMember(q, id, user, target, { action, role }),
  );
test("applications stay pending without badges/list access; repeats, cancel, reject and approval are idempotent", async () => {
  const o = await owner(),
    p = await person(),
    c = await club(o.id);
  assert.equal((await act(c.id, p.id, "join")).membership?.state, "pending");
  assert.equal((await act(c.id, p.id, "join")).memberCount, 1);
  assert.equal((await publicClubBadges(db, [p.id])).get(p.id)?.total, 0);
  await assert.rejects(
    clubMembers(db, c.id, p.id),
    (e) => e instanceof CommunityError && e.status === 403,
  );
  await act(c.id, p.id, "cancel");
  await act(c.id, p.id, "join");
  await manage(c.id, o.id, p.id, "reject");
  await act(c.id, p.id, "join");
  await manage(c.id, o.id, p.id, "approve");
  await manage(c.id, o.id, p.id, "approve");
  assert.equal((await clubDetail(db, c.id)).memberCount, 2);
  assert.equal((await publicClubBadges(db, [p.id])).get(p.id)?.total, 1);
  assert.equal((await clubMembers(db, c.id, p.id)).members.length, 2);
  await assert.rejects(
    clubMembers(db, c.id, p.id, 1, true),
    (e) => e instanceof CommunityError && e.status === 403,
  );
});
test("open joining and invitations require explicit action; revoked or expired invitations cannot activate", async () => {
  const o = await owner(),
    p = await person(),
    c = await club(o.id, true);
  assert.equal((await clubDetail(db, c.id, p.id)).membership, null);
  await manage(c.id, o.id, p.id, "invite");
  assert.equal((await clubDetail(db, c.id, p.id)).membership?.state, "invited");
  assert.equal((await publicClubBadges(db, [p.id])).get(p.id)?.total, 0);
  await manage(c.id, o.id, p.id, "revoke-invite");
  await assert.rejects(
    act(c.id, p.id, "accept-invite"),
    /истекло или отозвано/,
  );
  await manage(c.id, o.id, p.id, "invite");
  await db.query(
    "UPDATE club_memberships SET invite_expires_at=now()-interval '1 second' WHERE club_id=$1 AND user_id=$2",
    [c.id, p.id],
  );
  await assert.rejects(
    act(c.id, p.id, "accept-invite"),
    /истекло или отозвано/,
  );
  await manage(c.id, o.id, p.id, "invite");
  await act(c.id, p.id, "accept-invite");
  await act(c.id, p.id, "accept-invite");
  assert.equal((await clubDetail(db, c.id)).memberCount, 2);
  await act(c.id, p.id, "leave");
  assert.equal((await publicClubBadges(db, [p.id])).get(p.id)?.total, 0);
  await act(c.id, p.id, "join");
  assert.equal((await clubDetail(db, c.id, p.id)).membership?.state, "active");
});
test("role scope protects owner/equal admins and rejects stale roles and foreign IDs", async () => {
  const o = await owner(),
    admin = await person(),
    peer = await person(),
    organizer = await person(),
    c = await club(o.id, true),
    other = await club(o.id, true);
  for (const p of [admin, peer, organizer]) await act(c.id, p.id, "join");
  await manage(c.id, o.id, admin.id, "role", "admin");
  await manage(c.id, o.id, peer.id, "role", "admin");
  await assert.rejects(
    manage(c.id, admin.id, peer.id, "exclude"),
    /другого администратора/,
  );
  await assert.rejects(manage(c.id, admin.id, o.id, "block"), /владельца/);
  await assert.rejects(
    manage(c.id, admin.id, organizer.id, "role", "admin"),
    /назначает владелец/,
  );
  await manage(c.id, admin.id, organizer.id, "role", "organizer");
  await assert.rejects(
    manage(other.id, admin.id, organizer.id, "role", "organizer"),
    /администрации/,
  );
  await manage(c.id, o.id, admin.id, "role", "member");
  await assert.rejects(
    manage(c.id, admin.id, organizer.id, "exclude"),
    /администрации/,
  );
  await assert.rejects(act(c.id, o.id, "leave"), /передайте владение/);
});
test("club exclusion revokes old invitation; blocking prevents rejoin until an explicit new decision", async () => {
  const o = await owner(),
    p = await person(),
    c = await club(o.id, true);
  await manage(c.id, o.id, p.id, "invite");
  await manage(c.id, o.id, p.id, "exclude");
  await assert.rejects(act(c.id, p.id, "accept-invite"), /отозвано/);
  await manage(c.id, o.id, p.id, "block");
  await assert.rejects(act(c.id, p.id, "join"), /недоступно/);
  await assert.rejects(manage(c.id, o.id, p.id, "invite"), /снимите/);
  await manage(c.id, o.id, p.id, "unblock");
  assert.equal(
    (await clubDetail(db, c.id, p.id)).membership?.state,
    "excluded",
  );
  await manage(c.id, o.id, p.id, "invite");
  await act(c.id, p.id, "accept-invite");
  assert.equal((await clubDetail(db, c.id, p.id)).membership?.role, "member");
});
test("ownership stays with the original owner until explicit acceptance and cannot bypass quota", async () => {
  const o = await owner(),
    next = await owner(),
    p = await person();
  let c = await club(o.id, true);
  await act(c.id, next.id, "join");
  await act(c.id, p.id, "join");
  c = await db.transaction((q) =>
    transferClub(q, c.id, o.id, {
      action: "offer",
      targetId: next.id,
      version: c.version,
    }),
  );
  assert.equal(c.membership?.role, "owner");
  assert.equal(
    (await clubDetail(db, c.id, next.id)).ownershipOffer !== null,
    true,
  );
  assert.equal((await clubDetail(db, c.id, p.id)).ownershipOffer, null);
  await assert.rejects(
    db.transaction((q) =>
      transferClub(q, c.id, p.id, { action: "accept", version: c.version }),
    ),
    /Предложение/,
  );
  for (let i = 0; i < 3; i++) await club(next.id);
  await assert.rejects(
    db.transaction((q) =>
      transferClub(q, c.id, next.id, { action: "accept", version: c.version }),
    ),
    /три действующих клуба/,
  );
  assert.equal((await clubDetail(db, c.id, o.id)).membership?.role, "owner");
  const owned = (
    await db.query<{ id: string; version: number }>(
      "SELECT id,version FROM clubs WHERE owner_id=$1 AND id<>$2 LIMIT 1",
      [next.id, c.id],
    )
  ).rows[0];
  await db.transaction((q) =>
    setClubArchived(q, owned.id, next.id, {
      archived: true,
      version: owned.version,
    }),
  );
  c = await db.transaction((q) =>
    transferClub(q, c.id, next.id, { action: "accept", version: c.version }),
  );
  assert.equal(c.membership?.role, "owner");
  assert.equal((await clubDetail(db, c.id, o.id)).membership?.role, "admin");
  assert.equal(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM club_memberships WHERE club_id=$1 AND role='owner'",
        [c.id],
      )
    ).rows[0].n,
    1,
  );
  await act(c.id, o.id, "leave");
  assert.equal((await clubDetail(db, c.id, o.id)).canManage, false);
});
test("archive cancels pending invitations/applications/transfers; restore does not revive them", async () => {
  const o = await owner(),
    invitee = await person(),
    pending = await person(),
    next = await owner();
  let c = await club(o.id);
  await act(c.id, pending.id, "join");
  await manage(c.id, o.id, invitee.id, "invite");
  await act(c.id, next.id, "join");
  await manage(c.id, o.id, next.id, "approve");
  c = await db.transaction((q) =>
    transferClub(q, c.id, o.id, {
      action: "offer",
      targetId: next.id,
      version: c.version,
    }),
  );
  c = await db.transaction((q) =>
    setClubArchived(q, c.id, o.id, { archived: true, version: c.version }),
  );
  assert.equal(
    (await publicClubBadges(db, [o.id, next.id])).get(o.id)?.total,
    0,
  );
  await assert.rejects(act(c.id, invitee.id, "accept-invite"), /архиве/);
  c = await db.transaction((q) =>
    setClubArchived(q, c.id, o.id, { archived: false, version: c.version }),
  );
  await assert.rejects(act(c.id, invitee.id, "accept-invite"), /отозвано/);
  assert.equal(
    (await clubDetail(db, c.id, pending.id)).membership?.state,
    "left",
  );
  assert.equal((await clubDetail(db, c.id, next.id)).ownershipOffer, null);
  await assert.rejects(
    clubAdministrativeState(db, c.id, next.id),
    /администрации/,
  );
});
test("badge visibility/order are shared, batch reads bounded and hidden membership never enters totals", async () => {
  const o = await owner(),
    member = await person();
  const a = await club(o.id, true),
    b = await club(o.id, true),
    c = await club(o.id, true);
  for (const row of [a, b, c]) await act(row.id, member.id, "join");
  await db.transaction((q) =>
    saveBadgePreferences(q, member.id, {
      clubs: [
        { id: c.id, visible: true },
        { id: a.id, visible: false },
        { id: b.id, visible: true },
      ],
    }),
  );
  const badges = (await publicClubBadges(db, [member.id])).get(member.id)!;
  assert.equal(badges.total, 2);
  assert.deepEqual(
    badges.items.map((c) => c.id),
    [c.id, b.id],
  );
  assert.ok(!JSON.stringify(badges).includes(a.id));
  assert.equal(
    (await ownBadgePreferences(db, member.id)).clubs.find((c) => c.id === a.id)
      ?.visible,
    false,
  );
  await assert.rejects(
    db.transaction((q) =>
      saveBadgePreferences(q, member.id, {
        clubs: [{ id: randomUUID(), visible: true }],
      }),
    ),
    /Состав клубов изменился/,
  );
  const sql = (
    await db.query<{ badges: typeof badges }>(
      `SELECT ${publicClubBadgesSql("$1::uuid")} badges`,
      [member.id],
    )
  ).rows[0].badges;
  assert.deepEqual(sql, badges);
  await manage(c.id, o.id, member.id, "block");
  const after = (await publicClubBadges(db, [member.id])).get(member.id)!;
  assert.equal(after.total, 1);
  assert.deepEqual(
    after.items.map((c) => c.id),
    [b.id],
  );
});
test("loss of email verification stops new joining but does not prevent leaving or hiding a badge", async () => {
  const o = await owner(),
    p = await person(),
    c = await club(o.id, true);
  await act(c.id, p.id, "join");
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [p.id]);
  await db.transaction((q) =>
    saveBadgePreferences(q, p.id, { clubs: [{ id: c.id, visible: false }] }),
  );
  assert.equal((await publicClubBadges(db, [p.id])).get(p.id)?.total, 0);
  await act(c.id, p.id, "leave");
  await assert.rejects(act(c.id, p.id, "join"), /Подтвердите почту/);
});
test("administrative reads recheck a role revoked after the initial public detail", async () => {
  const o = await owner(),
    admin = await person(),
    c = await club(o.id, true);
  await act(c.id, admin.id, "join");
  const race = () => {
    let revoked = false;
    return {
      async query<Row extends object>(text: string, values?: unknown[]) {
        const result = await db.query<Row>(text, values);
        if (
          !revoked &&
          text.includes("member_count") &&
          text.includes("FROM clubs c")
        ) {
          revoked = true;
          await db.query(
            "UPDATE club_memberships SET role='member' WHERE club_id=$1 AND user_id=$2",
            [c.id, admin.id],
          );
        }
        return result;
      },
    };
  };
  await manage(c.id, o.id, admin.id, "role", "admin");
  assert.equal(
    (await clubMembers(race(), c.id, admin.id, 1, true)).members.length,
    0,
  );
  await manage(c.id, o.id, admin.id, "role", "admin");
  await assert.rejects(
    clubAdministrativeState(race(), c.id, admin.id),
    (e) => e instanceof CommunityError && e.status === 403,
  );
});
