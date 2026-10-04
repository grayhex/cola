import type { Queryable } from "./db.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  notificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from "./notification-settings.ts";

// The e-mail view of the account's notification settings, as the site's own
// settings form and its route have always had it (#148). The model is
// notification-settings.ts (#341); the signed unsubscribe link below is the
// e-mail channel's alone.

export const notificationEmailInput = z
  .object({
    enabled: z.boolean(),
    discussions: z.boolean(),
    rides: z.boolean(),
    market: z.boolean(),
    reminders: z.boolean().optional(),
  })
  .strict();
export type NotificationEmailPreferences = z.infer<
  typeof notificationEmailInput
>;
export interface NotificationEmailSettings extends NotificationEmailPreferences {
  reminders: boolean;
  available: boolean;
  verified: boolean;
}
export const defaultNotificationEmail: NotificationEmailPreferences = {
  enabled: false,
  discussions: false,
  rides: false,
  market: false,
  reminders: true,
};
function emailView(settings: NotificationSettings): NotificationEmailSettings {
  const flag = (key: string) =>
    settings.categories.find((category) => category.key === key)?.email
      .enabled === true;
  return {
    enabled: settings.channels.email.enabled,
    discussions: flag("discussions"),
    rides: flag("rides"),
    market: flag("market"),
    reminders: settings.reminders,
    available: settings.channels.email.available,
    verified: settings.channels.email.verified,
  };
}
export async function notificationEmailSettings(
  q: Queryable,
  userId: string,
  env = process.env,
): Promise<NotificationEmailSettings> {
  return emailView(await notificationSettings(q, userId, { env }));
}
export async function saveNotificationEmail(
  q: Queryable,
  userId: string,
  input: NotificationEmailPreferences,
  env = process.env,
) {
  const value = notificationEmailInput.parse(input);
  return emailView(
    await saveNotificationSettings(
      q,
      userId,
      {
        channels: { email: { enabled: value.enabled } },
        categories: [
          { key: "discussions", email: value.discussions },
          { key: "rides", email: value.rides },
          { key: "market", email: value.market },
        ],
        ...(value.reminders === undefined
          ? {}
          : { reminders: value.reminders }),
      },
      { env },
    ),
  );
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
    await q.query<{ ok: boolean }>(
      `WITH disabled AS (UPDATE notification_email_preferences SET enabled=false,updated_at=now() WHERE user_id=$1 AND unsubscribe_key=$2 RETURNING user_id),
      cancelled AS (UPDATE notification_email_outbox o SET status='skipped',error_code='preferences',finished_at=now(),lease_token=NULL,lease_until=NULL
        FROM disabled p WHERE o.recipient_id=p.user_id AND o.status IN ('pending','sending') RETURNING o.notification_id)
      SELECT EXISTS(SELECT 1 FROM disabled) ok`,
      [id, row.unsubscribe_key],
    )
  ).rows[0]?.ok;
}
