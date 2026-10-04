import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ZodError } from "zod";
import { CommunityError } from "../lib/community-validation.ts";
import {
  notificationEmailSettings,
  saveNotificationEmail,
  notificationUnsubscribeToken,
  unsubscribeNotificationEmail,
} from "../lib/notification-preferences.ts";
import {
  notificationSettings,
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { invalid } from "./support/negative.ts";
import { migrateOnly, testDatabase } from "./support/database.ts";
import { processEnv } from "./support/env.ts";
import { userRow } from "./support/people.ts";
import { one } from "./support/rows.ts";

// The account's notification settings (#341): one model for the site, the API
// and the unsubscribe link. E-mail keeps its table and its rules; the rest is
// a row of its own; nothing is stored for a channel that cannot work.

const db = await testDatabase();
after(() => db.close());
const mail = processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-settings-test" });
const noMail = processEnv();
const withPush = { env: mail, pushReady: true };

const person = async (verified = true) =>
  (
    await userRow(db, {
      email_verified_at: verified ? new Date() : null,
    })
  ).id;
const stored = (id: string) =>
  one<{
    reminders: boolean;
    push_enabled: boolean;
    push_categories: Record<string, boolean>;
  }>(
    db,
    "SELECT reminders,push_enabled,push_categories FROM notification_settings WHERE user_id=$1",
    [id],
  );
const legacyFlag = async (id: string) =>
  (
    await one<{ ride_reminders: boolean }>(
      db,
      "SELECT ride_reminders FROM notification_email_preferences WHERE user_id=$1",
      [id],
    )
  ).ride_reminders;

test("defaults: nothing is on outside the site, push is not connected, reminders are on", async () => {
  const id = await person();
  const settings = await notificationSettings(db, id, { env: mail });
  assert.deepEqual(settings.channels, {
    email: { available: true, verified: true, enabled: false },
    push: { available: false, enabled: false },
  });
  assert.deepEqual(
    settings.categories.map((c) => [c.key, c.email, c.push]),
    [
      [
        "rides",
        { supported: true, enabled: false },
        { supported: true, enabled: true },
      ],
      [
        "discussions",
        { supported: true, enabled: false },
        { supported: true, enabled: true },
      ],
      [
        "market",
        { supported: true, enabled: false },
        { supported: false, enabled: false },
      ],
    ],
    "the categories a channel can carry, and the push defaults after consent",
  );
  assert.equal(settings.reminders, true);
  assert.equal(settings.updatedAt, null);
  assert.equal(settings.version, "-|-");
  assert.deepEqual(
    (await notificationSettings(db, id, { env: noMail })).channels.email,
    { available: false, verified: true, enabled: false },
  );
  // Nothing is written by reading.
  assert.equal(
    (
      await db.query("SELECT 1 FROM notification_settings WHERE user_id=$1", [
        id,
      ])
    ).rowCount,
    0,
  );
});

test("e-mail keeps its rules: a verified address and a sender, and switching off needs neither", async () => {
  const unverified = await person(false);
  await assert.rejects(
    saveNotificationSettings(
      db,
      unverified,
      { channels: { email: { enabled: true } } },
      { env: mail },
    ),
    (error) => error instanceof CommunityError && error.status === 403,
  );
  const id = await person();
  await assert.rejects(
    saveNotificationSettings(
      db,
      id,
      { channels: { email: { enabled: true } } },
      { env: noMail },
    ),
    (error) => error instanceof CommunityError && error.status === 503,
  );
  const on = await saveNotificationSettings(
    db,
    id,
    {
      channels: { email: { enabled: true } },
      categories: [{ key: "discussions", email: true }],
    },
    { env: mail },
  );
  assert.equal(on.channels.email.enabled, true);
  assert.deepEqual(
    on.categories.map((c) => c.email.enabled),
    [false, true, false],
    "only what was named changed",
  );
  // The sender goes away; the person can still turn it all off.
  const off = await saveNotificationSettings(
    db,
    id,
    { channels: { email: { enabled: false } } },
    { env: noMail },
  );
  assert.equal(off.channels.email.enabled, false);
  assert.equal(
    off.categories[1].email.enabled,
    true,
    "the choice of a category outlives the master switch",
  );
  assert.equal(
    (await notificationEmailSettings(db, id, mail)).discussions,
    true,
  );
});

test("only switching e-mail on needs a working channel: switching off, the reminder and what already is never do", async () => {
  const id = await person();
  await saveNotificationSettings(
    db,
    id,
    {
      channels: { email: { enabled: true } },
      categories: [{ key: "rides", email: true }],
    },
    { env: mail },
  );
  // The sender is gone and the address is no longer verified: what is on stays
  // as it is, may be turned off and does not stop the reminder from changing.
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [id]);
  const off = { env: noMail };
  assert.equal(
    (
      await saveNotificationSettings(
        db,
        id,
        { channels: { email: { enabled: true } } },
        off,
      )
    ).channels.email.enabled,
    true,
    "saying what already is",
  );
  assert.equal(
    (await saveNotificationSettings(db, id, { reminders: false }, off))
      .reminders,
    false,
    "the reminder belongs to every channel",
  );
  assert.equal(
    (
      await saveNotificationSettings(
        db,
        id,
        { categories: [{ key: "rides", email: false }] },
        off,
      )
    ).categories[0].email.enabled,
    false,
    "switching a category off",
  );
  // A category cannot be switched on through a channel that cannot carry it.
  await assert.rejects(
    saveNotificationSettings(
      db,
      id,
      { categories: [{ key: "market", email: true }] },
      off,
    ),
    (error) => error instanceof CommunityError && error.status === 403,
  );
  assert.equal(
    (
      await saveNotificationSettings(
        db,
        id,
        { channels: { email: { enabled: false } } },
        off,
      )
    ).channels.email.enabled,
    false,
    "switching the channel off",
  );
  // A category chosen while the channel stays off is only a preference.
  const quiet = await person();
  const chosen = await saveNotificationSettings(
    db,
    quiet,
    { categories: [{ key: "discussions", email: true }] },
    off,
  );
  assert.equal(chosen.channels.email.enabled, false);
  assert.equal(
    chosen.categories.find((c) => c.key === "discussions")?.email.enabled,
    true,
  );
});

