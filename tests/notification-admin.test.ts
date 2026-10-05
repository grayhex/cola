import test, { after } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import type { MailMessage } from "../lib/mail.ts";
import {
  type NotificationAdminError,
  adminNotifications,
  explainDiscovery,
  notificationCatalogView,
  saveAdminNotifications,
  sendAdminTest,
} from "../lib/notification-admin.ts";
import {
  announcePlan,
  runNotificationFanout,
} from "../lib/notification-fanout.ts";
import { runNotificationEmailBatch } from "../lib/notification-email.ts";
import {
  notificationCategoryKeys,
  notificationTypes,
} from "../lib/notification-catalog.ts";
import {
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { saveNotificationEmail } from "../lib/notification-preferences.ts";
import { notify } from "../lib/notifications.ts";
import { audit } from "../lib/site.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";
import { bikeCommentRow } from "./support/notifications.ts";
import { planRow } from "./support/rides.ts";

// What an administrator may do about notifications (#341): read the catalogue
// and the state, change the limits and the kill switches on top of the version
// they read, ask why a person would or would not be told, and send a test to
// themselves. Nothing here switches a consent on for a person or writes to
// anyone else, and the audit names what changed, never a person's data.

const db = await testDatabase();
after(() => db.close());
const mailEnv = processEnv({
  MAIL_CAPTURE_DIR: "/tmp/cola-admin-test",
  APP_ORIGIN: "https://cola.example.test",
});
const noMail = processEnv();
const admin = async (verified = true) =>
  (
    await userRow(db, {
      role: "admin",
      name: "Админ",
      email_verified_at: verified ? new Date() : null,
    })
  ).id;
const person = async () =>
  (await userRow(db, { email_verified_at: new Date() })).id;
const base = {
  discoveryPerDay: 3,
  authorCooldownMinutes: 360,
  announcementsPerAuthorDay: 10,
  audienceMax: 5000,
  batch: 200,
  discoveryEnabled: true,
  externalEnabled: true,
  pushEnabled: true,
  disabledCategories: [] as string[],
};
async function save(actor: string, change: Partial<typeof base> = {}) {
  const { version } = await adminNotifications(db);
  return saveAdminNotifications(
    db,
    actor,
    { ...base, ...change, version },
    audit,
  );
}
const reset = () =>
  db.query(
    "UPDATE notification_limits SET discovery_per_day=3,author_cooldown_minutes=360,announcements_per_author_day=10,audience_max=5000,batch=200,discovery_enabled=true,external_enabled=true,disabled_categories='{}'",
  );
const auditOf = async (action: string) =>
  (
    await db.query<{ target: string }>(
      "SELECT target FROM admin_audit WHERE action=$1 ORDER BY id",
      [action],
    )
  ).rows.map((row) => row.target);

test("the catalogue is the code's: every category and every event, with what a channel can carry", async () => {
  const view = notificationCatalogView();
  assert.deepEqual(
    view.categories.map((c) => c.key),
    [...notificationCategoryKeys],
  );
  assert.deepEqual(
    view.events.map((e) => e.type),
    [...notificationTypes],
  );
  assert.deepEqual(view.planned.map((c) => c.key).sort(), ["chat", "nearby"]);
  const state = await adminNotifications(db, mailEnv);
  assert.equal(state.channels.email.available, true);
  assert.equal(state.channels.push.available, false);
  assert.equal(
    (await adminNotifications(db, noMail)).channels.email.available,
    false,
  );
  assert.equal(state.limits.discoveryPerDay, 3);
  assert.equal(state.version, 1);
  // Counts, never people or places.
  assert.ok(
    Array.isArray(state.status.email) && Array.isArray(state.status.fanouts),
  );
  assert.deepEqual(Object.keys(state.status.reminders).sort(), [
    "cancelled",
    "due",
    "expired",
    "released",
    "scheduled",
  ]);
});

test("limits change on top of the version read, whole, with an audit of what changed and not of whom", async () => {
  await reset();
  const boss = await admin();
  const before = await adminNotifications(db);
  await assert.rejects(
    saveAdminNotifications(
      db,
      boss,
      { ...base, version: before.version + 5 },
      audit,
    ),
    (error: NotificationAdminError) => error.status === 409,
  );
  const saved = await save(boss, {
    discoveryPerDay: 5,
    disabledCategories: ["plans", "market"],
  });
  assert.equal(saved.version, before.version + 1);
  assert.equal(saved.limits.discoveryPerDay, 5);
  assert.deepEqual([...saved.limits.disabledCategories].sort(), [
    "market",
    "plans",
  ]);
  // The audit says which settings, not anyone's data.
  const entries = await auditOf("notifications.limits");
  assert.equal(
    entries.at(-1),
    `${saved.version}: discoveryPerDay,disabledCategories`,
  );
  // Nothing changed: no new version, no new audit entry.
  const same = await save(boss, {
    discoveryPerDay: 5,
    disabledCategories: ["market", "plans"],
  });
  assert.equal(same.version, saved.version);
  assert.equal((await auditOf("notifications.limits")).length, entries.length);
  // A stale editor cannot overwrite it.
  await assert.rejects(
    saveAdminNotifications(
      db,
      boss,
      { ...base, version: before.version },
      audit,
    ),
    (error: NotificationAdminError) => error.status === 409,
  );
  await reset();
});

test("what is outside the safe range or is not a category is refused whole", async () => {
  await reset();
  const boss = await admin();
  const version = (await adminNotifications(db)).version;
  const attempt = (change: Record<string, unknown>) =>
    saveAdminNotifications(db, boss, { ...base, ...change, version }, audit);
  for (const change of [
    { discoveryPerDay: 21 },
    { discoveryPerDay: -1 },
    { authorCooldownMinutes: 20000 },
    { announcementsPerAuthorDay: 0 },
    { audienceMax: 1_000_000 },
    { batch: 5000 },
    { disabledCategories: ["vouchers"] },
    { disabledCategories: ["plans", "plans"] },
    { discoveryEnabled: "yes" },
    { somethingElse: true },
  ])
    await assert.rejects(attempt(change), ZodError, JSON.stringify(change));
  assert.equal((await adminNotifications(db)).version, version);
});

test("the discovery switch and the category switches stop the events, not what was said", async () => {
  await reset();
  const boss = await admin();
  const a = await person();
  const bike = (await bikeRow(db, a)).id;
  const friend = await person();
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2),($2,$1)",
    [a, friend],
  );
  const ride = (b: string) =>
    planRow(db, a, b, new Date(Date.now() + 48 * 3600_000));

  await save(boss, { discoveryEnabled: false });
  assert.equal(await announcePlan(db, (await ride(bike)).id), false);
  await save(boss, { discoveryEnabled: true, disabledCategories: ["plans"] });
  assert.equal(await announcePlan(db, (await ride(bike)).id), false);
  await save(boss, { disabledCategories: [] });
  const live = await ride(bike);
  assert.equal(await announcePlan(db, live.id), true);
  // Switched off before the worker came: it stops, and (nothing being told) forgets.
  await save(boss, { disabledCategories: ["plans"] });
  const stopped = await runNotificationFanout(db);
  assert.equal(stopped.cancelled, 1);
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM notifications WHERE recipient_id=$1 AND type='plan_published'",
        [friend],
      )
    ).rowCount,
    0,
  );
  await reset();
});

