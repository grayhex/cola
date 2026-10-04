import type { Queryable } from "./db.ts";
import { z } from "zod";
import { mailEnabled } from "./mail.ts";
import { CommunityError } from "./community-validation.ts";
import {
  notificationCategories,
  notificationCategoryKeys,
  notificationEmailCategorySql,
  type NotificationCategoryKey,
} from "./notification-catalog.ts";

// One account-level model of what a person wants to be told about (#341), read
// and written by the site, the API and the e-mail unsubscribe link. E-mail
// consent lives in `notification_email_preferences` (its queue budget and
// unsubscribe key are that channel's), everything else in `notification_settings`;
// this module is the only place that knows both. A phone's own permission and
// registration are not here: the server cannot grant them.

/**
 * Whether push can carry a message at all. The transport and the device
 * registry arrive with #342; until then no one can consent to push, exactly as
 * nobody can consent to e-mail while SMTP is not configured.
 */
export const pushAvailable = (): boolean => false;

export interface SettingsFlag {
  /** The channel can carry this category at all. */
  supported: boolean;
  enabled: boolean;
}
export interface NotificationCategorySetting {
  key: NotificationCategoryKey;
  label: string;
  email: SettingsFlag;
  push: SettingsFlag;
}
export interface NotificationSettings {
  channels: {
    email: { available: boolean; verified: boolean; enabled: boolean };
    push: { available: boolean; enabled: boolean };
  };
  /** Only the categories a channel can carry and the server produces today. */
  categories: NotificationCategorySetting[];
  /** The reminder of an accepted ride, for every channel (default on). */
  reminders: boolean;
  /** When the settings last changed; null while they are still the defaults. */
  updatedAt: string | null;
  /** The state a precondition is checked against (the ETag of the API is made of it). */
  version: string;
}

export interface SettingsOptions {
  env?: NodeJS.ProcessEnv;
  /** For tests and for #342, which makes the transport real. */
  pushReady?: boolean;
}

const switchable = notificationCategoryKeys.filter(
  (key) =>
    notificationCategories[key].email || notificationCategories[key].push,
);
const emailCategory = (key: NotificationCategoryKey) =>
  key === "discussions" || key === "rides" || key === "market" ? key : null;

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
interface SettingsRow {
  verified: boolean;
  email_enabled: boolean;
  email_discussions: boolean;
  email_rides: boolean;
  email_market: boolean;
  reminders: boolean;
  push_enabled: boolean;
  push_categories: unknown;
  email_stamp: string | null;
  settings_stamp: string | null;
}
const pushChoices = z.record(z.string(), z.boolean());

