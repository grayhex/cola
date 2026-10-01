// #236: persisted user choice, atomic RSVP schedule, current revision and privacy.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import { runNotificationEmailBatch } from "../lib/notification-email.ts";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const q = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const users = [];
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      body: await r.json(),
      cache: r.headers.get("cache-control"),
    };
  };
}
const owner = client(),
  rider = client(),
  guest = client();
const on = {
  enabled: true,
  discussions: false,
  rides: true,
  market: false,
  reminders: true,
};
try {
  for (const c of [owner, rider]) {
    assert.equal(
      (
        await c("auth/register", "POST", {
          ...testConsents,
          name: "Ride notification",
          email: randomUUID() + "@example.test",
          password: "ride-mail-http-secret-123",
        })
      ).status,
      201,
    );
    users.push((await c("me")).body.user);
  }
  const prefs = (await rider("account/notifications")).body;
  assert.equal(prefs.reminders, true);
  assert.equal(prefs.enabled, false);
  assert.equal(
    (await rider("account/notifications", "PATCH", { ...on, reminders: "no" }))
      .status,
    400,
  );
  assert.equal(
    (await rider("account/notifications", "PATCH", on, "https://evil.test"))
      .status,
    403,
  );
  assert.equal((await rider("account/notifications", "PATCH", on)).status, 200);
  const bike = (
    await owner("bikes", "POST", {
      name: "Reminders bike",
      brand: "Cube",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      is_public: true,
    })
  ).body.id;
  const start = new Date(
    Math.ceil((Date.now() + 2 * 3600000) / 60000) * 60000,
  ).toISOString();
  const fields = {
    bikeId: bike,
    title: "Private ride name",
    description: "",
    isPublic: false,
    privacyEnabled: true,
    privacyRadiusM: 500,
    scheduledAt: start,
    meetingPoint: "SECRET HOME",
    meetingVisibility: "participants",
    invitations: [users[1].username],
  };
  const created = await owner("rides/plan", "POST", fields);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { id, shareId } = created.body;
  const answer = () =>
    rider(`rides/${id}/rsvp`, "PATCH", {
      response: "accepted",
      occurrenceAt: start,
    });
  const first = await answer();
  assert.equal(first.status, 200);
  assert.equal(first.cache, "no-store");
  assert.equal(first.body.reminder.enabled, true);
  assert.equal(first.body.reminder.emailEnabled, true);
  assert(first.body.reminder.at);
  await answer();
  assert.equal(
    (
      await q.query(
        "SELECT count(*)::int n FROM notifications WHERE ride_id=$1 AND type='ride_reminder'",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await guest("rides/public/" + shareId)).status, 404);
  const sent = [];
  assert.equal(
    (await runNotificationEmailBatch(q, { send: async (m) => sent.push(m) }))
      .sent,
    1,
  );
  assert(sent[0].subject.includes("Напоминание"));
  assert(!sent[0].text.includes("SECRET HOME"));
  assert.equal(
    (await rider("rides/public/" + shareId)).body.ride.reminder.released,
    true,
  );
  // Changing the agreement fences the old reminder before asking for a new answer.
  assert.equal(
    (
      await owner(`rides/${id}`, "PATCH", {
        ...fields,
        meetingPoint: "Новая встреча у вокзала",
      })
    ).status,
    200,
  );
  let current = (await rider("rides/public/" + shareId)).body.ride;
  assert.equal(current.participation, "reconfirm");
  assert.equal(current.reminder.at, null);
  assert(
    (await rider("community/notifications")).body.notifications.some(
      (n) => n.type === "ride_changed",
    ),
  );
  await answer();
  assert((await rider("rides/public/" + shareId)).body.ride.reminder.at);
  // Local reminder opt-out is independent of external mail, and survives old clients.
  assert.equal(
    (await rider("account/notifications", "PATCH", { ...on, reminders: false }))
      .status,
    200,
  );
  const legacy = { ...on };
  delete legacy.reminders;
  assert.equal(
    (await rider("account/notifications", "PATCH", legacy)).body.reminders,
    false,
  );
  assert.equal(
    (await rider("rides/public/" + shareId)).body.ride.reminder.enabled,
    false,
  );
  assert.equal((await owner(`rides/${id}/cancel`, "POST", {})).status, 200);
  const notices = (await rider("community/notifications")).body.notifications;
  assert(notices.some((n) => n.type === "ride_cancelled"));
  assert(!notices.some((n) => n.type === "ride_reminder"));
  await q.query(
    "UPDATE notification_email_preferences SET next_delivery_at=now() WHERE user_id=$1",
    [users[1].id],
  );
  assert.equal(
    (await runNotificationEmailBatch(q, { send: async (m) => sent.push(m) }))
      .sent,
    1,
  );
  assert(sent.at(-1).subject.includes("отменена"));
  // "Read all" consumes current notices, not the durable future schedule.
  assert.equal((await rider("account/notifications", "PATCH", on)).status, 200);
  const future = new Date(
    Math.ceil((Date.now() + 48 * 3600000) / 60000) * 60000,
  ).toISOString();
  const planned = await owner("rides/plan", "POST", {
    ...fields,
    isPublic: true,
    invitations: [],
    scheduledAt: future,
  });
  assert.equal(planned.status, 201);
  assert.equal(
    (
      await rider(`rides/${planned.body.id}/rsvp`, "PATCH", {
        response: "accepted",
        occurrenceAt: future,
      })
    ).status,
    200,
  );
  assert.equal(
    (await rider("community/notifications/read-all", "PATCH", {})).status,
    200,
  );
  assert.equal(
    (
      await q.query(
        "SELECT read_at FROM notifications WHERE ride_id=$1 AND type='ride_reminder'",
        [planned.body.id],
      )
    ).rows[0].read_at,
    null,
  );
  assert.equal(
    (
      await runNotificationEmailBatch(q, {
        now: new Date(+new Date(future) - 24 * 3600000),
        send: async (m) => sent.push(m),
      })
    ).sent,
    1,
  );
  assert(sent.at(-1).subject.includes("Напоминание"));
  assert(
    !JSON.stringify(
      (
        await q.query(
          "SELECT * FROM notification_email_outbox WHERE recipient_id=$1",
          [users[1].id],
        )
      ).rows,
    ).includes("SECRET HOME"),
  );
  console.log(
    "Ride notifications HTTP: isolated preferences, default reminder, RSVP idempotency, private access, reconfirmation, cancellation and future read-all passed.",
  );
} finally {
  await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await q.end();
}
