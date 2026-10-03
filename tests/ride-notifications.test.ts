import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import type { MailMessage } from "../lib/mail.ts";
import {
  planRide,
  planInput,
  rideDefaults,
  respondRide,
  cancelPlannedRide,
  saveRide,
  rideEdit,
  rideDetail,
} from "../lib/rides.ts";
import { notificationPage, readNotifications } from "../lib/notifications.ts";
import { saveNotificationEmail } from "../lib/notification-preferences.ts";
import { runNotificationEmailBatch } from "../lib/notification-email.ts";
import { releaseRideReminders, rideNotice } from "../lib/ride-notifications.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";
import { ownerFields } from "./support/rides.ts";
import { present } from "./support/assertions.ts";
import { one } from "./support/rows.ts";
import { inviteFromInterest } from "../lib/ride-matching.ts";
import { createIntent } from "../lib/ride-intents.ts";
const hour = 3600000,
  env = processEnv({
    MAIL_CAPTURE_DIR: "/tmp/cola-ride-mail-test",
    APP_ORIGIN: "https://cola.example.test",
  });
const on = {
  enabled: true,
  discussions: false,
  rides: true,
  market: false,
  reminders: true,
};
const at = (h: number) =>
  new Date(Math.floor((Date.now() + h * hour) / 60000) * 60000).toISOString();
