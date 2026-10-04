import type { Queryable } from "./db.ts";
import { z } from "zod";
import { mailEnabled } from "./mail.ts";
import { CommunityError } from "./community-validation.ts";
import type { PublicAuthor } from "./contracts.ts";
import {
  canonicalTimeZone,
  circleModes,
  formatClock,
  muteKinds,
  parseClock,
  type CircleMode,
  type MuteKind,
} from "./notification-policy.ts";
import { publicAuthor } from "./profile-dto.ts";
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
  /** The person's own IANA time zone, which quiet hours are read in; null until known. */
  timeZone: string | null;
  /** While the window is open the interrupting channels wait for its end. */
  quietHours: {
    enabled: boolean;
    from: string;
    to: string;
    /** The explicit choice that a close, confirmed cancellation is not held back. */
    allowCancellations: boolean;
  };
  /** The external channels are silent until then; null when no pause is on. */
  pausedUntil: string | null;
  /** Whose new plans and intents the person is told about. */
  circle: { mode: CircleMode; members: PublicAuthor[] };
  /** Also tell about intents that are still only "considering". */
  considering: boolean;
  mutes: NotificationMute[];
  /** When the settings last changed; null while they are still the defaults. */
  updatedAt: string | null;
  /** The state a precondition is checked against (the ETag of the API is made of it). */
  version: string;
}

export interface NotificationMute {
  kind: MuteKind;
  id: string;
  /** What the target is called, when the person may know it; else null. */
  label: string | null;
}
export const circleLimit = 200;
export const muteLimit = 500;

export interface SettingsOptions {
  env?: NodeJS.ProcessEnv;
  /** For tests and for #342, which makes the transport real. */
  pushReady?: boolean;
  /** The clock a pause is read and validated by. */
  now?: Date;
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
  time_zone: string | null;
  quiet_enabled: boolean;
  quiet_from: number;
  quiet_to: number;
  quiet_cancel: boolean;
  paused_until: Date | null;
  circle: CircleMode;
  considering: boolean;
  email_stamp: string | null;
  settings_stamp: string | null;
}
const pushChoices = z.record(z.string(), z.boolean());

