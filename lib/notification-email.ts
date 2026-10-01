import type { Queryable } from "./db.ts";
import type { MailMessage } from "./mail.ts";
import { randomUUID } from "node:crypto";
import { mailEnabled, sendMail } from "./mail.ts";
import { notificationEmailEvents } from "./notification-catalog.ts";
import { notificationUnsubscribeToken } from "./notification-preferences.ts";
import { notificationMail } from "./mail-templates.ts";
import { notificationPage } from "./notifications.ts";
import { noticeExpiringListings, expiryNoticeDays } from "./market.ts";
import { accountLink } from "./account.ts";
import { rideOccurrence } from "./ride-occurrence.ts";

export interface EmailJob {
  notification_id: string;
  recipient_id: string;
  lease_token: string;
  attempts: number;
}
export async function claimNotificationEmails(
  q: Queryable,
  now = new Date(),
  limit = 20,
) {
  const token = randomUUID();
  const eligible = (alias: string) =>
    `${alias}.expires_at>$1 AND ${alias}.available_at<=$1 AND ${alias}.attempts<8 AND (${alias}.status='pending' OR (${alias}.status='sending' AND ${alias}.lease_until<=$1))`;
  const { rows } = await q.query<EmailJob>(
    `WITH candidates AS (
    SELECT o.notification_id,o.recipient_id FROM notification_email_outbox o JOIN notification_email_preferences p ON p.user_id=o.recipient_id
    WHERE ${eligible("o")} AND p.next_delivery_at<=$1
      AND NOT EXISTS(SELECT 1 FROM notification_email_outbox earlier WHERE earlier.recipient_id=o.recipient_id AND ${eligible("earlier")} AND (earlier.created_at,earlier.notification_id)<(o.created_at,o.notification_id))
    ORDER BY o.recipient_id,o.created_at,o.notification_id LIMIT $2 FOR UPDATE OF o SKIP LOCKED
  ), reserved AS (
    UPDATE notification_email_preferences p SET next_delivery_at=$1::timestamptz+interval '20 minutes'
    FROM candidates c WHERE p.user_id=c.recipient_id AND p.next_delivery_at<=$1 RETURNING p.user_id
  ) UPDATE notification_email_outbox o SET status='sending',attempts=o.attempts+1,lease_token=$3,lease_until=$1::timestamptz+interval '3 minutes'
    FROM candidates c JOIN reserved p ON p.user_id=c.recipient_id WHERE o.notification_id=c.notification_id
    RETURNING o.notification_id,o.recipient_id,o.lease_token,o.attempts`,
    [now, Math.max(1, Math.min(100, limit)), token],
  );
  return rows;
}
type MailFailure = "smtp_temporary" | "smtp_permanent";
export function notificationMailFailure(error: unknown): MailFailure {
  if (error !== null && typeof error === "object") {
    const code = "code" in error ? error.code : undefined;
    const response = "responseCode" in error ? error.responseCode : undefined;
    if (typeof response === "number" && response >= 400 && response < 500)
      return "smtp_temporary";
    if (
      ["EAUTH", "EENVELOPE"].includes(typeof code === "string" ? code : "") ||
      (typeof response === "number" && response >= 500 && response < 600)
    )
      return "smtp_permanent";
  }
  return "smtp_temporary";
}
async function finish(
  q: Queryable,
  job: EmailJob,
  now: Date,
  status: "sent" | "failed" | "skipped" | "pending",
  code:
    | MailFailure
    | "expired"
    | "unavailable"
    | "preferences"
    | "attempts_exhausted"
    | null,
) {
  const delay = Math.min(6 * 3600, 60 * 2 ** Math.min(job.attempts - 1, 9));
  return !!(
    await q.query(
      `UPDATE notification_email_outbox SET status=$3,error_code=$4,finished_at=CASE WHEN $3='pending' THEN NULL ELSE $5::timestamptz END,
    available_at=CASE WHEN $3='pending' THEN $5::timestamptz+make_interval(secs=>$6) ELSE available_at END,lease_token=NULL,lease_until=NULL
    WHERE notification_id=$1 AND lease_token=$2 AND status='sending' RETURNING notification_id`,
      [job.notification_id, job.lease_token, status, code, now, delay],
    )
  ).rowCount;
}
export async function pruneNotificationEmails(q: Queryable, now = new Date()) {
  await q.query(
    `WITH old AS (SELECT notification_id FROM notification_email_outbox WHERE status IN ('pending','sending') AND (expires_at<=$1 OR attempts>=8) AND (status='pending' OR lease_until<=$1) ORDER BY recipient_id,notification_id LIMIT 500 FOR UPDATE SKIP LOCKED)
    UPDATE notification_email_outbox o SET status=CASE WHEN o.attempts>=8 THEN 'failed' ELSE 'skipped' END,error_code=CASE WHEN o.attempts>=8 THEN 'attempts_exhausted' ELSE 'expired' END,finished_at=$1,lease_until=NULL,lease_token=NULL FROM old WHERE o.notification_id=old.notification_id`,
    [now],
  );
  await q.query(
    `DELETE FROM notification_email_outbox WHERE notification_id IN (SELECT notification_id FROM notification_email_outbox WHERE status IN ('sent','failed','skipped') AND finished_at<$1::timestamptz-interval '30 days' ORDER BY notification_id LIMIT 1000)`,
    [now],
  );
}
async function delivery(
  q: Queryable,
  job: EmailJob,
  now: Date,
  env: NodeJS.ProcessEnv,
) {
  const row = (
    await q.query<{
      email: string;
      name: string;
      type: string;
      enabled: boolean;
      discussions: boolean;
      rides: boolean;
      market: boolean;
      unsubscribe_key: string;
      ride_id: string | null;
    }>(
      `SELECT u.email,u.name,n.type,n.ride_id,p.enabled,p.discussions,p.rides,p.market,p.unsubscribe_key FROM notification_email_outbox o
    JOIN notifications n ON n.id=o.notification_id AND n.recipient_id=o.recipient_id JOIN users u ON u.id=o.recipient_id JOIN notification_email_preferences p ON p.user_id=u.id
    WHERE o.notification_id=$1 AND o.lease_token=$2 AND o.status='sending' AND o.lease_until>$3 AND o.expires_at>$3 AND NOT u.blocked AND u.email_verified_at IS NOT NULL`,
      [job.notification_id, job.lease_token, now],
    )
  ).rows[0];
  if (!row) return { code: "unavailable" as const };
  const event = notificationEmailEvents[row.type];
  if (!event || !row.enabled || !row[event.category])
    return { code: "preferences" as const };
  const notice = (
    await notificationPage(q, job.recipient_id, 1, job.notification_id)
  ).notifications[0];
  if (!notice || notice.readAt) return { code: "unavailable" as const };
  if (
    row.type === "market_expiring" &&
    "state" in notice.target &&
    !["expiring", "expired"].includes(notice.target.state)
  )
    return { code: "unavailable" as const };
  if (row.type === "ride_invite") {
    const ride = (
      await q.query<{ occurs_at: Date }>(
        `SELECT (${rideOccurrence}) occurs_at FROM rides r WHERE r.id=$1 AND r.status='planned'`,
        [row.ride_id],
      )
    ).rows[0];
    if (!ride?.occurs_at || new Date(ride.occurs_at) <= now)
      return { code: "unavailable" as const };
  }
  const token = notificationUnsubscribeToken(
    job.recipient_id,
    row.unsubscribe_key,
    now,
  );
  return {
    message: {
      to: row.email,
      ...notificationMail({
        name: row.name,
        subject: event.subject,
        line: event.line,
        target: notice.target.name,
        actor: notice.actor?.name,
        link: new URL(
          notice.target.href,
          env.APP_ORIGIN || "http://localhost:3000",
        ).toString(),
        unsubscribe: accountLink("/unsubscribe", token, env),
      }),
    },
  };
}
export async function runNotificationEmailBatch(
  q: Queryable,
  {
    env = process.env,
    now,
    send = sendMail,
    limit = 20,
  }: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    send?: (message: MailMessage, env: NodeJS.ProcessEnv) => Promise<unknown>;
    limit?: number;
  } = {},
) {
  const currentTime = () => now || new Date();
  await pruneNotificationEmails(q, currentTime());
  const counts = {
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    disabled: !mailEnabled(env),
  };
  if (counts.disabled) return counts;
  // An email about expiry must not depend on the owner opening notifications.
  const owners = await q.query<{ owner_id: string }>(
    `SELECT DISTINCT m.owner_id FROM market_listings m JOIN users u ON u.id=m.owner_id JOIN notification_email_preferences p ON p.user_id=u.id
    WHERE m.status='active' AND m.expires_at<=$1::timestamptz+make_interval(days=>$2) AND m.expiry_notice_for IS DISTINCT FROM m.expires_at
      AND NOT u.blocked AND u.email_verified_at IS NOT NULL AND p.enabled AND p.market ORDER BY m.owner_id LIMIT 20`,
    [currentTime(), expiryNoticeDays],
  );
  for (const owner of owners.rows)
    await noticeExpiringListings(q, owner.owner_id, true);
  for (let index = 0; index < Math.max(1, Math.min(100, limit)); index++) {
    // Claim just before sending, so a slow SMTP batch cannot age later leases.
    const job = (await claimNotificationEmails(q, currentTime(), 1))[0];
    if (!job) break;
    counts.claimed++;
    // Read the current address, consent and visibility immediately before every send.
    const result = await delivery(q, job, currentTime(), env);
    if (!result.message) {
      if (await finish(q, job, currentTime(), "skipped", result.code))
        counts.skipped++;
      continue;
    }
    try {
      await send(result.message, env);
    } catch (error) {
      const code = notificationMailFailure(error);
      const terminal = code === "smtp_permanent" || job.attempts >= 8;
      if (
        await finish(
          q,
          job,
          currentTime(),
          terminal ? "failed" : "pending",
          job.attempts >= 8 ? "attempts_exhausted" : code,
        )
      )
        counts[terminal ? "failed" : "retry"]++;
      continue;
    }
    // DB failure after SMTP acceptance keeps the lease for recovery; it must
    // not be classified as an SMTP failure. Recovery can resend (at least once).
    if (await finish(q, job, currentTime(), "sent", null)) counts.sent++;
  }
  return counts;
}
export async function notificationEmailStatus(q: Queryable) {
  const { rows } = await q.query<{
    status: string;
    count: number;
    oldest_seconds: number | null;
  }>(
    `SELECT status,count(*)::int count,extract(epoch FROM now()-min(created_at))::int oldest_seconds FROM notification_email_outbox GROUP BY status ORDER BY status`,
  );
  return rows;
}
