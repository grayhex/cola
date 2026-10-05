import { z } from "zod";
import type { Queryable } from "./db.ts";
import { mailEnabled, sendMail, type MailMessage } from "./mail.ts";
import { accountLink } from "./account.ts";
import { notificationMail } from "./mail-templates.ts";
import {
  notificationCategories,
  notificationCategoryKeys,
  notificationEvents,
  notificationTypes,
  plannedNotificationCategories,
} from "./notification-catalog.ts";
import { notificationEmailStatus } from "./notification-email.ts";
import {
  notificationFanoutStatus,
  notificationLimits,
} from "./notification-fanout.ts";
import { deliveryPolicy, externalVerdict } from "./notification-policy.ts";
import { pushAvailable } from "./push-config.ts";
import { pushStatus } from "./push-delivery.ts";
import { rideReminderScheduleStatus } from "./ride-notifications.ts";

// The admin side of the notifications (#341): the catalogue as the code has it,
// the limits and kill switches that are safe to change, why a person would or
// would not be told, and a test to the admin's own address. An admin never
// switches a consent on for a person, never writes to anyone but themselves
// and has no campaign: what they read about a person is the reasons, not the
// contents.

export class NotificationAdminError extends Error {
  declare status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
type Audit = (
  q: Queryable,
  actor: unknown,
  action: unknown,
  target: unknown,
) => Promise<void>;

export const adminNotificationLimitsInput = z.strictObject({
  /** The version the editor read: a change on top of another is refused. */
  version: z.int().min(1),
  discoveryPerDay: z.int().min(0).max(20),
  authorCooldownMinutes: z.int().min(0).max(10080),
  announcementsPerAuthorDay: z.int().min(1).max(100),
  audienceMax: z.int().min(1).max(100000),
  batch: z.int().min(1).max(1000),
  discoveryEnabled: z.boolean(),
  externalEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  nearbyEnabled: z.boolean(),
  nearbyMaxRadiusKm: z.int().min(5).max(100),
  nearbyDeviceTtlHours: z.int().min(1).max(72),
  disabledCategories: z
    .array(z.enum(notificationCategoryKeys))
    .max(notificationCategoryKeys.length)
    .refine((items) => new Set(items).size === items.length, {
      message: "Категория указана дважды",
    }),
});
export type AdminNotificationLimitsInput = z.infer<
  typeof adminNotificationLimitsInput
>;

/** The code's catalogue, for reading: what exists, what a channel can carry. */
export function notificationCatalogView() {
  return {
    categories: notificationCategoryKeys.map((key) => ({
      key,
      label: notificationCategories[key].label,
      email: notificationCategories[key].email,
      push: notificationCategories[key].push,
      pushDefault: notificationCategories[key].pushDefault,
    })),
    planned: Object.entries(plannedNotificationCategories).map(
      ([key, value]) => ({ key, label: value.label, issue: value.issue }),
    ),
    events: notificationTypes.map((type) => ({
      type,
      category: notificationEvents[type].category,
      email: "email" in notificationEvents[type],
    })),
  };
}

interface LimitsRow {
  version: number;
  updated_at: Date;
}
async function limitsRow(q: Queryable) {
  return (
    await q.query<LimitsRow>(
      "SELECT version,updated_at FROM notification_limits WHERE id=1",
    )
  ).rows[0];
}

/** Everything the admin page shows. Counts only: no names, no places, no texts. */
export async function adminNotifications(
  q: Queryable,
  env: NodeJS.ProcessEnv = process.env,
) {
  const row = await limitsRow(q);
  return {
    catalog: notificationCatalogView(),
    limits: await notificationLimits(q),
    version: row?.version ?? 1,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    channels: {
      email: { available: mailEnabled(env) },
      push: { available: pushAvailable() },
    },
    status: {
      email: await notificationEmailStatus(q),
      fanouts: await notificationFanoutStatus(q),
      push: await pushStatus(q),
      reminders: await rideReminderScheduleStatus(q),
    },
  };
}

/**
 * Changes the limits and switches, as a whole, on top of the version that was
 * read. The audit names what changed and never a person.
 */
export async function saveAdminNotifications(
  q: Queryable,
  actor: string,
  input: unknown,
  audit: Audit,
) {
  const change = adminNotificationLimitsInput.parse(input);
  const current = (
    await q.query<LimitsRow>(
      "SELECT version,updated_at FROM notification_limits WHERE id=1 FOR UPDATE",
    )
  ).rows[0];
  if (!current)
    throw new NotificationAdminError("Настройки уведомлений недоступны", 500);
  if (current.version !== change.version)
    throw new NotificationAdminError(
      "Настройки изменил другой администратор. Обновите страницу и повторите.",
      409,
    );
  const before = await notificationLimits(q);
  const next = {
    discoveryPerDay: change.discoveryPerDay,
    authorCooldownMinutes: change.authorCooldownMinutes,
    announcementsPerAuthorDay: change.announcementsPerAuthorDay,
    audienceMax: change.audienceMax,
    batch: change.batch,
    enabled: change.discoveryEnabled,
    externalEnabled: change.externalEnabled,
    pushEnabled: change.pushEnabled,
    disabledCategories: [...change.disabledCategories].sort(),
    nearbyEnabled: change.nearbyEnabled,
    nearbyMaxRadiusKm: change.nearbyMaxRadiusKm,
    nearbyDeviceTtlHours: change.nearbyDeviceTtlHours,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (key) =>
      JSON.stringify(next[key]) !==
      JSON.stringify(
        key === "disabledCategories"
          ? [...before.disabledCategories].sort()
          : before[key],
      ),
  );
  if (!changed.length) return adminNotifications(q);
  await q.query(
    `UPDATE notification_limits SET discovery_per_day=$1,author_cooldown_minutes=$2,announcements_per_author_day=$3,audience_max=$4,batch=$5,
    discovery_enabled=$6,external_enabled=$7,push_enabled=$9,disabled_categories=$8::text[],
    nearby_enabled=$10,nearby_max_radius_km=$11,nearby_device_ttl_hours=$12,version=version+1,updated_at=now() WHERE id=1`,
    [
      next.discoveryPerDay,
      next.authorCooldownMinutes,
      next.announcementsPerAuthorDay,
      next.audienceMax,
      next.batch,
      next.enabled,
      next.externalEnabled,
      next.disabledCategories,
      next.pushEnabled,
      next.nearbyEnabled,
      next.nearbyMaxRadiusKm,
      next.nearbyDeviceTtlHours,
    ],
  );
  await audit(
    q,
    actor,
    "notifications.limits",
    `${current.version + 1}: ${changed.join(",")}`,
  );
  return adminNotifications(q);
}

export interface Reason {
  code: string;
  /** True: this does not stop it; false: it does; null: it is not in play. */
  ok: boolean | null;
  text: string;
}

/**
 * Why a new plan or intent of `author` would, or would not, reach `recipient`:
 * the checks the walk makes, in their order, with what each found. Nothing
 * that either person wrote comes back, only the answers.
 */
export async function explainDiscovery(
  q: Queryable,
  actor: string,
  input: { author: string; recipient: string },
  audit: Audit,
  now = new Date(),
) {
  const named = async (username: string) =>
    (
      await q.query<{
        id: string;
        name: string;
        username: string;
        blocked: boolean;
      }>(
        "SELECT id,name,username,blocked FROM users WHERE lower(username)=lower($1)",
        [username.trim().replace(/^@/, "")],
      )
    ).rows[0];
  const [author, recipient] = await Promise.all([
    named(input.author),
    named(input.recipient),
  ]);
  if (!author || !recipient)
    throw new NotificationAdminError(
      "Не нашли пользователя с таким именем",
      404,
    );
  const reasons: Reason[] = [];
  const add = (code: string, ok: boolean | null, text: string) =>
    reasons.push({ code, ok, text });
  const limits = await notificationLimits(q);
  add(
    "switch",
    limits.enabled && !limits.disabledCategories.includes("plans"),
    limits.enabled && !limits.disabledCategories.includes("plans")
      ? "События планов и намерений включены"
      : "События планов и намерений выключены администратором",
  );
  add(
    "accounts",
    author.id !== recipient.id && !author.blocked && !recipient.blocked,
    author.id === recipient.id
      ? "Автор и получатель — один человек: себе не сообщают"
      : author.blocked || recipient.blocked
        ? "Один из аккаунтов заблокирован"
        : "Оба аккаунта активны",
  );
  const relation = (
    await q.query<{
      circle: string;
      follows: boolean;
      followed_back: boolean;
      picked: boolean;
      muted_author: boolean;
      considering: boolean;
    }>(
      `SELECT coalesce(s.circle,'friends') circle,
      EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$2 AND f.following_id=$1) follows,
      EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$1 AND f.following_id=$2) followed_back,
      EXISTS(SELECT 1 FROM notification_circle_members m WHERE m.user_id=$2 AND m.member_id=$1) picked,
      EXISTS(SELECT 1 FROM notification_mutes m WHERE m.user_id=$2 AND m.kind='author' AND m.target_id=$1) muted_author,
      coalesce(s.considering,false) considering
      FROM (SELECT 1) one LEFT JOIN notification_settings s ON s.user_id=$2`,
      [author.id, recipient.id],
    )
  ).rows[0];
  const inCircle =
    relation.circle === "friends"
      ? relation.follows && relation.followed_back
      : relation.circle === "follows"
        ? relation.follows
        : relation.circle === "selected"
          ? relation.picked
          : false;
  add(
    "circle",
    inCircle,
    {
      friends: "Круг получателя — друзья (взаимные подписки)",
      follows: "Круг получателя — все, на кого он подписан",
      selected: "Круг получателя — выбранные люди",
      off: "Получатель выключил новые планы и намерения",
    }[relation.circle] +
      (relation.circle === "off"
        ? ""
        : inCircle
          ? ": автор в круге"
          : ": автора в круге нет"),
  );
  add(
    "mute",
    !relation.muted_author,
    relation.muted_author
      ? "Получатель заглушил этого автора"
      : "Автор не заглушён",
  );
  add(
    "considering",
    null,
    relation.considering
      ? "Получатель просил сообщать и о намерениях «думаю»"
      : "Намерения «думаю» получатель не просил: о них не сообщают",
  );
  const inbox = reasons.every((reason) => reason.ok !== false);
  // What may leave the site: the budget, then the person's own time.
  const spent = (
    await q.query<{ today: number; recent: number }>(
      `SELECT count(*) FILTER(WHERE created_at>$3::timestamptz-interval '24 hours')::int today,
      count(*) FILTER(WHERE actor_id=$2 AND created_at>$3::timestamptz-make_interval(mins=>$4))::int recent
      FROM notifications WHERE recipient_id=$1 AND type IN ('plan_published','intent_published') AND external`,
      [recipient.id, author.id, now, limits.authorCooldownMinutes],
    )
  ).rows[0];
  add(
    "budget",
    spent.today < limits.discoveryPerDay && spent.recent === 0,
    spent.today >= limits.discoveryPerDay
      ? `За сутки получатель уже получил ${spent.today} из ${limits.discoveryPerDay} предложений наружу`
      : spent.recent > 0
        ? "От этого автора наружу недавно уже сообщали: пауза между сообщениями"
        : `За сутки отправлено ${spent.today} из ${limits.discoveryPerDay} предложений наружу`,
  );
  const timing = externalVerdict(await deliveryPolicy(q, recipient.id), {
    type: "plan_published",
    now,
  });
  add(
    "time",
    timing.action === "deliver",
    timing.action === "deliver"
      ? "Сейчас ни паузы, ни тихих часов"
      : timing.action === "defer"
        ? "Сейчас тихие часы получателя: наружу позже или не будет"
        : "Получатель на паузе: наружу не уйдёт",
  );
  add(
    "channel",
    limits.externalEnabled && !limits.disabledCategories.includes("plans"),
    limits.externalEnabled && !limits.disabledCategories.includes("plans")
      ? pushAvailable()
        ? limits.pushEnabled
          ? "Внешние каналы включены"
          : "Внешние каналы включены, push выключен администратором"
        : "Внешние каналы включены, но push не подключён на сервере"
      : "Внешние каналы выключены администратором",
  );
  const external =
    inbox &&
    reasons
      .filter((r) => ["budget", "time", "channel"].includes(r.code))
      .every((r) => r.ok !== false);
  await audit(
    q,
    actor,
    "notifications.explain",
    `${author.id}>${recipient.id}`,
  );
  return {
    author: { username: author.username, name: author.name },
    recipient: { username: recipient.username, name: recipient.name },
    inbox,
    external,
    reasons,
  };
}

/**
 * A test message to the admin's own verified address, and to nobody else. It
 * goes straight out, not through the queue of the people, and says what it is.
 */
export async function sendAdminTest(
  q: Queryable,
  actor: string,
  audit: Audit,
  env: NodeJS.ProcessEnv = process.env,
  send: (
    message: MailMessage,
    env: NodeJS.ProcessEnv,
  ) => Promise<unknown> = sendMail,
) {
  if (!mailEnabled(env))
    throw new NotificationAdminError("Отправка почты не настроена", 503);
  const admin = (
    await q.query<{ email: string; name: string; verified: boolean }>(
      "SELECT email,name,email_verified_at IS NOT NULL verified FROM users WHERE id=$1 AND role='admin' AND NOT blocked",
      [actor],
    )
  ).rows[0];
  if (!admin)
    throw new NotificationAdminError("Доступ только для администратора", 403);
  if (!admin.verified)
    throw new NotificationAdminError(
      "Подтвердите свою почту, чтобы получить тестовое письмо",
      403,
    );
  await send(
    {
      to: admin.email,
      ...notificationMail({
        name: admin.name,
        subject: "Проверка уведомлений",
        line: "Это тестовое письмо администратору: так выглядит письмо об уведомлении. Ничего делать не нужно.",
        target: "Тест из раздела «Настройки приложения»",
        link: accountLink("/account", "", env),
        unsubscribe: accountLink("/account", "", env),
      }),
    },
    env,
  );
  await audit(q, actor, "notifications.test", "email:self");
  return { sent: true };
}
