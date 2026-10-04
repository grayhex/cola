import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.ts";
import {
  notificationCategories,
  notificationCategoryOf,
  notificationPushDiscoveryTypes,
  notificationPushTtlSql,
  notificationPushTypes,
  type NotificationCategoryKey,
} from "./notification-catalog.ts";
import { externalNoticeCheck } from "./notification-external.ts";
import { notificationLimits } from "./notification-fanout.ts";
import { pushConfig } from "./push-config.ts";
import { openPushToken, revokePushDevice } from "./push-devices.ts";
import {
  buildChatPushEnvelope,
  buildPushEnvelope,
  pushSubjectIsPublic,
} from "./push-message.ts";
import {
  streamChatPushAccess,
  type ChatPushAccess,
  type ChatPushVerdict,
} from "./chat-push-access.ts";
import { pruneChatWebhooks } from "./chat-push.ts";
import { deliveryPolicy, externalVerdict } from "./notification-policy.ts";
import type { PushEnvelope } from "./notification-envelope.ts";
import {
  pushTransport,
  type PushMessage,
  type PushOutcome,
  type PushTransport,
} from "./push-transport.ts";

// The queue of what is pushed to phones (#342), next to the e-mail outbox and
// built like it: one row for an event and a device, leased with SKIP LOCKED,
// retried with backoff until a deadline, and checked again immediately before
// every attempt. A message is *derived* from the durable event, so no event is
// lost between "made" and "queued": the worker looks at what exists, not at what
// someone remembered to announce. Delivery is at-least-once; "the provider took
// it" is not "the phone received it", nor "it was shown", nor "it was read".

/** How many attempts a message gets before it is given up. */
export const pushAttempts = 6;
const LEASE_SECONDS = 120;
const AUTH_PAUSE_SECONDS = 15 * 60;
const PROVIDER_TTL_MAX_SECONDS = 28 * 24 * 3600;
/** Events older than this are not looked at: nothing is worth sending after days. */
const LOOKBACK_DAYS = 3;

export interface PushJob {
  id: string;
  /** The event of the bell this is for, or null for a message of a conversation. */
  notification_id: string | null;
  chat_message_id: string | null;
  chat_cid: string | null;
  recipient_id: string;
  device_session_id: string;
  generation: number;
  lease_token: string;
  attempts: number;
}

/**
 * Makes the messages for events that exist and have none yet: for each live
 * device whose person has push on, for each unread event of a kind push carries,
 * made after the device was bound and after the person said yes to push. What
 * was made before is never caught up (a "no" and a new "yes" start from now).
 */
export async function materializePushDeliveries(
  q: Queryable,
  now = new Date(),
  limit = 200,
) {
  const { rowCount } = await q.query(
    `INSERT INTO push_deliveries(notification_id,recipient_id,device_session_id,generation,available_at,expires_at)
     SELECT c.id,c.recipient_id,c.session_id,c.generation,$1::timestamptz,c.expires_at FROM (
       SELECT n.id,n.recipient_id,n.created_at,d.session_id,d.generation,
         LEAST(n.created_at+make_interval(hours=>${notificationPushTtlSql("n.type")}),COALESCE(n.event_occurs_at-interval '5 minutes','infinity'::timestamptz)) expires_at
       FROM notifications n
       JOIN push_devices d ON d.user_id=n.recipient_id AND d.revoked_at IS NULL AND n.created_at>=d.registered_at
       JOIN sessions s ON s.id=d.session_id AND s.kind='device' AND s.expires_at>$1::timestamptz AND s.absolute_expires_at>$1::timestamptz
       JOIN users u ON u.id=n.recipient_id AND NOT u.blocked
       JOIN notification_settings ns ON ns.user_id=n.recipient_id AND ns.push_enabled AND ns.push_enabled_at<=n.created_at
       WHERE n.type=ANY($2::text[]) AND n.read_at IS NULL AND n.external AND n.created_at>$1::timestamptz-make_interval(days=>${LOOKBACK_DAYS})
         AND NOT EXISTS(SELECT 1 FROM push_deliveries p WHERE p.notification_id=n.id AND p.device_session_id=d.session_id)
     ) c WHERE c.expires_at>$1::timestamptz ORDER BY c.created_at,c.id,c.session_id LIMIT $3
     ON CONFLICT(notification_id,device_session_id) DO NOTHING`,
    [now, notificationPushTypes, Math.max(1, Math.min(1000, limit))],
  );
  return rowCount ?? 0;
}

