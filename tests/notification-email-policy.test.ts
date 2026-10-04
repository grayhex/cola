import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import type { MailMessage } from "../lib/mail.ts";
import {
  cancelPlannedRide,
  planInput,
  planRide,
  respondRide,
  rideDefaults,
} from "../lib/rides.ts";
import { saveNotificationEmail } from "../lib/notification-preferences.ts";
import { runNotificationEmailBatch } from "../lib/notification-email.ts";
import { saveNotificationSettings } from "../lib/notification-settings.ts";
import { notificationSettingsPatch } from "../lib/notification-settings.ts";
import { formatClock } from "../lib/notification-policy.ts";
import { rideNotice } from "../lib/ride-notifications.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";

// The person's quiet hours, pause and mutes are read when an e-mail is about to
// be sent, not when it was queued (#341): a message waits for the end of the
// night, or is dropped if it would not live that long, and a message about
// something the person has muted is not sent. The inbox keeps every notice.
// Messages about the person's own agreements are not held to the interval
// between two e-mails.

const hour = 3600_000;
const env = processEnv({
  MAIL_CAPTURE_DIR: "/tmp/cola-email-policy-test",
  APP_ORIGIN: "https://cola.example.test",
});
const on = {
  enabled: true,
  discussions: true,
  rides: true,
  market: false,
  reminders: true,
};

async function setup() {
  const db = await testDatabase();
  const old = process.env.MAIL_CAPTURE_DIR;
  process.env.MAIL_CAPTURE_DIR = env.MAIL_CAPTURE_DIR;
  const user = async (name: string) =>
    (
      await userRow(db, {
        username: name,
        name,
        email_verified_at: new Date(),
      })
    ).id;
  const owner = await user("organizer");
  const rider = await user("rider");
  const bike = (await bikeRow(db, owner, { name: "Bike" })).id;
  await saveNotificationEmail(db, rider, on, env);
  const mail: MailMessage[] = [];
  const tx = db.transaction;
  const plan = (
    inHours: number,
    changes?: Partial<z.input<typeof planInput>>,
  ) =>
    tx((q) =>
      planRide(
        q,
        owner,
        planInput.parse({
          bikeId: bike,
          title: "Policy ride",
          scheduledAt: new Date(
            Math.floor((Date.now() + inHours * hour) / 60000) * 60000,
          ).toISOString(),
          isPublic: true,
          privacyEnabled: true,
          privacyRadiusM: 500,
          meetingPoint: "SECRET HOME",
          passport: {
            area: { label: "Москва" },
            purpose: "social",
            pace: "relaxed",
          },
          invitations: ["rider"],
          ...changes,
        }),
        rideDefaults,
      ),
    );
  const settings = (patch: unknown) =>
    saveNotificationSettings(
      db,
      rider,
      notificationSettingsPatch.parse(patch),
      { env },
    );
  const run = (now?: Date) =>
    runNotificationEmailBatch(db, {
      env,
      ...(now ? { now } : {}),
      send: async (message) => void mail.push(message),
    });
  const outbox = async () =>
    (
      await db.query<{
        status: string;
        error_code: string | null;
        attempts: number;
        available_at: Date;
        type: string;
      }>(
        `SELECT o.status,o.error_code,o.attempts,o.available_at,n.type FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id
        WHERE o.recipient_id=$1 ORDER BY o.created_at,o.notification_id`,
        [rider],
      )
    ).rows;
  // Everything queued is due now (or at the given moment of the test's own clock)
  // and nothing waits for the interval between e-mails.
  const due = async (at = new Date()) => {
    await db.query(
      "UPDATE notification_email_outbox SET available_at=$1 WHERE status='pending'",
      [at],
    );
    await db.query(
      "UPDATE notification_email_preferences SET next_delivery_at=$1::timestamptz-interval '1 minute'",
      [at],
    );
  };
  return {
    db,
    tx,
    owner,
    rider,
    bike,
    plan,
    settings,
    run,
    mail,
    outbox,
    due,
    close: async () => {
      if (old === undefined) delete process.env.MAIL_CAPTURE_DIR;
      else process.env.MAIL_CAPTURE_DIR = old;
      await db.close();
    },
  };
}