test("the e-mail form of the site is a view of the same settings", async () => {
  const id = await person();
  const saved = await saveNotificationEmail(
    db,
    id,
    {
      enabled: true,
      discussions: false,
      rides: true,
      market: false,
      reminders: false,
    },
    mail,
  );
  assert.deepEqual(saved, {
    enabled: true,
    discussions: false,
    rides: true,
    market: false,
    reminders: false,
    available: true,
    verified: true,
  });
  const settings = await notificationSettings(db, id, { env: mail });
  assert.equal(settings.channels.email.enabled, true);
  assert.equal(settings.categories[0].email.enabled, true);
  assert.equal(settings.reminders, false);
  // Reminders: the settings are the source of truth, the old column follows.
  assert.equal((await stored(id)).reminders, false);
  assert.equal(await legacyFlag(id), false);
  // An omitted flag keeps what is there, as before.
  const kept = await saveNotificationEmail(
    db,
    id,
    { enabled: true, discussions: true, rides: true, market: false },
    mail,
  );
  assert.equal(kept.reminders, false);
  await assert.rejects(
    saveNotificationEmail(
      db,
      randomUUID(),
      { enabled: false, discussions: false, rides: false, market: false },
      mail,
    ),
    (error) => error instanceof CommunityError && error.status === 404,
  );
});

test("reminders are for every channel: the switch needs no e-mail at all", async () => {
  const id = await person();
  const result = await saveNotificationSettings(
    db,
    id,
    { reminders: false },
    { env: noMail },
  );
  assert.equal(result.reminders, false);
  assert.equal((await stored(id)).reminders, false);
  assert.equal(await legacyFlag(id), false, "kept in step for one release");
  assert.equal(
    (await notificationSettings(db, id, { env: noMail })).channels.email
      .enabled,
    false,
    "and no consent to mail was given by it",
  );
  const back = await saveNotificationSettings(
    db,
    id,
    { reminders: true },
    { env: noMail },
  );
  assert.equal(back.reminders, true);
  assert.equal(await legacyFlag(id), true);
});