export async function claimPushDeliveries(
  q: Queryable,
  now = new Date(),
  limit = 1,
) {
  const token = randomUUID();
  const { rows } = await q.query<PushJob>(
    `WITH candidates AS (
       SELECT d.id FROM push_deliveries d LEFT JOIN notifications n ON n.id=d.notification_id
       WHERE d.expires_at>$1::timestamptz AND d.available_at<=$1::timestamptz AND d.attempts<8
         AND (d.status='pending' OR (d.status='sending' AND d.lease_until<=$1::timestamptz))
       ORDER BY coalesce(n.type=ANY($4::text[]),false),d.created_at,d.id LIMIT $2 FOR UPDATE OF d SKIP LOCKED
     ) UPDATE push_deliveries d SET status='sending',attempts=d.attempts+1,lease_token=$3,lease_until=$1::timestamptz+make_interval(secs=>${LEASE_SECONDS})
     FROM candidates c WHERE d.id=c.id
     RETURNING d.id,d.notification_id,d.recipient_id,d.device_session_id,d.generation,d.lease_token,d.attempts,d.chat_message_id,d.chat_cid`,
    [
      now,
      Math.max(1, Math.min(100, limit)),
      token,
      notificationPushDiscoveryTypes,
    ],
  );
  return rows;
}

type SkipCode =
  | "gone"
  | "read"
  | "not_member"
  | "superseded"
  | "expired"
  | "unavailable"
  | "preferences"
  | "muted"
  | "paused"
  | "quiet"
  | "disabled"
  | "rebound"
  | "revoked";
type FailCode =
  | "invalid_token"
  | "rejected"
  | "provider_temporary"
  | "provider_auth"
  | "attempts_exhausted";

async function finish(
  q: Queryable,
  job: PushJob,
  now: Date,
  status: "sent" | "failed" | "skipped",
  code: SkipCode | FailCode | null,
) {
  const result = await q.query(
    `UPDATE push_deliveries SET status=$3,error_code=$4,finished_at=$5,lease_token=NULL,lease_until=NULL
     WHERE id=$1 AND lease_token=$2 AND status='sending'`,
    [job.id, job.lease_token, status, code, now],
  );
  return !!result.rowCount;
}

/**
 * Puts the message back to be tried later. `used` is whether the attempt
 * counts: waiting for the end of quiet hours, or for the operator to mend the
 * key, is not an attempt.
 */
async function retry(
  q: Queryable,
  job: PushJob,
  at: Date,
  code: FailCode | null,
  used: boolean,
) {
  const result = await q.query(
    `UPDATE push_deliveries SET status='pending',attempts=CASE WHEN $4 THEN attempts ELSE greatest(attempts-1,0) END,
       available_at=$3,error_code=$5,lease_token=NULL,lease_until=NULL
     WHERE id=$1 AND lease_token=$2 AND status='sending'`,
    [job.id, job.lease_token, at, used, code],
  );
  return !!result.rowCount;
}

export async function prunePushDeliveries(q: Queryable, now = new Date()) {
  await q.query(
    `WITH old AS (SELECT id FROM push_deliveries WHERE status IN ('pending','sending') AND (expires_at<=$1::timestamptz OR attempts>=8) AND (status='pending' OR lease_until<=$1::timestamptz) ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED)
     UPDATE push_deliveries d SET status=CASE WHEN d.attempts>=8 THEN 'failed' ELSE 'skipped' END,error_code=CASE WHEN d.attempts>=8 THEN 'attempts_exhausted' ELSE 'expired' END,
       finished_at=$1::timestamptz,lease_token=NULL,lease_until=NULL FROM old WHERE d.id=old.id`,
    [now],
  );
  await q.query(
    `DELETE FROM push_deliveries WHERE id IN (SELECT id FROM push_deliveries WHERE status IN ('sent','failed','skipped') AND finished_at<$1::timestamptz-interval '30 days' ORDER BY id LIMIT 1000)`,
    [now],
  );
}

type Delivery =
  | { code: SkipCode }
  | { defer: Date }
  /** Stream could not say whether the message may still be pushed. */
  | { outage: true }
  | { message: PushMessage; expiresAt: Date };