// Moscow is UTC+3 all year. 20:00Z is 23:00 there: inside 22:00–07:00, and 04:00Z
// of the next day is 07:00, the end of the window. The evening is the first one
// at least an hour ahead of the real clock, because everything the database stamps
// with now() (when a message was queued) must be earlier than the test's "now".
const day = 24 * hour;
const night = new Date(
  Math.floor(Date.now() / day) * day +
    20 * hour +
    (Math.floor(Date.now() / day) * day + 20 * hour > Date.now() + hour
      ? 0
      : day),
);
const morning = new Date(night.getTime() + 8 * hour);
const quiet = {
  timeZone: "Europe/Moscow",
  quietHours: { enabled: true, from: "22:00", to: "07:00" },
};

test("in the quiet hours a message waits for their end, without using an attempt, and is sent then", async () => {
  const s = await setup();
  try {
    await s.settings(quiet);
    await s.plan(48);
    await s.due(night);
    const first = await s.run(night);
    assert.equal(first.deferred, 1);
    assert.equal(first.sent, 0);
    assert.equal(s.mail.length, 0);
    const [row] = await s.outbox();
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 0);
    assert.equal(row.available_at.toISOString(), morning.toISOString());
    // The inbox is not governed by any of this.
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND type='ride_invite'",
          [s.rider],
        )
      ).rows[0].n,
      1,
    );
    // Asking again before the end changes nothing.
    assert.equal((await s.run(new Date(morning.getTime() - hour))).claimed, 0);
    // At the end of the quiet it goes.
    const second = await s.run(morning);
    assert.equal(second.sent, 1);
    assert.equal(s.mail.length, 1);
    assert.equal((await s.outbox())[0].status, "sent");
  } finally {
    await s.close();
  }
});

test("a message that expires before the morning is dropped, not sent in the morning", async () => {
  const s = await setup();
  try {
    await s.settings(quiet);
    await s.plan(48);
    await s.db.query(
      "UPDATE notification_email_outbox SET expires_at=$1,available_at=$2",
      [new Date(night.getTime() + 5 * hour), new Date(night.getTime() - hour)],
    );
    await s.db.query(
      "UPDATE notification_email_preferences SET next_delivery_at=$1",
      [new Date(night.getTime() - hour)],
    );
    const result = await s.run(night);
    assert.equal(result.skipped, 1);
    assert.equal(result.deferred, 0);
    const [row] = await s.outbox();
    assert.equal(row.status, "skipped");
    assert.equal(row.error_code, "quiet");
    assert.equal((await s.run(morning)).sent, 0);
    assert.equal(s.mail.length, 0);
  } finally {
    await s.close();
  }
});

test("a pause drops what falls in it, and what came during it is not caught up afterwards", async () => {
  const s = await setup();
  try {
    await s.settings({
      pausedUntil: new Date(Date.now() + 7 * 24 * hour).toISOString(),
    });
    await s.plan(48);
    await s.due();
    const result = await s.run();
    assert.equal(result.skipped, 1);
    assert.equal(s.mail.length, 0);
    const [row] = await s.outbox();
    assert.equal(row.status, "skipped");
    assert.equal(row.error_code, "paused");
    // Lifting the pause does not bring it back.
    await s.settings({ pausedUntil: null });
    assert.equal((await s.run()).claimed, 0);
    assert.equal(s.mail.length, 0);
  } finally {
    await s.close();
  }
});