test("push cannot be switched on while nothing delivers it, and never by default", async () => {
  const id = await person();
  await assert.rejects(
    saveNotificationSettings(
      db,
      id,
      { channels: { push: { enabled: true } } },
      { env: mail },
    ),
    (error) => error instanceof CommunityError && error.status === 503,
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM notification_settings WHERE user_id=$1", [
        id,
      ])
    ).rowCount,
    0,
    "a refused change stores nothing",
  );
  // Saying what already is, or switching something off, is always fine ...
  const same = await saveNotificationSettings(
    db,
    id,
    {
      channels: { push: { enabled: false } },
      categories: [{ key: "rides", push: true }],
    },
    { env: mail },
  );
  assert.equal(same.channels.push.enabled, false);
  assert.equal(same.categories[0].push.enabled, true, "the default");
  const off = await saveNotificationSettings(
    db,
    id,
    { categories: [{ key: "rides", push: false }] },
    { env: mail },
  );
  assert.equal(off.categories[0].push.enabled, false);
  // ... but switching a category back on needs the channel to work.
  await assert.rejects(
    saveNotificationSettings(
      db,
      id,
      { categories: [{ key: "rides", push: true }] },
      { env: mail },
    ),
    (error) => error instanceof CommunityError && error.status === 503,
  );
  assert.deepEqual((await stored(id)).push_categories, { rides: false });
});

test("once push is connected: consent is the account's, categories follow the catalogue, choices are explicit", async () => {
  const id = await person();
  const on = await saveNotificationSettings(
    db,
    id,
    { channels: { push: { enabled: true } } },
    withPush,
  );
  assert.equal(on.channels.push.available, true);
  assert.equal(on.channels.push.enabled, true);
  assert.deepEqual(
    on.categories.map((c) => c.push.enabled),
    [true, true, false],
    "after consent: rides and comments; the site's own notices need no push",
  );
  assert.deepEqual(
    (await stored(id)).push_categories,
    {},
    "defaults are not stored",
  );
  const some = await saveNotificationSettings(
    db,
    id,
    { categories: [{ key: "rides", push: false }] },
    withPush,
  );
  assert.deepEqual(
    some.categories.map((c) => c.push.enabled),
    [false, true, false],
  );
  assert.deepEqual(
    (await stored(id)).push_categories,
    { rides: false },
    "only the choice that was made",
  );
  // Push and e-mail are independent: neither follows the other.
  assert.equal(some.channels.email.enabled, false);
  const mailOnly = await saveNotificationSettings(
    db,
    id,
    {
      channels: { push: { enabled: false } },
      categories: [{ key: "rides", email: true }],
    },
    { ...withPush },
  );
  assert.equal(mailOnly.channels.push.enabled, false);
  assert.equal(mailOnly.channels.email.enabled, false, "mail is still off");
  assert.equal(
    mailOnly.categories[0].email.enabled,
    true,
    "the choice of a category does not switch the channel on",
  );
  await saveNotificationSettings(
    db,
    id,
    { channels: { email: { enabled: true } } },
    withPush,
  );
  const both = await notificationSettings(db, id, withPush);
  assert.equal(both.channels.email.enabled, true);
  assert.equal(both.channels.push.enabled, false);
});

test("a change names categories once and only channels that can carry them", () => {
  const bad = (value: unknown) => notificationSettingsPatch.safeParse(value);
  assert.equal(bad({}).success, true);
  assert.equal(
    bad({ categories: [{ key: "market", email: true }] }).success,
    true,
  );
  for (const value of [
    { categories: [{ key: "market", push: true }] },
    { categories: [{ key: "reactions", email: true }] },
    { categories: [{ key: "site", push: false }] },
    {
      categories: [
        { key: "rides", email: true },
        { key: "rides", push: true },
      ],
    },
    { categories: [{ key: "nearby", push: true }] },
    { categories: [{ key: "rides", sms: true }] },
    { channels: { sms: { enabled: true } } },
    { channels: { push: { enabled: "yes" } } },
    { reminders: "no" },
    { userId: randomUUID() },
  ])
    assert.equal(bad(value).success, false, JSON.stringify(value));
  const issues = bad({ categories: [{ key: "market", push: true }] });
  assert.ok(!issues.success);
  assert.deepEqual(issues.error.issues[0].path, ["categories", 0, "push"]);
  assert.throws(
    () =>
      invalid<never>(
        notificationSettingsPatch.parse({ categories: [{ key: "nearby" }] }),
      ),
    ZodError,
  );
});