/** Everything the send depends on, read now. */
async function delivery(
  q: Queryable,
  job: PushJob,
  now: Date,
  env: NodeJS.ProcessEnv,
  chat: ChatPushAccess,
): Promise<Delivery> {
  const row = (
    await q.query<{
      type: string | null;
      ride_id: string | null;
      event_occurs_at: Date | null;
      created_at: Date;
      expires_at: Date;
      provider: "rustore";
      project_id: string;
      token_ciphertext: string;
      device_generation: number;
      revoked_at: Date | null;
      push_enabled: boolean;
      push_enabled_at: Date | null;
      push_categories: unknown;
      author_name: string | null;
    }>(
      `SELECT n.type,n.ride_id,n.event_occurs_at,coalesce(n.created_at,d.created_at) created_at,d.expires_at,dev.provider,dev.project_id,dev.token_ciphertext,
         dev.generation device_generation,dev.revoked_at,ns.push_enabled,ns.push_enabled_at,ns.push_categories,au.name author_name
       FROM push_deliveries d
       LEFT JOIN notifications n ON n.id=d.notification_id AND n.recipient_id=d.recipient_id
       LEFT JOIN users au ON au.id=d.chat_author_id AND NOT au.blocked
       JOIN push_devices dev ON dev.session_id=d.device_session_id
       JOIN sessions s ON s.id=dev.session_id AND s.kind='device' AND s.expires_at>$3::timestamptz AND s.absolute_expires_at>$3::timestamptz
       JOIN users u ON u.id=d.recipient_id AND NOT u.blocked
       LEFT JOIN notification_settings ns ON ns.user_id=d.recipient_id
       WHERE d.id=$1 AND d.lease_token=$2 AND d.status='sending' AND d.lease_until>$3::timestamptz AND d.expires_at>$3::timestamptz
         AND (d.notification_id IS NULL OR n.id IS NOT NULL) AND (d.chat_author_id IS NULL OR au.id IS NOT NULL)`,
      [job.id, job.lease_token, now],
    )
  ).rows[0];
  if (!row) return { code: "unavailable" };
  // The binding: a message is for one generation of one live registration.
  if (row.revoked_at) return { code: "revoked" };
  if (row.device_generation !== job.generation) return { code: "rebound" };
  const category: NotificationCategoryKey = job.chat_message_id
    ? "chat"
    : notificationCategoryOf(row.type ?? "");
  const chosen =
    row.push_categories && typeof row.push_categories === "object"
      ? (row.push_categories as Record<string, unknown>)[category]
      : undefined;
  if (
    !row.push_enabled ||
    !row.push_enabled_at ||
    new Date(row.push_enabled_at) > new Date(row.created_at) ||
    !(typeof chosen === "boolean"
      ? chosen
      : notificationCategories[category].pushDefault)
  )
    return { code: "preferences" };
  const expiresAt = new Date(row.expires_at);
  let envelope: PushEnvelope | null;
  if (job.chat_message_id && job.chat_cid) {
    // The admin's switches, then the person's pause and quiet hours.
    const limits = await notificationLimits(q);
    if (
      !limits.externalEnabled ||
      !limits.pushEnabled ||
      limits.disabledCategories.includes("chat")
    )
      return { code: "disabled" };
    const verdict = externalVerdict(await deliveryPolicy(q, job.recipient_id), {
      type: "chat_message",
      now,
      expiresAt,
      occursAt: null,
      confirmed: false,
    });
    if (verdict.action === "defer") return { defer: verdict.until };
    if (verdict.action === "drop")
      return {
        code:
          verdict.reason === "paused"
            ? "paused"
            : verdict.reason === "quiet"
              ? "quiet"
              : "expired",
      };
    // Stream knows whether the message is still there, whether the person is
    // still in the conversation, has muted it or has read it elsewhere. When
    // Stream cannot say, nothing is sent: the queue asks again.
    let access: ChatPushVerdict;
    try {
      access = await chat.check({
        cid: job.chat_cid,
        messageId: job.chat_message_id,
        recipientId: job.recipient_id,
      });
    } catch {
      return { outage: true };
    }
    if (access !== "ok") return { code: access };
    envelope = buildChatPushEnvelope({
      deliveryId: job.id,
      generation: job.generation,
      messageId: job.chat_message_id,
      cid: job.chat_cid,
      authorName: row.author_name ?? "",
      createdAt: new Date(row.created_at),
      expiresAt,
    });
  } else {
    const checked = await externalNoticeCheck(
      q,
      {
        notificationId: job.notification_id!,
        recipientId: job.recipient_id,
        type: row.type ?? "",
        category,
        rideId: row.ride_id,
        eventOccursAt: row.event_occurs_at && new Date(row.event_occurs_at),
        expiresAt,
      },
      "push",
      now,
    );
    if ("code" in checked || "defer" in checked) return checked;
    envelope = buildPushEnvelope({
      deliveryId: job.id,
      generation: job.generation,
      notice: checked.notice,
      expiresAt,
      neutral: !(await pushSubjectIsPublic(q, checked.notice.target)),
    });
  }
  const token = openPushToken(row.token_ciphertext, job.device_session_id, env);
  if (!envelope || !token) return { code: "unavailable" };
  return {
    expiresAt,
    message: {
      provider: row.provider,
      projectId: row.project_id,
      token,
      data: JSON.stringify(envelope),
      ttlSeconds: Math.max(
        1,
        Math.min(
          PROVIDER_TTL_MAX_SECONDS,
          Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
        ),
      ),
    },
  };
}

