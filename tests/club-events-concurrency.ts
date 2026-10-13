import assert from "node:assert/strict";
import { db, transaction } from "../lib/db.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow } from "./support/clubs.ts";
import { changeMembership } from "../lib/club-membership.ts";
import { deliverClubEvent } from "../lib/club-events.ts";
import { notificationPage } from "../lib/notifications.ts";
const owner = await userRow(db, { email_verified_at: new Date() }),
  applicant = await userRow(db, { email_verified_at: new Date() });
const bike = await bikeRow(db, owner.id);
const club = await transaction((q) =>
  clubRow(q, owner.id, { joinMode: "application" }),
);
try {
  await transaction((q) =>
    changeMembership(q, club.id, applicant.id, { action: "join" }),
  );
  const event = (
    await db.query<{ id: string }>(
      "SELECT id FROM club_event_outbox WHERE club_id=$1 AND kind='membership'",
      [club.id],
    )
  ).rows[0];
  assert.ok(event);
  const outcomes = await Promise.all([
    transaction((q) => deliverClubEvent(q, event.id)),
    transaction((q) => deliverClubEvent(q, event.id)),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(
    (
      await db.query("SELECT 1 FROM notifications WHERE club_event_id=$1", [
        event.id,
      ])
    ).rowCount,
    1,
  );
  await transaction((q) =>
    changeMembership(q, club.id, applicant.id, { action: "cancel" }),
  );
  await transaction((q) =>
    changeMembership(q, club.id, applicant.id, { action: "join" }),
  );
  const next = (
    await db.query<{ id: string }>(
      "SELECT id FROM club_event_outbox WHERE club_id=$1 AND delivered_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [club.id],
    )
  ).rows[0];
  assert.ok(next);
  await Promise.all([
    transaction((q) => deliverClubEvent(q, next.id)),
    transaction((q) =>
      changeMembership(q, club.id, applicant.id, { action: "cancel" }),
    ),
  ]);
  assert.equal(
    (await notificationPage(db, owner.id)).notifications.filter(
      (n) => n.type === "club_application",
    ).length,
    0,
  );
  console.log(
    "Club events PostgreSQL: overlapping workers deliver once; withdrawal versus materialization commits without stale inbox or deadlock.",
  );
} finally {
  await db.query("DELETE FROM clubs WHERE id=$1", [club.id]);
  await db.query("DELETE FROM bikes WHERE id=$1", [bike.id]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner.id, applicant.id],
  ]);
  await db.end();
}