test("a change that changes nothing writes nothing; a real one changes the version", async () => {
  const id = await person();
  const first = await saveNotificationSettings(
    db,
    id,
    { categories: [{ key: "discussions", email: false }], reminders: true },
    { env: mail },
  );
  assert.equal(first.version, "-|-", "still the defaults: no row, no version");
  assert.equal(
    (
      await db.query("SELECT 1 FROM notification_settings WHERE user_id=$1", [
        id,
      ])
    ).rowCount,
    0,
  );
  const changed = await saveNotificationSettings(
    db,
    id,
    { categories: [{ key: "discussions", email: false }], reminders: false },
    { env: mail },
  );
  assert.notEqual(changed.version, first.version);
  assert.ok(changed.updatedAt);
  const again = await saveNotificationSettings(
    db,
    id,
    { reminders: false },
    { env: mail },
  );
  assert.equal(again.version, changed.version);
  assert.equal(again.updatedAt, changed.updatedAt);
});

test("a precondition sees the version it will change and can refuse before anything is written", async () => {
  const id = await person();
  const seen: string[] = [];
  const first = await saveNotificationSettings(
    db,
    id,
    { reminders: false },
    { env: mail, precondition: (version) => seen.push(version) },
  );
  assert.deepEqual(
    seen,
    ["-|-", "-|-"],
    "the state before the change, both before and after the row is made for the lock",
  );
  await assert.rejects(
    db.transaction((tx) =>
      saveNotificationSettings(
        tx,
        id,
        { reminders: true },
        {
          env: mail,
          precondition: (version) => {
            assert.equal(version, first.version);
            throw new Error("stale");
          },
        },
      ),
    ),
    /stale/,
  );
  assert.equal((await stored(id)).reminders, false, "rolled back");
});

test("the first change of an account applies to the version of the defaults, and a row made for the lock has no date", async () => {
  const id = await person();
  const defaults = await notificationSettings(db, id, { env: mail });
  const saved = await saveNotificationSettings(
    db,
    id,
    { reminders: false },
    {
      env: mail,
      precondition: (version) => {
        if (version !== defaults.version) throw new Error("stale");
      },
    },
  );
  assert.equal(saved.reminders, false);
  assert.notEqual(saved.version, defaults.version);
  assert.ok(saved.updatedAt);
  const other = await person();
  await db.query("INSERT INTO notification_settings(user_id) VALUES($1)", [
    other,
  ]);
  const placeholder = await notificationSettings(db, other, { env: mail });
  assert.equal(placeholder.version, "-|-");
  assert.equal(placeholder.updatedAt, null);
});

test("an unsubscribe link and a settings change both move the version", async () => {
  const id = await person();
  await saveNotificationSettings(
    db,
    id,
    { channels: { email: { enabled: true } } },
    { env: mail },
  );
  const before = await notificationSettings(db, id, { env: mail });
  const key = (
    await one<{ unsubscribe_key: string }>(
      db,
      "SELECT unsubscribe_key FROM notification_email_preferences WHERE user_id=$1",
      [id],
    )
  ).unsubscribe_key;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    await unsubscribeNotificationEmail(
      db,
      notificationUnsubscribeToken(id, key),
    ),
    true,
  );
  const after = await notificationSettings(db, id, { env: mail });
  assert.equal(after.channels.email.enabled, false);
  assert.notEqual(after.version, before.version);
});

test("migration 054 keeps the reminder choices that differ from the default", async () => {
  const old = await testDatabase({ migrated: false });
  try {
    await migrateOnly(old, (file) => file < "054");
    const on = randomUUID();
    const off = randomUUID();
    for (const [id, reminders] of [
      [on, true],
      [off, false],
    ] as const) {
      await old.query(
        "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'R','h',$3)",
        [id, id + "@example.test", "u" + id.slice(0, 8)],
      );
      await old.query(
        "INSERT INTO notification_email_preferences(user_id,ride_reminders) VALUES($1,$2)",
        [id, reminders],
      );
    }
    await old.exec(
      await readFile(
        new URL("../db/054_notification_settings.sql", import.meta.url),
        "utf8",
      ),
    );
    const rows = await old.query<{
      user_id: string;
      reminders: boolean;
      dated: boolean;
    }>(
      "SELECT user_id,reminders,updated_at IS NOT NULL dated FROM notification_settings ORDER BY user_id",
    );
    assert.deepEqual(rows.rows, [
      { user_id: off, reminders: false, dated: true },
    ]);
  } finally {
    await old.close();
  }
});
