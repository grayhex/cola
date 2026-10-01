import type { Queryable } from "./db.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mailEnabled } from "./mail.ts";
import { CommunityError } from "./community-validation.ts";

export const notificationEmailInput = z
  .object({
    enabled: z.boolean(),
    discussions: z.boolean(),
    rides: z.boolean(),
    market: z.boolean(),
  })
  .strict();
export type NotificationEmailPreferences = z.infer<
  typeof notificationEmailInput
>;
export interface NotificationEmailSettings extends NotificationEmailPreferences {
  available: boolean;
  verified: boolean;
}
export const defaultNotificationEmail: NotificationEmailPreferences = {
  enabled: false,
  discussions: false,
  rides: false,
  market: false,
};
export async function notificationEmailSettings(
  q: Queryable,
  userId: string,
  env = process.env,
): Promise<NotificationEmailSettings> {
  const { rows } = await q.query<
    NotificationEmailPreferences & { verified: boolean }
  >(
    `SELECT coalesce(p.enabled,false) enabled,coalesce(p.discussions,false) discussions,coalesce(p.rides,false) rides,coalesce(p.market,false) market,u.email_verified_at IS NOT NULL verified FROM users u LEFT JOIN notification_email_preferences p ON p.user_id=u.id WHERE u.id=$1 AND NOT u.blocked`,
    [userId],
  );
  if (!rows[0]) throw new CommunityError("Пользователь недоступен", 404);
  return { ...rows[0], available: mailEnabled(env) };
}
export async function saveNotificationEmail(
  q: Queryable,
  userId: string,
  input: NotificationEmailPreferences,
  env = process.env,
) {
  const value = notificationEmailInput.parse(input);
  const current = await notificationEmailSettings(q, userId, env);
  if (value.enabled && !current.verified)
    throw new CommunityError(
      "Подтвердите почту, чтобы получать внешние уведомления",
      403,
    );
  if (value.enabled && !current.available)
    throw new CommunityError(
      "Отправка уведомлений по почте пока не настроена",
      503,
    );
  await q.query(
    `INSERT INTO notification_email_preferences(user_id,enabled,discussions,rides,market) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,discussions=excluded.discussions,rides=excluded.rides,market=excluded.market,
      unsubscribe_key=CASE WHEN excluded.enabled AND NOT notification_email_preferences.enabled THEN gen_random_uuid()::text||gen_random_uuid()::text ELSE notification_email_preferences.unsubscribe_key END,updated_at=now()`,
    [userId, value.enabled, value.discussions, value.rides, value.market],
  );
  return notificationEmailSettings(q, userId, env);
}
export function notificationUnsubscribeToken(
  userId: string,
  key: string,
  now = new Date(),
) {
  const payload = `${userId}.${Math.floor(now.getTime() / 1000) + 365 * 86400}`;
  return (
    payload +
    "." +
    createHmac("sha256", key).update(payload).digest("base64url")
  );
}
const tokenInput = z
  .string()
  .max(128)
  .regex(/^[0-9a-f-]{36}\.\d{10}\.[A-Za-z0-9_-]{43}$/);
export async function unsubscribeNotificationEmail(
  q: Queryable,
  token: unknown,
  now = new Date(),
) {
  const parsed = tokenInput.safeParse(token);
  if (!parsed.success) return false;
  const [id, expires, signature] = parsed.data.split(".");
  if (
    !z.uuid().safeParse(id).success ||
    Number(expires) < Math.floor(now.getTime() / 1000)
  )
    return false;
  const row = (
    await q.query<{ unsubscribe_key: string }>(
      "SELECT unsubscribe_key FROM notification_email_preferences WHERE user_id=$1",
      [id],
    )
  ).rows[0];
  if (!row) return false;
  const expected = createHmac("sha256", row.unsubscribe_key)
    .update(id + "." + expires)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return false;
  // The key predicate prevents a stale link disabling consent renewed in parallel.
  return !!(
    await q.query(
      "UPDATE notification_email_preferences SET enabled=false,updated_at=now() WHERE user_id=$1 AND unsubscribe_key=$2 RETURNING user_id",
      [id, row.unsubscribe_key],
    )
  ).rowCount;
}