test("a mute, read at the moment of sending, silences its ride and its author", async () => {
  const s = await setup();
  try {
    const ride = await s.plan(48);
    await s.settings({ mutes: { add: [{ kind: "ride", id: ride.id }] } });
    await s.due();
    const byRide = await s.run();
    assert.equal(byRide.skipped, 1);
    assert.equal(s.mail.length, 0);
    assert.equal((await s.outbox())[0].error_code, "muted");

    // The author, for another ride, queued before the mute.
    await s.plan(72, { title: "Another" });
    await s.settings({
      mutes: {
        remove: [{ kind: "ride", id: ride.id }],
        add: [{ kind: "author", id: s.owner }],
      },
    });
    await s.due();
    const byAuthor = await s.run();
    assert.equal(byAuthor.skipped, 1);
    assert.equal((await s.outbox()).at(-1)?.error_code, "muted");
    assert.equal(s.mail.length, 0);

    // The mute lifted: the next message goes.
    await s.settings({ mutes: { remove: [{ kind: "author", id: s.owner }] } });
    await s.plan(96, { title: "Third" });
    await s.due();
    assert.equal((await s.run()).sent, 1);
    assert.equal(s.mail.length, 1);
    // The inbox kept all three throughout.
    assert.equal(
      (
        await s.db.query(
          "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND type='ride_invite'",
          [s.rider],
        )
      ).rows[0].n,
      3,
    );
  } finally {
    await s.close();
  }
});

// A window of three hours around the moment of the test, on UTC, so that the
// answer does not depend on the hour at which the test runs.
function quietAround(allowCancellations: boolean) {
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return {
    timeZone: "UTC",
    quietHours: {
      enabled: true,
      from: formatClock((minutes + 1440 - 60) % 1440),
      to: formatClock((minutes + 120) % 1440),
      allowCancellations,
    },
  };
}
async function cancellation(allow: boolean, hoursAhead: number, accept = true) {
  const s = await setup();
  try {
    const ride = await s.plan(hoursAhead);
    if (accept) await s.tx((q) => respondRide(q, ride.id, s.rider, "accepted"));
    await s.settings(quietAround(allow));
    await s.tx((q) => cancelPlannedRide(q, ride.id, s.owner));
    // Take the cancellation alone.
    await s.db.query(
      "UPDATE notification_email_outbox o SET status='skipped',error_code='unavailable' FROM notifications n WHERE n.id=o.notification_id AND n.type<>'ride_cancelled'",
    );
    await s.due();
    const result = await s.run();
    return { result, mail: s.mail.length };
  } finally {
    await s.close();
  }
}

test("a close cancellation of a confirmed ride breaks the quiet only by the person's explicit choice", async () => {
  // The ride is six hours away: close. Chosen: it breaks the quiet. Not chosen: it waits.
  const chosen = await cancellation(true, 6);
  assert.equal(chosen.mail, 1);
  const notChosen = await cancellation(false, 6);
  assert.equal(notChosen.mail, 0);
  assert.equal(notChosen.result.deferred, 1);
  // A ride a day and a half away is not close, whatever was chosen.
  const far = await cancellation(true, 36);
  assert.equal(far.mail, 0);
  assert.equal(far.result.deferred, 1);
  // Someone who never confirmed does not get the exception.
  const unconfirmed = await cancellation(true, 6, false);
  assert.equal(unconfirmed.mail, 0);
  assert.equal(unconfirmed.result.deferred, 1);
});

test("messages about one's own agreements are not held to the interval between two e-mails", async () => {
  const s = await setup();
  try {
    const ride = await s.plan(48);
    // A second personal notice for the same person: the ride changed.
    await s.tx((q) =>
      rideNotice(q, ride.id, "ride_changed", { recipients: [s.rider] }),
    );
    await s.due();
    const queued = (await s.outbox()).filter((o) => o.status === "pending");
    assert.deepEqual(queued.map((o) => o.type).sort(), [
      "ride_changed",
      "ride_invite",
    ]);
    // One batch takes both: neither waits twenty minutes behind the other.
    const result = await s.run();
    assert.equal(result.sent, 2);
    assert.equal(s.mail.length, 2);
    assert.equal((await s.run()).claimed, 0);
  } finally {
    await s.close();
  }
});
