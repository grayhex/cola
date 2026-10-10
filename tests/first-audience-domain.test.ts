import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase, seedSiteDefaults } from "./support/database.ts";
import { userRow, sessionRow, viewer } from "./support/people.ts";
import { bikeRow, photoRow, componentRow } from "./support/bikes.ts";
import { present } from "./support/assertions.ts";
import {
  planInput,
  planRide,
  rideDefaults,
  rideDetail,
  rideEdit,
  saveRide,
  respondRide,
} from "../lib/rides.ts";
import { undecidedPlanPlace } from "../lib/ride-plan.ts";
import { records, awardShelf } from "../lib/gamification.ts";
import { homeRecords } from "../lib/gamification-presentation.ts";
import { bikeSubtitle } from "../lib/garage-layout.ts";
import { getSite } from "../lib/site.ts";
import { visibleBikeById } from "../lib/showcase.ts";
import {
  createChatChannel,
  leaveChatChannel,
  leaveChannelInput,
} from "../lib/chat.ts";
import { streamUserId } from "../lib/chat-config.ts";
import { fixtureProvider } from "./fixtures/chat-provider.js";

test("new public plans require a coarse place; legacy edits and private plans remain usable; stale place RSVP cannot accept", async () => {
  const q = await testDatabase();
  try {
    const a = await userRow(q, { email_verified_at: new Date() }),
      b = await userRow(q, { email_verified_at: new Date() }),
      bike = await bikeRow(q, a.id);
    const input = planInput.parse({
      bikeId: bike.id,
      title: "Будущий круг",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await assert.rejects(
      planRide(q, a.id, input, rideDefaults),
      /Укажите город/,
    );
    const privatePlan = await planRide(
      q,
      a.id,
      { ...input, isPublic: false },
      rideDefaults,
    );
    // A legacy public plan can be edited without inventing a geography.
    await q.query("UPDATE rides SET is_public=true WHERE id=$1", [
      privatePlan.id,
    ]);
    await saveRide(
      q,
      a.id,
      rideEdit.parse({ ...input, description: "Опечатка исправлена" }),
      rideDefaults,
      privatePlan.id,
    );
    const made = await planRide(
      q,
      a.id,
      {
        ...input,
        passport: { area: { label: undecidedPlanPlace } },
        meetingPoint: "Вход 1",
        meetingVisibility: "participants",
      },
      rideDefaults,
    );
    const before = present(await rideDetail(q, made.shareId, b.id));
    assert.equal(before.meetingPoint, "");
    await saveRide(
      q,
      a.id,
      rideEdit.parse({
        ...input,
        passport: { area: { label: "Новый парк" } },
        meetingPoint: "Вход 7",
        meetingVisibility: "participants",
      }),
      rideDefaults,
      made.id,
    );
    await assert.rejects(
      respondRide(
        q,
        made.id,
        b.id,
        "accepted",
        before.scheduledAt ? new Date(before.scheduledAt).toISOString() : null,
        false,
        present(before.agreement).revision,
      ),
      /Условия/,
    );
    const fresh = present(await rideDetail(q, made.shareId, b.id));
    assert.equal(fresh.meetingPoint, "");
    assert.equal(fresh.passport?.area?.label, "Новый парк");
    await respondRide(
      q,
      made.id,
      b.id,
      "accepted",
      new Date(present(fresh.scheduledAt)).toISOString(),
      false,
      present(fresh.agreement).revision,
    );
    assert.equal(
      present(await rideDetail(q, made.shareId, b.id)).meetingPoint,
      "Вход 7",
    );
    await respondRide(q, made.id, b.id, "declined");
  } finally {
    await q.close();
  }
});

test("comparison needs two public measured bikes, handles ties/hiding and leaves earned awards intact", async () => {
  const q = await testDatabase();
  try {
    await seedSiteDefaults(q);
    const a = await userRow(q, { email_verified_at: new Date() }),
      b = await userRow(q, { email_verified_at: new Date() });
    const gravel = async () =>
      (await records(q)).records.filter((r) =>
        ["lightest_gravel", "heavy"].includes(r.key),
      );
    assert.ok((await gravel()).every((r) => r.eligible === 0 && !r.holder));
    const first = await bikeRow(q, a.id, { weight: 8 });
    await photoRow(q, first.id);
    const earned = await awardShelf(q, { userId: a.id, privateView: true });
    assert.ok(earned.length);
    assert.ok((await gravel()).every((r) => r.eligible === 1 && !r.holder));
    assert.ok(
      homeRecords((await records(q)).records).every(
        (r) => !r.key.endsWith("_gravel"),
      ),
    );
    await bikeRow(q, b.id, { weight: 0 }); // Invalid metric does not count.
    const second = await bikeRow(q, b.id, { weight: 12 });
    await photoRow(q, second.id);
    let compared = await gravel();
    assert.equal(
      compared.find((r) => r.key === "lightest_gravel")?.holder?.id,
      first.id,
    );
    assert.equal(
      compared.find((r) => r.key === "heavy")?.holder?.id,
      second.id,
    );
    await q.query("UPDATE bikes SET weight=8 WHERE id=$1", [second.id]);
    compared = await gravel();
    assert.ok(compared.every((r) => r.eligible === 2 && r.holder?.value === 8));
    assert.equal(compared[0].holder?.id, compared[1].holder?.id);
    await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [second.id]);
    assert.ok((await gravel()).every((r) => r.eligible === 1 && !r.holder));
    assert.deepEqual(
      await awardShelf(q, { userId: a.id, privateView: true }),
      earned,
    );
  } finally {
    await q.close();
  }
});

test("bike summary uses two unique drivetrain names while keeping both real installations", async () => {
  const q = await testDatabase();
  try {
    await seedSiteDefaults(q);
    const owner = await userRow(q, { email_verified_at: new Date() }),
      bike = await bikeRow(q, owner.id);
    for (const [name, sort_order] of [
      ["SRAM GX Eagle", 0],
      [" SRAM GX Eagle ", 1],
      ["", 2],
      ["Shimano XT", 3],
    ] as const)
      await componentRow(q, bike.id, { category: "Групсет", name, sort_order });
    const site = await getSite(q),
      dto = present(await visibleBikeById(q, bike.id, owner.id, site));
    assert.match(
      bikeSubtitle(dto, site.catalog),
      /SRAM GX Eagle · Shimano XT$/,
    );
    assert.equal(dto.components.length, 4);
  } finally {
    await q.close();
  }
});

test("leaving a group removes only the current member and stays left; missing membership/session and DM mutations fail", async () => {
  const q = await testDatabase();
  try {
    const a = await userRow(q, { email_verified_at: new Date() }),
      b = await userRow(q, { email_verified_at: new Date() }),
      c = await userRow(q, { email_verified_at: new Date() });
    const session = await sessionRow(q, a.id),
      otherSession = await sessionRow(q, b.id),
      provider = fixtureProvider();
    const av = viewer({ ...a }),
      bv = viewer({ ...b });
    const made = await createChatChannel(
      q,
      av,
      { kind: "group", name: "Группа", members: [b.id, c.id] },
      session.token_hash,
      provider,
    );
    assert.equal(
      leaveChannelInput.safeParse({ cid: made.cid, userId: c.id }).success,
      false,
    );
    assert.equal(
      leaveChannelInput.safeParse({ cid: "colabike:dm_" + "a".repeat(40) })
        .success,
      false,
    );
    await assert.rejects(
      leaveChatChannel(q, bv, { cid: made.cid }, null, provider),
      /Войдите/,
    );
    await leaveChatChannel(
      q,
      bv,
      { cid: made.cid },
      otherSession.token_hash,
      provider,
    );
    const remaining = present(provider.channels.get(made.cid)).members.map(
      (member) => member.user_id,
    );
    assert.deepEqual(remaining, [streamUserId(a.id), streamUserId(c.id)]);
    await assert.rejects(
      leaveChatChannel(
        q,
        bv,
        { cid: made.cid },
        otherSession.token_hash,
        provider,
      ),
      /недоступен/,
    );
    await assert.rejects(
      leaveChatChannel(
        q,
        av,
        { cid: "colabike:group_" + "a".repeat(32) },
        session.token_hash,
        provider,
      ),
      /недоступен/,
    );
  } finally {
    await q.close();
  }
});
