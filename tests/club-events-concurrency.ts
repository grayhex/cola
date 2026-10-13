import assert from "node:assert/strict";
import { db, transaction } from "../lib/db.ts";
import { issueChatToken } from "../lib/chat.ts";
import {
  syncClubRevocation,
  syncClubChannel,
  clubChannelId,
} from "../lib/club-chat.ts";
import { fixtureProvider } from "./fixtures/chat-provider.js";
import { clubDetail, setClubArchived } from "../lib/clubs.ts";
import { sessionRow, viewer } from "./support/people.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow } from "./support/clubs.ts";
import { changeMembership, manageClubMember } from "../lib/club-membership.ts";
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
  // Exercise the real users → clubs → revocation-row order: an archive waits
  // while token issuance is paused inside its vendor revoke call.
  process.env.STREAM_CHAT_ENABLED = "true";
  process.env.STREAM_CHAT_API_KEY = "test-key";
  process.env.STREAM_CHAT_API_SECRET = "test-secret";
  await transaction((q) =>
    changeMembership(q, club.id, applicant.id, { action: "join" }),
  );
  const pending = await clubDetail(db, club.id, owner.id);
  await transaction((q) =>
    manageClubMember(q, club.id, owner.id, applicant.id, {
      action: "approve",
    }),
  );
  await sessionRow(db, applicant.id, { token_hash: applicant.id });
  await transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: true,
      version: pending.version,
    }),
  );
  const archived = await clubDetail(db, club.id, owner.id);
  await transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: false,
      version: archived.version,
    }),
  );
  const restored = await clubDetail(db, club.id, owner.id),
    provider = fixtureProvider();
  let release: () => void = () => {},
    seen: () => void = () => {};
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    entered = new Promise<void>((r) => {
      seen = r;
    });
  const original = provider.revokeUserToken.bind(provider);
  provider.revokeUserToken = async (...args) => {
    seen();
    await gate;
    return original(...args);
  };
  const tokenJob = transaction((q) =>
    issueChatToken(q, viewer(applicant), applicant.id, provider),
  );
  await entered;
  const archiveJob = transaction(async (q) => {
    await q.query("SELECT set_config('application_name',$1,true)", [
      "club-archive-" + club.id,
    ]);
    return setClubArchived(q, club.id, owner.id, {
      archived: true,
      version: restored.version,
    });
  });
  let waiting = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    waiting = !!(
      await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
        ["club-archive-" + club.id],
      )
    ).rowCount;
    if (waiting) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  release();
  const [token] = await Promise.all([tokenJob, archiveJob]);
  assert.equal(waiting, true, "archive reached a real PostgreSQL lock wait");
  provider.revokeUserToken = original;
  const revoke = (
    await db.query<{ revision: string }>(
      "SELECT revision::text FROM club_chat_revocations WHERE club_id=$1 AND user_id=$2",
      [club.id, applicant.id],
    )
  ).rows[0];
  assert.ok(revoke);
  await transaction((q) =>
    syncClubRevocation(q, club.id, applicant.id, revoke.revision, provider),
  );
  await transaction((q) => syncClubChannel(q, club.id, provider));
  await assert.rejects(
    provider
      .asClient(token.token)
      .channel("colabike", clubChannelId(club.id))
      .watch(),
    /denied|revoked/i,
  );
  console.log(
    "Club chat PostgreSQL: token and archive serialize without a revocation-row/club deadlock; the archive revokes that newly issued JWT.",
  );
} finally {
  await db.query("DELETE FROM clubs WHERE id=$1", [club.id]);
  await db.query("DELETE FROM bikes WHERE id=$1", [bike.id]);
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner.id, applicant.id],
  ]);
  await db.end();
}