export interface PushBatchCounts {
  materialized: number;
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  skipped: number;
  deferred: number;
  revoked: number;
  /** The provider refused the server's own key: the operator's to mend, the batch stopped. */
  authFailures: number;
  /** Nothing is sent: push is not configured, or there is no transport yet. */
  disabled: boolean;
}

export async function runPushBatch(
  q: Queryable,
  {
    env = process.env,
    now,
    transport = pushTransport(env),
    limit = 20,
    chat = streamChatPushAccess(),
  }: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    transport?: PushTransport | null;
    limit?: number;
    chat?: ChatPushAccess;
  } = {},
): Promise<PushBatchCounts> {
  const currentTime = () => now || new Date();
  await prunePushDeliveries(q, currentTime());
  await pruneChatWebhooks(q, currentTime());
  const counts: PushBatchCounts = {
    materialized: 0,
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    revoked: 0,
    authFailures: 0,
    disabled: false,
  };
  // Without a configuration or a transport nothing is made either, so nothing
  // piles up behind a channel that cannot send (what waits expires above).
  if (!transport || !pushConfig(env).sender) {
    counts.disabled = true;
    return counts;
  }
  const limits = await notificationLimits(q);
  if (limits.externalEnabled && limits.pushEnabled)
    counts.materialized = await materializePushDeliveries(q, currentTime());
  for (let index = 0; index < Math.max(1, Math.min(100, limit)); index++) {
    // Claim just before sending, so a slow provider cannot age later leases.
    const job = (await claimPushDeliveries(q, currentTime(), 1))[0];
    if (!job) break;
    counts.claimed++;
    const result = await delivery(q, job, currentTime(), env, chat);
    if ("outage" in result) {
      // Stream is not answering: the same as a provider that is not, within the
      // deadline of the message.
      const at = currentTime();
      if (job.attempts >= pushAttempts) {
        if (await finish(q, job, at, "failed", "attempts_exhausted"))
          counts.failed++;
      } else {
        const wait = Math.min(3600, 60 * 2 ** Math.min(job.attempts - 1, 9));
        if (
          await retry(
            q,
            job,
            new Date(at.getTime() + wait * 1000),
            "provider_temporary",
            true,
          )
        )
          counts.retry++;
      }
      continue;
    }
    if ("defer" in result) {
      if (await retry(q, job, result.defer, null, false)) counts.deferred++;
      continue;
    }
    if ("code" in result) {
      if (await finish(q, job, currentTime(), "skipped", result.code))
        counts.skipped++;
      continue;
    }
    let outcome: PushOutcome;
    try {
      outcome = await transport.send(result.message);
    } catch {
      // An adapter that throws did not get an answer: the same as a timeout.
      outcome = { kind: "temporary" };
    }
    const at = currentTime();
    if (outcome.kind === "accepted") {
      if (await finish(q, job, at, "sent", null)) counts.sent++;
    } else if (outcome.kind === "invalid_token") {
      // The provider says the address is gone: the device stops, not the person.
      await revokePushDevice(q, job.device_session_id, "invalid_token", at);
      await finish(q, job, at, "skipped", "revoked");
      counts.revoked++;
    } else if (outcome.kind === "rejected") {
      if (await finish(q, job, at, "failed", "rejected")) counts.failed++;
    } else if (outcome.kind === "auth") {
      // Never a reason to forget a device. Wait, without using an attempt, and
      // stop: the next messages would meet the same answer.
      await retry(
        q,
        job,
        new Date(at.getTime() + AUTH_PAUSE_SECONDS * 1000),
        "provider_auth",
        false,
      );
      counts.authFailures++;
      break;
    } else if (job.attempts >= pushAttempts) {
      if (await finish(q, job, at, "failed", "attempts_exhausted"))
        counts.failed++;
    } else {
      const backoff = Math.min(3600, 60 * 2 ** Math.min(job.attempts - 1, 9));
      const wait = Math.max(backoff, outcome.retryAfterSeconds ?? 0);
      if (
        await retry(
          q,
          job,
          new Date(at.getTime() + Math.min(wait, 3600) * 1000),
          "provider_temporary",
          true,
        )
      )
        counts.retry++;
    }
  }
  return counts;
}

/** Counts and ages only: no address, no person, no text. */
export async function pushStatus(q: Queryable) {
  const deliveries = (
    await q.query<{
      status: string;
      count: number;
      oldest_seconds: number | null;
    }>(
      `SELECT status,count(*)::int count,extract(epoch FROM now()-min(created_at))::int oldest_seconds
       FROM push_deliveries GROUP BY status ORDER BY status`,
    )
  ).rows;
  const devices = (
    await q.query<{ provider: string; count: number }>(
      `SELECT provider,count(*)::int count FROM push_devices WHERE revoked_at IS NULL GROUP BY provider ORDER BY provider`,
    )
  ).rows;
  return { deliveries, devices };
}