test("the switch of all external channels and of a category stops the e-mails, never the bell", async () => {
  await reset();
  const boss = await admin();
  const owner = await person();
  const writer = await person();
  const bike = (await bikeRow(db, owner)).id;
  await saveNotificationEmail(
    db,
    owner,
    {
      enabled: true,
      discussions: true,
      rides: true,
      market: false,
      reminders: true,
    },
    mailEnv,
  );
  const old = process.env.MAIL_CAPTURE_DIR;
  process.env.MAIL_CAPTURE_DIR = mailEnv.MAIL_CAPTURE_DIR;
  const mail: MailMessage[] = [];
  try {
    const comment = async () => {
      const id = (await bikeCommentRow(db, bike, writer)).id;
      await notify(db, {
        recipient: owner,
        actor: writer,
        type: "comment",
        bike,
        comment: id,
      });
      // Another group each time: the earlier notice is read.
      await db.query(
        "UPDATE notifications SET read_at=now() WHERE recipient_id=$1 AND type='comment' AND comment_id<>$2",
        [owner, id],
      );
    };
    const run = async () => {
      await db.query("UPDATE notification_email_outbox SET available_at=now()");
      await db.query(
        "UPDATE notification_email_preferences SET next_delivery_at=now()-interval '1 minute'",
      );
      return runNotificationEmailBatch(db, {
        env: mailEnv,
        send: async (m) => void mail.push(m),
      });
    };
    await save(boss, { externalEnabled: false });
    await comment();
    const off = await run();
    assert.equal(off.skipped, 1);
    assert.equal(mail.length, 0);
    assert.equal(
      (
        await db.query<{ error_code: string }>(
          "SELECT error_code FROM notification_email_outbox ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0].error_code,
      "disabled",
    );
    // The notice itself is in the bell.
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM notifications WHERE recipient_id=$1 AND type='comment'",
          [owner],
        )
      ).rowCount,
      1,
    );
    // Back on, but the category of comments off: still nothing.
    await db.query("UPDATE notifications SET read_at=now()");
    await save(boss, {
      externalEnabled: true,
      disabledCategories: ["discussions"],
    });
    await comment();
    assert.equal((await run()).skipped, 1);
    assert.equal(mail.length, 0);
    // The category on again: it goes.
    await db.query("UPDATE notifications SET read_at=now()");
    await save(boss, { disabledCategories: [] });
    await comment();
    assert.equal((await run()).sent, 1);
    assert.equal(mail.length, 1);
  } finally {
    if (old === undefined) delete process.env.MAIL_CAPTURE_DIR;
    else process.env.MAIL_CAPTURE_DIR = old;
    await reset();
  }
});