type PlannedRide = Awaited<ReturnType<typeof planRide>>;
async function setup() {
  const db = await testDatabase(),
    old = process.env.MAIL_CAPTURE_DIR;
  process.env.MAIL_CAPTURE_DIR = env.MAIL_CAPTURE_DIR;
  const user = async (name: string) =>
    (
      await userRow(db, {
        username: name,
        name,
        email_verified_at: new Date(),
      })
    ).id;
  const owner = await user("organizer"),
    rider = await user("rider"),
    bike = (
      await bikeRow(db, owner, {
        name: "Bike",
        brand: "Cube",
        model: "Travel",
        year: 2020,
        category: "road",
        weight: 14,
      })
    ).id;
  await saveNotificationEmail(db, rider, on, env);
  const tx = db.transaction;
  const plan = async (changes?: Partial<z.input<typeof planInput>>) =>
    tx((q) =>
      planRide(
        q,
        owner,
        planInput.parse({
          bikeId: bike,
          title: "Hidden ride name",
          scheduledAt: at(48),
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
          meetingPoint: "SECRET HOME",
          passport: {
            area: { label: "Москва" },
            purpose: "social",
            pace: "relaxed",
          },
          ...changes,
        }),
        rideDefaults,
      ),
    );
  const edit = async (
    ride: PlannedRide,
    changes: Partial<z.input<typeof rideEdit>>,
  ) =>
    tx(async (q) => {
      const r = await rideDetail(q, ride.shareId, owner, true);
      const owned = ownerFields.parse(r);
      return saveRide(
        q,
        owner,
        rideEdit.parse({
          bikeId: bike,
          title: r.title,
          description: r.description,
          isPublic: r.isPublic,
          privacyEnabled: owned.privacyEnabled,
          privacyRadiusM: owned.privacyRadiusM,
          ...changes,
        }),
        rideDefaults,
        ride.id,
      );
    });
  const unlock = async () =>
    db.query(
      "UPDATE notification_email_preferences SET next_delivery_at=now()",
    );
  return {
    db,
    tx,
    owner,
    rider,
    bike,
    plan,
    edit,
    unlock,
    close: async () => {
      if (old === undefined) delete process.env.MAIL_CAPTURE_DIR;
      else process.env.MAIL_CAPTURE_DIR = old;
      await db.close();
    },
  };
}
test("ride event + email is atomic, revision-bound and coalesces organizer responses", async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.tx(async (q) => {
        await planRide(
          q,
          s.owner,
          planInput.parse({
            bikeId: s.bike,
            title: "Rollback",
            scheduledAt: at(48),
            isPublic: true,
            privacyEnabled: true,
            privacyRadiusM: 500,
            invitations: ["rider"],
          }),
          rideDefaults,
        );
        throw Error("rollback");
      }),
    );
    assert.equal(
      (await s.db.query("SELECT count(*)::int n FROM notifications")).rows[0].n,
      0,
    );
    const ride = await s.plan({ invitations: ["rider"] }),
      notices = await notificationPage(s.db, s.rider);
    assert.equal(
      notices.notifications.filter((n) => n.type === "ride_invite").length,
      1,
    );
    await s.tx((q) =>
      rideNotice(q, ride.id, "ride_invite", { recipients: [s.rider] }),
    );
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      1,
    );
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await s.tx((q) => respondRide(q, ride.id, s.rider, "maybe"));
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='ride_response'",
        )
      ).rows[0].n,
      1,
    );
    await s.edit(ride, { title: "Changed title" });
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='ride_changed'",
        )
      ).rows[0].n,
      0,
    );
    await s.edit(ride, { meetingPoint: "OTHER SECRET HOME" });
    assert.equal(
      (await notificationPage(s.db, s.rider)).notifications.filter(
        (n) => n.type === "ride_changed",
      ).length,
      1,
    );
    assert.equal(
      (await rideDetail(s.db, ride.shareId, s.rider)).participation,
      "reconfirm",
    );
    await s.unlock();
    const mail: MailMessage[] = [];
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async (m) => mail.push(m),
        })
      ).sent,
      1,
    );
    assert(mail[0].subject.includes("договорённости"));
    assert(!mail[0].text.includes("SECRET HOME"));
    assert(
      !JSON.stringify(
        (await s.db.query("SELECT * FROM notification_email_outbox")).rows,
      ).includes("Hidden ride"),
    );
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await s.tx((q) => cancelPlannedRide(q, ride.id, s.owner));
    await s.unlock();
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async (m) => mail.push(m),
        })
      ).sent,
      1,
    );
    assert(present(mail.at(-1)).subject.includes("отменена"));
    assert.equal(
      (await notificationPage(s.db, s.rider)).notifications.filter(
        (n) => n.type === "ride_reminder",
      ).length,
      0,
    );
  } finally {
    await s.close();
  }
});
test("one default reminder, fake clock, late join, downtime and SMTP-disabled in-app", async () => {
  const s = await setup();
  try {
    const start = at(48),
      ride = await s.plan({ scheduledAt: start });
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    const before = new Date(+new Date(start) - 24 * hour - 1),
      due = new Date(+before + 1),
      mail: MailMessage[] = [];
    await readNotifications(s.db, s.rider);
    const scheduled = await one<{ id: string; read_at: Date | null }>(
      s.db,
      "SELECT id,read_at FROM notifications WHERE ride_id=$1 AND type='ride_reminder'",
      [ride.id],
    );
    assert.equal(
      scheduled.read_at,
      null,
      "read-all cannot consume a future reminder",
    );
    assert.equal(await readNotifications(s.db, s.rider, scheduled.id), false);
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          now: before,
          send: async (m) => mail.push(m),
        })
      ).sent,
      0,
    );
    assert.equal(
      (
        await notificationPage(s.db, s.rider, 1, null, before)
      ).notifications.filter((n) => n.type === "ride_reminder").length,
      0,
    );
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          now: due,
          send: async (m) => mail.push(m),
        })
      ).sent,
      1,
    );
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          now: new Date(+due + hour),
          send: async (m) => mail.push(m),
        })
      ).sent,
      0,
    );
    assert.equal(mail.length, 1);
    assert.equal(
      (
        await notificationPage(s.db, s.rider, 1, null, due)
      ).notifications.filter((n) => n.type === "ride_reminder").length,
      1,
    );
    const late = await s.plan({ scheduledAt: at(2) });
    await s.tx((q) => respondRide(q, late.id, s.rider, "accepted"));
    await s.unlock();
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async (m) => mail.push(m),
        })
      ).sent,
      1,
      "late confirmation gets at most one reminder",
    );
    const missed = await s.plan({ scheduledAt: at(1) });
    await s.tx((q) => respondRide(q, missed.id, s.rider, "accepted"));
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          now: new Date(Date.now() + 2 * hour),
          send: async () => assert.fail("past start"),
        })
      ).sent,
      0,
    );
    const offline = await s.plan({ scheduledAt: at(2) });
    await s.tx((q) => respondRide(q, offline.id, s.rider, "accepted"));
    await s.db.query("DELETE FROM notification_email_outbox");
    const result = await runNotificationEmailBatch(s.db, { env: processEnv() });
    assert.equal(result.disabled, true);
    assert(
      (await notificationPage(s.db, s.rider)).notifications.some(
        (n) => n.type === "ride_reminder" && n.target.id === offline.id,
      ),
    );
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await s.close();
  }
});
test("move, decline, revoked access and disabled reminders suppress stale deliveries", async () => {
  const s = await setup();
  try {
    const ride = await s.plan({
      scheduledAt: at(2),
      isPublic: false,
      invitations: ["rider"],
    });
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await releaseRideReminders(s.db);
    await s.edit(ride, { scheduledAt: at(3) });
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.type='ride_reminder' AND o.status='skipped'",
        )
      ).rows[0].n,
      1,
    );
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await s.tx((q) => respondRide(q, ride.id, s.rider, "declined"));
    await s.unlock();
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async () => assert.fail("declined"),
        })
      ).sent,
      0,
    );
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await saveNotificationEmail(
      s.db,
      s.rider,
      { ...on, reminders: false },
      env,
    );
    assert(
      !(await notificationPage(s.db, s.rider)).notifications.some(
        (n) => n.type === "ride_reminder",
      ),
    );
    await s.edit(ride, { invitations: [] });
    await s.unlock();
    assert.equal(
      (
        await runNotificationEmailBatch(s.db, {
          env,
          send: async () => assert.fail("revoked"),
        })
      ).sent,
      0,
    );
    assert.equal(
      (await notificationPage(s.db, s.rider)).notifications.length,
      0,
    );
  } finally {
    await s.close();
  }
});
test("interest proposals recheck the current intent on every retry", async () => {
  for (const revocation of ["private", "consent", "expired", "cancelled"]) {
    const s = await setup();
    try {
      const start = at(2),
        ride = await s.plan({ scheduledAt: start });
      const intent = randomUUID();
      await s.tx((q) =>
        createIntent(q, s.rider, {
          requestId: intent,
          readiness: "ready",
          timeZone: "UTC",
          visibility: "community",
          allowSuggestions: true,
          windows: [
            {
              startLocal: new Date(+new Date(start) - hour)
                .toISOString()
                .slice(0, 16),
              endLocal: new Date(+new Date(start) + 3 * hour)
                .toISOString()
                .slice(0, 16),
            },
          ],
          passport: {
            area: { label: "Москва" },
            purpose: "social",
            pace: "relaxed",
          },
        }),
      );
      const invited = await s.tx((q) =>
        inviteFromInterest(q, s.owner, ride.id, {
          occurrenceAt: start,
          userIds: [s.rider],
        }),
      );
      assert.equal(invited.invited, 1);
      assert.equal(
        (
          await runNotificationEmailBatch(s.db, {
            env,
            send: async () => {
              throw { responseCode: 451 };
            },
          })
        ).retry,
        1,
      );
      if (revocation === "expired")
        await s.db.query(
          "UPDATE ride_intent_windows SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE intent_id=$1",
          [intent],
        );
      else if (revocation === "private")
        await s.db.query(
          "UPDATE ride_intents SET visibility='private' WHERE id=$1",
          [intent],
        );
      else if (revocation === "consent")
        await s.db.query(
          "UPDATE ride_intents SET allow_suggestions=false WHERE id=$1",
          [intent],
        );
      else
        await s.db.query(
          "UPDATE ride_intents SET status='cancelled' WHERE id=$1",
          [intent],
        );
      await s.unlock();
      await s.db.query(
        "UPDATE notification_email_outbox SET available_at=now()",
      );
      assert.equal(
        (
          await runNotificationEmailBatch(s.db, {
            env,
            send: async () => assert.fail("stale proposal"),
          })
        ).skipped,
        1,
        revocation,
      );
      assert(
        !(await notificationPage(s.db, s.rider)).notifications.some(
          (n) => n.type === "ride_invite",
        ),
      );
    } finally {
      await s.close();
    }
  }
});
test("legacy invitations without metadata still follow the current occurrence and RSVP", async () => {
  const s = await setup();
  try {
    const ride = await s.plan({ invitations: ["rider"] });
    await s.db.query(
      "UPDATE notifications SET event_occurs_at=NULL,event_revision=NULL WHERE ride_id=$1 AND type='ride_invite'",
      [ride.id],
    );
    assert(
      (await notificationPage(s.db, s.rider)).notifications.some(
        (n) => n.type === "ride_invite",
      ),
    );
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    assert(
      !(await notificationPage(s.db, s.rider)).notifications.some(
        (n) => n.type === "ride_invite",
      ),
    );
    await s.tx((q) => cancelPlannedRide(q, ride.id, s.owner));
    assert(
      !(await notificationPage(s.db, s.rider)).notifications.some(
        (n) => n.type === "ride_invite",
      ),
    );
  } finally {
    await s.close();
  }
});
test("weekly occurrences keep local time across DST and reminders stay separate", async () => {
  const s = await setup();
  try {
    const first = "2031-03-23T08:00:00Z",
      second = "2031-03-30T07:00:00Z",
      ride = await s.plan({
        scheduledAt: first,
        recurrence: "weekly",
        recurrenceTimezone: "Europe/Berlin",
      });
    await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await s.db.query(
      "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response,revision) VALUES($1,$2,$3,'accepted',1)",
      [ride.id, s.rider, second],
    );
    const sent = [];
    for (const start of [first, second]) {
      await s.unlock();
      const now = new Date(+new Date(start) - 24 * hour);
      assert.equal(
        (
          await runNotificationEmailBatch(s.db, {
            env,
            now,
            send: async (m) => sent.push(m),
          })
        ).sent,
        1,
      );
    }
    assert.equal(sent.length, 2);
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='ride_reminder' AND released_at IS NOT NULL",
        )
      ).rows[0].n,
      2,
    );
    assert.equal((+new Date(second) - +new Date(first)) / hour, 167);
  } finally {
    await s.close();
  }
});