export async function notificationSettings(
  q: Queryable,
  userId: string,
  {
    env = process.env,
    pushReady = pushAvailable(),
    now = new Date(),
  }: SettingsOptions = {},
): Promise<NotificationSettings> {
  const { rows } = await q.query<SettingsRow>(
    `SELECT u.email_verified_at IS NOT NULL verified,coalesce(p.enabled,false) email_enabled,coalesce(p.discussions,false) email_discussions,
    coalesce(p.rides,false) email_rides,coalesce(p.market,false) email_market,coalesce(s.reminders,true) reminders,
    coalesce(s.push_enabled,false) push_enabled,coalesce(s.push_categories,'{}'::jsonb) push_categories,
    s.time_zone,coalesce(s.quiet_enabled,false) quiet_enabled,coalesce(s.quiet_from,1320) quiet_from,coalesce(s.quiet_to,420) quiet_to,
    coalesce(s.quiet_cancel,false) quiet_cancel,s.paused_until,coalesce(s.circle,'friends') circle,coalesce(s.considering,false) considering,
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
  const members = (
    await q.query<{
      id: string;
      username: string;
      name: string;
      avatar_id: string | null;
    }>(
      `SELECT u.id,u.username,u.name,u.avatar_id FROM notification_circle_members c JOIN users u ON u.id=c.member_id
      WHERE c.user_id=$1 AND NOT u.blocked ORDER BY c.created_at,u.id LIMIT ${circleLimit}`,
      [userId],
    )
  ).rows;
  const mutes = (
    await q.query<{ kind: MuteKind; id: string; label: string | null }>(
      `SELECT m.kind,m.target_id id,CASE m.kind
        WHEN 'author' THEN (SELECT a.name FROM users a WHERE a.id=m.target_id AND NOT a.blocked)
        ELSE coalesce(
          (SELECT r.title FROM rides r JOIN bikes rb ON rb.id=r.bike_id WHERE r.id=m.target_id AND (r.owner_id=$1 OR (r.is_public AND rb.is_public))),
          CASE WHEN m.kind='discussion' THEN (SELECT b.name FROM bikes b WHERE b.id=m.target_id AND (b.owner_id=$1 OR b.is_public)) END) END label
      FROM notification_mutes m WHERE m.user_id=$1 ORDER BY m.created_at,m.target_id LIMIT ${muteLimit}`,
      [userId],
    )
  ).rows;
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
    timeZone: row.time_zone,
    quietHours: {
      enabled: row.quiet_enabled,
      from: formatClock(row.quiet_from),
      to: formatClock(row.quiet_to),
      allowCancellations: row.quiet_cancel,
    },
    pausedUntil:
      row.paused_until && new Date(row.paused_until) > now
        ? new Date(row.paused_until).toISOString()
        : null,
    circle: {
      mode: row.circle,
      members: members.map((member) => publicAuthor(member)),
    },
    considering: row.considering,
    mutes: mutes.map((mute) => ({ ...mute, label: mute.label || null })),
    updatedAt: stamps.sort().at(-1) ?? null,
    version: `${row.email_stamp ?? "-"}|${row.settings_stamp ?? "-"}`,
  };
}

const clock = z.string().refine((value) => parseClock(value) !== null, {
  message: "Время суток — ЧЧ:ММ, например 22:30",
});
const peopleList = z.array(z.uuid()).max(50);
const muteList = z
  .array(z.strictObject({ kind: z.enum(muteKinds), id: z.uuid() }))
  .max(50);

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
    timeZone: z
      .string()
      .max(64)
      .refine((value) => canonicalTimeZone(value) !== null, {
        message: "Часовой пояс — название из базы IANA, например Europe/Moscow",
      })
      .optional(),
    quietHours: z
      .strictObject({
        enabled: z.boolean().optional(),
        from: clock.optional(),
        to: clock.optional(),
        allowCancellations: z.boolean().optional(),
      })
      .optional(),
    pausedUntil: z.iso
      .datetime()
      .nullable()
      .describe("null снимает паузу")
      .optional(),
    circle: z
      .strictObject({
        mode: z.enum(circleModes).optional(),
        add: peopleList.optional(),
        remove: peopleList.optional(),
      })
      .optional(),
    considering: z.boolean().optional(),
    mutes: z
      .strictObject({ add: muteList.optional(), remove: muteList.optional() })
      .optional(),
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
  /** The time, pause, circle and "considering" choices, whole. */
  policy: {
    timeZone: string | null;
    quietEnabled: boolean;
    quietFrom: number;
    quietTo: number;
    quietCancel: boolean;
    pausedUntil: Date | null;
    circle: CircleMode;
    considering: boolean;
  };
  policyChanged: boolean;
  circleAdd: string[];
  circleRemove: string[];
  muteAdd: { kind: MuteKind; id: string }[];
  muteRemove: { kind: MuteKind; id: string }[];
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
 * The time, pause, circle and "considering" choices a change leads to. A quiet
 * window needs the person's time zone and a length; a pause lies in the near
 * future (the choice to end it is `null`).
 */
function planPolicy(
  current: NotificationSettings,
  change: NotificationSettingsPatch,
  now: Date,
) {
  const quiet = change.quietHours ?? {};
  const timeZone =
    change.timeZone !== undefined
      ? canonicalTimeZone(change.timeZone)
      : current.timeZone;
  const next: Plan["policy"] = {
    timeZone,
    quietEnabled: quiet.enabled ?? current.quietHours.enabled,
    quietFrom: parseClock(quiet.from ?? current.quietHours.from) ?? 0,
    quietTo: parseClock(quiet.to ?? current.quietHours.to) ?? 0,
    quietCancel:
      quiet.allowCancellations ?? current.quietHours.allowCancellations,
    pausedUntil:
      change.pausedUntil !== undefined
        ? change.pausedUntil
          ? new Date(change.pausedUntil)
          : null
        : current.pausedUntil
          ? new Date(current.pausedUntil)
          : null,
    circle: change.circle?.mode ?? current.circle.mode,
    considering: change.considering ?? current.considering,
  };
  if (next.quietEnabled && !next.timeZone)
    throw new CommunityError(
      "Чтобы включить тихие часы, укажите часовой пояс",
      400,
    );
  if (next.quietEnabled && next.quietFrom === next.quietTo)
    throw new CommunityError(
      "Тихие часы не могут начинаться и заканчиваться в одно время",
      400,
    );
  if (
    change.pausedUntil &&
    next.pausedUntil &&
    (next.pausedUntil <= now ||
      next.pausedUntil.getTime() - now.getTime() > 365 * 86400_000)
  )
    throw new CommunityError(
      "Пауза должна заканчиваться в будущем, не позже чем через год",
      400,
    );
  const was = {
    timeZone: current.timeZone,
    quietEnabled: current.quietHours.enabled,
    quietFrom: parseClock(current.quietHours.from),
    quietTo: parseClock(current.quietHours.to),
    quietCancel: current.quietHours.allowCancellations,
    pausedUntil: current.pausedUntil,
    circle: current.circle.mode,
    considering: current.considering,
  };
  const changed =
    was.timeZone !== next.timeZone ||
    was.quietEnabled !== next.quietEnabled ||
    was.quietFrom !== next.quietFrom ||
    was.quietTo !== next.quietTo ||
    was.quietCancel !== next.quietCancel ||
    (was.pausedUntil && new Date(was.pausedUntil).getTime()) !==
      (next.pausedUntil && next.pausedUntil.getTime()) ||
    was.circle !== next.circle ||
    was.considering !== next.considering;
  return { next, changed };
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
  userId: string,
  now: Date,
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
  const policy = planPolicy(current, change, now);
  const have = new Set(current.circle.members.map((member) => member.id));
  const circleAdd = [...new Set(change.circle?.add ?? [])].filter(
    (id) => !have.has(id),
  );
  const circleRemove = [...new Set(change.circle?.remove ?? [])].filter((id) =>
    have.has(id),
  );
  if (change.circle?.add?.includes(userId))
    throw new CommunityError("Себя в круг добавлять не нужно", 400);
  if (
    have.size + circleAdd.length - circleRemove.length > circleLimit &&
    circleAdd.length
  )
    throw new CommunityError(
      `В круг можно добавить не больше ${circleLimit} человек`,
      400,
    );
  const kept = new Set(current.mutes.map((m) => m.kind + ":" + m.id));
  const unique = (items: { kind: MuteKind; id: string }[] = []) => [
    ...new Map(items.map((m) => [m.kind + ":" + m.id, m])).values(),
  ];
  const muteAdd = unique(change.mutes?.add).filter(
    (m) => !kept.has(m.kind + ":" + m.id),
  );
  const muteRemove = unique(change.mutes?.remove).filter((m) =>
    kept.has(m.kind + ":" + m.id),
  );
  if (muteAdd.some((m) => m.kind === "author" && m.id === userId))
    throw new CommunityError("Себя заглушить нельзя", 400);
  if (
    current.mutes.length + muteAdd.length - muteRemove.length > muteLimit &&
    muteAdd.length
  )
    throw new CommunityError(
      `Можно заглушить не больше ${muteLimit} объектов`,
      400,
    );
  return {
    policy: policy.next,
    policyChanged:
      policy.changed ||
      circleAdd.length > 0 ||
      circleRemove.length > 0 ||
      muteAdd.length > 0 ||
      muteRemove.length > 0,
    circleAdd,
    circleRemove,
    muteAdd,
    muteRemove,
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
  const now = options.now ?? new Date();
  const seen = await notificationSettings(q, userId, options);
  precondition?.(seen.version);
  if (!hasChange(plan(seen, change, userId, now))) return seen;
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
  const next = plan(current, change, userId, now);
  if (!hasChange(next)) return current;
  if (next.circleAdd.length) {
    // Only people who exist and may be named: nothing here says who else does.
    const found = await q.query<{ id: string }>(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) AND NOT blocked AND id<>$2",
      [next.circleAdd, userId],
    );
    if (found.rows.length !== next.circleAdd.length)
      throw new CommunityError("Этого человека нельзя добавить в круг", 400);
  }
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
    `UPDATE notification_settings SET reminders=$2,push_enabled=$3,push_categories=$4::jsonb,
    time_zone=$5,quiet_enabled=$6,quiet_from=$7,quiet_to=$8,quiet_cancel=$9,paused_until=$10,circle=$11,considering=$12,updated_at=now() WHERE user_id=$1`,
    [
      userId,
      next.reminders,
      next.pushEnabled,
      JSON.stringify(chosen),
      next.policy.timeZone,
      next.policy.quietEnabled,
      next.policy.quietFrom,
      next.policy.quietTo,
      next.policy.quietCancel,
      next.policy.pausedUntil,
      next.policy.circle,
      next.policy.considering,
    ],
  );
  if (next.circleRemove.length)
    await q.query(
      "DELETE FROM notification_circle_members WHERE user_id=$1 AND member_id=ANY($2::uuid[])",
      [userId, next.circleRemove],
    );
  if (next.circleAdd.length)
    await q.query(
      "INSERT INTO notification_circle_members(user_id,member_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",
      [userId, next.circleAdd],
    );
  for (const mute of next.muteRemove)
    await q.query(
      "DELETE FROM notification_mutes WHERE user_id=$1 AND kind=$2 AND target_id=$3",
      [userId, mute.kind, mute.id],
    );
  if (next.muteAdd.length)
    await q.query(
      "INSERT INTO notification_mutes(user_id,kind,target_id) SELECT $1,m.kind,m.id FROM jsonb_to_recordset($2::jsonb) AS m(kind text,id uuid) ON CONFLICT DO NOTHING",
      [userId, JSON.stringify(next.muteAdd)],
    );
  return notificationSettings(q, userId, options);
}
const hasChange = (next: Plan) =>
  next.emailChanged || next.pushChanged || next.policyChanged;