export async function notificationSettings(
  q: Queryable,
  userId: string,
  { env = process.env, pushReady = pushAvailable() }: SettingsOptions = {},
): Promise<NotificationSettings> {
  const { rows } = await q.query<SettingsRow>(
    `SELECT u.email_verified_at IS NOT NULL verified,coalesce(p.enabled,false) email_enabled,coalesce(p.discussions,false) email_discussions,
    coalesce(p.rides,false) email_rides,coalesce(p.market,false) email_market,coalesce(s.reminders,true) reminders,
    coalesce(s.push_enabled,false) push_enabled,coalesce(s.push_categories,'{}'::jsonb) push_categories,
    ${stamp("p.updated_at")} email_stamp,${stamp("s.updated_at")} settings_stamp
    FROM users u LEFT JOIN notification_email_preferences p ON p.user_id=u.id LEFT JOIN notification_settings s ON s.user_id=u.id
    WHERE u.id=$1 AND NOT u.blocked`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new CommunityError("Пользователь недоступен", 404);
  const chosen = pushChoices.safeParse(row.push_categories);
  const push = chosen.success ? chosen.data : {};
  const emailFlags: Record<string, boolean> = {
    discussions: row.email_discussions,
    rides: row.email_rides,
    market: row.email_market,
  };
  const stamps = [row.email_stamp, row.settings_stamp].filter(
    (value): value is string => value !== null,
  );
  return {
    channels: {
      email: {
        available: mailEnabled(env),
        verified: row.verified,
        enabled: row.email_enabled,
      },
      push: { available: pushReady, enabled: row.push_enabled },
    },
    categories: switchable.map((key) => {
      const category = notificationCategories[key];
      const mail = emailCategory(key);
      return {
        key,
        label: category.label,
        email: {
          supported: category.email,
          enabled: category.email && mail !== null && emailFlags[mail] === true,
        },
        push: {
          supported: category.push,
          enabled:
            category.push &&
            (Object.hasOwn(push, key) ? push[key] : category.pushDefault),
        },
      };
    }),
    reminders: row.reminders,
    updatedAt: stamps.sort().at(-1) ?? null,
    version: `${row.email_stamp ?? "-"}|${row.settings_stamp ?? "-"}`,
  };
}

/**
 * A change to the settings: only what is given changes. A category appears once
 * and names only channels that can carry it.
 */
export const notificationSettingsPatch = z
  .strictObject({
    channels: z
      .strictObject({
        email: z.strictObject({ enabled: z.boolean().optional() }).optional(),
        push: z.strictObject({ enabled: z.boolean().optional() }).optional(),
      })
      .optional(),
    categories: z
      .array(
        z.strictObject({
          key: z.enum(notificationCategoryKeys),
          email: z.boolean().optional(),
          push: z.boolean().optional(),
        }),
      )
      .max(notificationCategoryKeys.length)
      .optional(),
    reminders: z.boolean().optional(),
  })
  .superRefine((patch, context) => {
    const seen = new Set<string>();
    patch.categories?.forEach((item, index) => {
      const category = notificationCategories[item.key];
      if (seen.has(item.key))
        context.addIssue({
          code: "custom",
          path: ["categories", index, "key"],
          message: "Категория указана дважды",
        });
      seen.add(item.key);
      for (const channel of ["email", "push"] as const)
        if (item[channel] !== undefined && !category[channel])
          context.addIssue({
            code: "custom",
            path: ["categories", index, channel],
            message: "Этот канал не передаёт такую категорию",
          });
    });
  });
export type NotificationSettingsPatch = z.infer<
  typeof notificationSettingsPatch
>;

interface Plan {
  emailEnabled: boolean;
  email: Record<string, boolean>;
  pushEnabled: boolean;
  push: Record<string, boolean>;
  reminders: boolean;
  emailChanged: boolean;
  pushChanged: boolean;
}
/**
 * What an account needs before e-mail can carry anything: an address that is
 * verified and a sender that is configured.
 */
export function requireEmailChannel(settings: NotificationSettings) {
  if (!settings.channels.email.verified)
    throw new CommunityError(
      "Подтвердите почту, чтобы получать внешние уведомления",
      403,
    );
  if (!settings.channels.email.available)
    throw new CommunityError(
      "Отправка уведомлений по почте пока не настроена",
      503,
    );
}

/**
 * What the settings become, and whether that differs from what they are. A
 * channel is only switched on if it works (an address that is verified, a
 * sender that is configured, a push that is connected); switching off, saying
 * what already is and the reminder, which every channel shares, never need
 * that.
 */
function plan(
  current: NotificationSettings,
  change: NotificationSettingsPatch,
): Plan {
  const email = Object.fromEntries(
    current.categories.map((c) => [c.key, c.email.enabled]),
  );
  const push = Object.fromEntries(
    current.categories.map((c) => [c.key, c.push.enabled]),
  );
  let emailEnabled = current.channels.email.enabled;
  let pushEnabled = current.channels.push.enabled;
  let pushTouched = false;
  if (change.channels?.email?.enabled !== undefined)
    emailEnabled = change.channels.email.enabled;
  if (change.channels?.push?.enabled !== undefined) {
    pushEnabled = change.channels.push.enabled;
    pushTouched = true;
  }
  const enablingEmail: string[] = [];
  const enablingPush: string[] = [];
  for (const item of change.categories ?? []) {
    if (item.email !== undefined) {
      if (item.email && !email[item.key]) enablingEmail.push(item.key);
      email[item.key] = item.email;
    }
    if (item.push !== undefined) {
      if (item.push && !push[item.key]) enablingPush.push(item.key);
      push[item.key] = item.push;
      pushTouched = true;
    }
  }
  // Switching e-mail on, or a category of it while it is on. A category chosen
  // while the channel stays off is only a preference: nothing is sent.
  if (
    emailEnabled &&
    (!current.channels.email.enabled || enablingEmail.length > 0)
  )
    requireEmailChannel(current);
  if (
    pushTouched &&
    !current.channels.push.available &&
    ((pushEnabled && !current.channels.push.enabled) || enablingPush.length)
  )
    throw new CommunityError("Push-уведомления пока не подключены", 503);
  const reminders = change.reminders ?? current.reminders;
  const differs = (now: Record<string, boolean>, was: "email" | "push") =>
    current.categories.some((c) => c[was].enabled !== now[c.key]);
  return {
    emailEnabled,
    email,
    pushEnabled,
    push,
    reminders,
    emailChanged:
      emailEnabled !== current.channels.email.enabled ||
      reminders !== current.reminders ||
      differs(email, "email"),
    pushChanged:
      pushEnabled !== current.channels.push.enabled || differs(push, "push"),
  };
}

/**
 * Applies a change and returns the settings as they are now. A change that
 * changes nothing writes nothing (so the version stays). Call it in a
 * transaction: the row of the settings is locked so that two changes of one
 * account take turns, and `precondition` (an If-Match check) sees the state it
 * will change.
 */
export async function saveNotificationSettings(
  q: Queryable,
  userId: string,
  patch: NotificationSettingsPatch,
  {
    precondition,
    ...options
  }: SettingsOptions & { precondition?: (version: string) => void } = {},
): Promise<NotificationSettings> {
  const change = notificationSettingsPatch.parse(patch);
  const seen = await notificationSettings(q, userId, options);
  precondition?.(seen.version);
  if (!hasChange(plan(seen, change))) return seen;
  // The row exists before it is locked; a reminder choice made earlier in the
  // e-mail preferences carries over.
  await q.query(
    `INSERT INTO notification_settings(user_id,reminders)
    VALUES($1,coalesce((SELECT ride_reminders FROM notification_email_preferences WHERE user_id=$1),true)) ON CONFLICT(user_id) DO NOTHING`,
    [userId],
  );
  await q.query(
    "SELECT 1 FROM notification_settings WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  const current = await notificationSettings(q, userId, options);
  precondition?.(current.version);
  const next = plan(current, change);
  if (!hasChange(next)) return current;
  if (next.emailChanged)
    await q.query(
      `WITH saved AS (INSERT INTO notification_email_preferences(user_id,enabled,discussions,rides,market,ride_reminders) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,discussions=excluded.discussions,rides=excluded.rides,market=excluded.market,ride_reminders=excluded.ride_reminders,
        unsubscribe_key=CASE WHEN excluded.enabled AND NOT notification_email_preferences.enabled THEN gen_random_uuid()::text||gen_random_uuid()::text ELSE notification_email_preferences.unsubscribe_key END,updated_at=now()
      RETURNING user_id,enabled,discussions,rides,market,ride_reminders)
      UPDATE notification_email_outbox o SET status='skipped',error_code='preferences',finished_at=now(),lease_token=NULL,lease_until=NULL
      FROM notifications n,saved p WHERE o.notification_id=n.id AND o.recipient_id=p.user_id AND o.status IN ('pending','sending')
        AND (NOT p.enabled OR (n.type='ride_reminder' AND NOT p.ride_reminders) OR NOT coalesce(CASE ${notificationEmailCategorySql("n.type")} WHEN 'discussions' THEN p.discussions WHEN 'rides' THEN p.rides WHEN 'market' THEN p.market END,false))`,
      [
        userId,
        next.emailEnabled,
        next.email.discussions === true,
        next.email.rides === true,
        next.email.market === true,
        next.reminders,
      ],
    );
  // Only a choice the person made is stored, when they make it: the others
  // keep following the catalogue's default.
  const choices = (
    await q.query<{ push_categories: unknown }>(
      "SELECT push_categories FROM notification_settings WHERE user_id=$1",
      [userId],
    )
  ).rows[0]?.push_categories;
  const explicit = pushChoices.safeParse(choices);
  const chosen: Record<string, boolean> = explicit.success ? explicit.data : {};
  for (const item of change.categories ?? [])
    if (item.push !== undefined) chosen[item.key] = item.push;
  await q.query(
    "UPDATE notification_settings SET reminders=$2,push_enabled=$3,push_categories=$4::jsonb,updated_at=now() WHERE user_id=$1",
    [userId, next.reminders, next.pushEnabled, JSON.stringify(chosen)],
  );
  return notificationSettings(q, userId, options);
}
const hasChange = (next: Plan) => next.emailChanged || next.pushChanged;
