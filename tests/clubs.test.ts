import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { invalid } from "./support/negative.ts";
import {
  createClub,
  clubCreateInput,
  clubDetail,
  clubList,
  clubEligibility,
  editClub,
  editClubRules,
} from "../lib/clubs.ts";
import { removeAccount } from "../lib/account-data.ts";
import { CommunityError } from "../lib/community-validation.ts";
import { EmailPolicyError } from "../lib/email-policy.ts";
const db = await testDatabase();
after(() => db.close());
async function owner() {
  const user = await userRow(db, { email_verified_at: new Date() });
  await bikeRow(db, user.id, { is_public: false });
  return user;
}
const input = (name = "Клуб для совместных поездок") =>
  clubCreateInput.parse({
    name,
    requestId: randomUUID(),
    mission: "## Вместе\nЕздим по выходным.",
  });
const create = (user: string, data = input()) =>
  db.transaction((q) => createClub(q, user, data));
test("creation needs a current verified account and any owned bike", async () => {
  const unverified = await userRow(db, { email_verified_at: null });
  await bikeRow(db, unverified.id);
  await assert.rejects(create(unverified.id), EmailPolicyError);
  const noBike = await userRow(db, { email_verified_at: new Date() });
  await assert.rejects(create(noBike.id), /Добавьте собственный велосипед/);
  const blocked = await owner();
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked.id]);
  await assert.rejects(create(blocked.id), /Аккаунт недоступен/);
  const user = await owner(),
    club = await create(user.id);
  assert.equal(club.membership?.role, "owner");
  assert.equal(club.memberCount, 1);
  assert.equal(club.joinMode, "application");
  assert.equal(club.membersVisibility, "members");
  await db.query("DELETE FROM bikes WHERE owner_id=$1", [user.id]);
  assert.equal((await clubDetail(db, club.id)).name, club.name);
});
test("retries use a per-owner key and cannot silently change the first request", async () => {
  const user = await owner(),
    data = input(),
    club = await create(user.id, data);
  assert.equal((await create(user.id, data)).id, club.id);
  await assert.rejects(
    create(user.id, { ...data, name: "Другой клуб" }),
    (e) => e instanceof CommunityError && e.status === 409,
  );
  const other = await owner();
  assert.notEqual((await create(other.id, data)).id, club.id);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM clubs WHERE owner_id=$1",
        [user.id],
      )
    ).rows[0].n,
    1,
  );
});
test("quota counts nonarchived ownership, including hidden clubs; membership elsewhere costs nothing", async () => {
  const user = await owner(),
    clubs = [];
  for (let i = 0; i < 3; i++) clubs.push(await create(user.id));
  await db.query("UPDATE clubs SET hidden_at=now() WHERE id=$1", [clubs[0].id]);
  await assert.rejects(create(user.id), /три действующих клуба/);
  assert.equal((await clubEligibility(db, user.id)).owned, 3);
  await db.query("UPDATE clubs SET archived_at=now() WHERE id=$1", [
    clubs[0].id,
  ]);
  assert.ok((await create(user.id)).id);
  const other = await owner(),
    foreign = await create(other.id);
  await db.query(
    "INSERT INTO club_memberships(club_id,user_id,role,state) VALUES($1,$2,'admin','active')",
    [foreign.id, user.id],
  );
  assert.equal((await clubEligibility(db, user.id)).owned, 3);
});
test("rules and details use current roles and a shared optimistic version", async () => {
  const user = await owner(),
    club = await create(user.id),
    outsider = await owner();
  const details = {
    name: "Новое имя",
    slogan: "Поездки по субботам",
    city: "Казань",
    formats: ["гравий"],
    mission: "Общее дело",
    joinMode: "application" as const,
    membersVisibility: "members" as const,
    version: club.version,
  };
  await assert.rejects(
    db.transaction((q) => editClub(q, club.id, outsider.id, details)),
    (e) => e instanceof CommunityError && e.status === 403,
  );
  const changed = await db.transaction((q) =>
    editClub(q, club.id, user.id, details),
  );
  assert.equal(changed.id, club.id);
  await assert.rejects(
    db.transaction((q) =>
      editClubRules(q, club.id, user.id, {
        body: "Старые правила",
        version: club.version,
      }),
    ),
    (e) => e instanceof CommunityError && e.status === 409,
  );
  await db.query(
    "INSERT INTO club_memberships(club_id,user_id,role,state) VALUES($1,$2,'admin','active')",
    [club.id, outsider.id],
  );
  const rules = await db.transaction((q) =>
    editClubRules(q, club.id, outsider.id, {
      body: "## Правила\nНе оставляйте мусор.",
      version: changed.version,
    }),
  );
  assert.ok(rules.rulesUpdatedAt);
  assert.equal(rules.rulesDoc.type, "doc");
  await db.query(
    "UPDATE club_memberships SET role='member' WHERE club_id=$1 AND user_id=$2",
    [club.id, outsider.id],
  );
  await assert.rejects(
    db.transaction((q) =>
      editClubRules(q, club.id, outsider.id, {
        body: "Устаревшая вкладка",
        version: rules.version,
      }),
    ),
    (e) => e instanceof CommunityError && e.status === 403,
  );
});
test("public detail and catalog do not reveal the member list, requests or account email", async () => {
  const user = await owner(),
    club = await create(user.id),
    pending = await owner();
  await db.query(
    "INSERT INTO club_memberships(club_id,user_id,state) VALUES($1,$2,'pending')",
    [club.id, pending.id],
  );
  const publicClub = await clubDetail(db, club.id);
  assert.equal(publicClub.membership, null);
  assert.equal(publicClub.memberCount, 1);
  assert.equal(publicClub.canManage, false);
  const payload = JSON.stringify(publicClub);
  assert.ok(!payload.includes(user.email));
  assert.ok(!payload.includes(pending.id));
  assert.ok(!payload.includes(user.id));
  assert.equal(
    (await clubDetail(db, club.id, pending.id)).membership?.state,
    "pending",
  );
  assert.ok(
    (await clubList(db, null, { search: club.name })).clubs.some(
      (c) => c.id === club.id,
    ),
  );
  await assert.rejects(
    clubList(db, null, { own: true }),
    (e) => e instanceof CommunityError && e.status === 401,
  );
  await db.query("UPDATE clubs SET hidden_at=now() WHERE id=$1", [club.id]);
  await assert.rejects(
    clubDetail(db, club.id, user.id),
    (e) => e instanceof CommunityError && e.status === 404,
  );
  assert.ok(
    !(await clubList(db, null, { search: club.name })).clubs.some(
      (c) => c.id === club.id,
    ),
  );
});
test("blocked owners hide public clubs; revoked admin and archived clubs cannot mutate", async () => {
  const user = await owner(),
    club = await create(user.id);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [user.id]);
  await assert.rejects(clubDetail(db, club.id), /Клуб недоступен/);
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [user.id]);
  await db.query("UPDATE clubs SET archived_at=now() WHERE id=$1", [club.id]);
  assert.equal((await clubDetail(db, club.id)).archived, true);
  await assert.rejects(
    db.transaction((q) =>
      editClubRules(q, club.id, user.id, { body: "Правила", version: 1 }),
    ),
    (e) => e instanceof CommunityError && e.status === 403,
  );
});
test("invalid input never trusts role, author, HTML images or oversized content", async () => {
  const user = await owner();
  assert.equal(
    clubCreateInput.safeParse({ ...input(), role: "owner" }).success,
    false,
  );
  assert.equal(
    clubCreateInput.safeParse({ ...input(), name: "\0" }).success,
    false,
  );
  await assert.rejects(
    create(user.id, invalid({ ...input(), name: "x".repeat(81) })),
  );
  const club = await create(user.id, {
    ...input(),
    mission: '<img src="https://evil.test/x" onerror="alert(1)">',
  });
  assert.deepEqual(
    club.missionDoc.content?.map((n) => n.type),
    ["paragraph"],
  );
  assert.ok(
    club.missionDoc.content?.[0].content?.every((n) => n.type === "text"),
  );
});
test("account deletion must resolve active owned clubs and retains archived history", async () => {
  const user = await owner(),
    club = await create(user.id);
  assert.equal(
    (await db.transaction((q) => removeAccount(q, user.id))).status,
    409,
  );
  await db.query("UPDATE clubs SET archived_at=now() WHERE id=$1", [club.id]);
  assert.equal(
    (await db.transaction((q) => removeAccount(q, user.id))).ok,
    true,
  );
  assert.equal((await clubDetail(db, club.id)).archived, true);
  assert.equal((await clubDetail(db, club.id)).memberCount, 0);
});