test("the reasons a new plan would or would not reach a person, in order, and the question is audited", async () => {
  await reset();
  const boss = await admin();
  const author = await userRow(db, { username: "author-x", name: "Автор" });
  const friend = await userRow(db, { username: "friend-x", name: "Друг" });
  const follower = await userRow(db, {
    username: "follower-x",
    name: "Подписчик",
  });
  await userRow(db, { username: "stranger-x", name: "Чужой" });
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2),($2,$1),($3,$1)",
    [author.id, friend.id, follower.id],
  );
  const ask = (recipient: string, author = "author-x") =>
    explainDiscovery(db, boss, { author, recipient }, audit);
  const code = (result: Awaited<ReturnType<typeof ask>>, name: string) =>
    result.reasons.find((r) => r.code === name);

  const told = await ask("friend-x");
  assert.equal(told.inbox, true);
  assert.equal(told.external, true);
  assert.deepEqual(
    told.reasons.map((r) => r.code),
    [
      "switch",
      "accounts",
      "circle",
      "mute",
      "considering",
      "budget",
      "time",
      "channel",
    ],
  );
  assert.deepEqual(Object.keys(told.author).sort(), ["name", "username"]);
  // A follower is not a friend by default; a stranger is neither.
  assert.equal(code(await ask("follower-x"), "circle")?.ok, false);
  assert.equal((await ask("follower-x")).inbox, false);
  assert.equal(code(await ask("stranger-x"), "circle")?.ok, false);
  // Their own circle changes the answer.
  await saveNotificationSettings(
    db,
    follower.id,
    notificationSettingsPatch.parse({ circle: { mode: "follows" } }),
    { env: mailEnv },
  );
  assert.equal((await ask("follower-x")).inbox, true);
  // A mute, a pause, a spent budget and the admin's switch each say so.
  await saveNotificationSettings(
    db,
    friend.id,
    notificationSettingsPatch.parse({
      mutes: { add: [{ kind: "author", id: author.id }] },
    }),
    { env: mailEnv },
  );
  const muted = await ask("friend-x");
  assert.equal(muted.inbox, false);
  assert.equal(code(muted, "mute")?.ok, false);
  await saveNotificationSettings(
    db,
    friend.id,
    notificationSettingsPatch.parse({
      mutes: { remove: [{ kind: "author", id: author.id }] },
      pausedUntil: new Date(Date.now() + 86400_000).toISOString(),
    }),
    { env: mailEnv },
  );
  const paused = await ask("friend-x");
  assert.equal(paused.inbox, true, "the bell is not paused");
  assert.equal(paused.external, false);
  assert.equal(code(paused, "time")?.ok, false);
  await saveNotificationSettings(
    db,
    friend.id,
    notificationSettingsPatch.parse({ pausedUntil: null }),
    { env: mailEnv },
  );
  await db.query("UPDATE notification_limits SET discovery_per_day=0");
  const spent = await ask("friend-x");
  assert.equal(spent.inbox, true);
  assert.equal(spent.external, false);
  assert.equal(code(spent, "budget")?.ok, false);
  await reset();
  await save(boss, { externalEnabled: false });
  assert.equal(code(await ask("friend-x"), "channel")?.ok, false);
  await reset();
  // Oneself, and someone who is not there.
  assert.equal((await ask("author-x")).inbox, false);
  await assert.rejects(
    ask("nobody-at-all"),
    (error: NotificationAdminError) => error.status === 404,
  );
  // Every question is in the audit, by whom, about which pair of accounts.
  const asked = await auditOf("notifications.explain");
  assert.ok(asked.length >= 6);
  assert.ok(
    asked.every((target) => /^[0-9a-f-]{36}>[0-9a-f-]{36}$/.test(target)),
  );
});

test("a test message goes to the administrator's own verified address, and only if mail works", async () => {
  const boss = await admin();
  const sent: MailMessage[] = [];
  const send = async (message: MailMessage) => void sent.push(message);
  await assert.rejects(
    sendAdminTest(db, boss, audit, noMail, send),
    (error: NotificationAdminError) => error.status === 503,
  );
  await assert.rejects(
    sendAdminTest(db, await admin(false), audit, mailEnv, send),
    (error: NotificationAdminError) => error.status === 403,
  );
  // Not an administrator, not even a verified one.
  await assert.rejects(
    sendAdminTest(db, await person(), audit, mailEnv, send),
    (error: NotificationAdminError) => error.status === 403,
  );
  assert.equal(sent.length, 0);
  const email = (
    await db.query<{ email: string }>("SELECT email FROM users WHERE id=$1", [
      boss,
    ])
  ).rows[0].email;
  assert.deepEqual(await sendAdminTest(db, boss, audit, mailEnv, send), {
    sent: true,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  assert.match(sent[0].subject, /Проверка уведомлений/);
  assert.deepEqual(await auditOf("notifications.test"), ["email:self"]);
});
