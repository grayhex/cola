import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Queryable } from "./db.ts";
import { pushConfig, type PushProvider } from "./push-config.ts";

// The registry of the phones a person may be pushed to (#342). A registration
// belongs to one device session of the app, so it ends with the session: a
// logout, a revoke, a block, a password reset and the deletion of the account
// delete the session and the row with it (ON DELETE CASCADE). A short access
// token running out is not the end of a session, and does not touch it.
//
// The address the provider gave the app is a secret: it is sealed with the key of
// the server (AES-256-GCM, bound to the session it belongs to), shown to no one,
// and opened only by the sender. What may be said about a registration is its
// provider, project and generation.

/** How many phones a person can have registered at once. */
export const pushDevicesPerUser = 10;

export interface PushRegistration {
  /** Made by the app once per install: a reinstall is told from a rotation. */
  installationId: string;
  provider: PushProvider;
  projectId: string;
  token: string;
  /**
   * The generation the app believes it holds. A request that carries an older
   * one is a late callback and does not bring the past back.
   */
  expectedGeneration?: number | null;
}

export interface PushDevice {
  provider: PushProvider;
  projectId: string;
  /** The binding of this install to this account; a message names the one it was made for. */
  generation: number;
  registeredAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export type PushRegistryProblem =
  "unavailable" | "project" | "limit" | "stale" | "session";
export class PushRegistryError extends Error {
  declare problem: PushRegistryProblem;
  constructor(problem: PushRegistryProblem, message: string) {
    super(message);
    this.name = "PushRegistryError";
    this.problem = problem;
  }
}

export const pushTokenHash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const aad = (sessionId: string) => Buffer.from("push-token:" + sessionId);
const VERSION = "v1";

export function sealPushToken(
  token: string,
  sessionId: string,
  key: Buffer,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(sessionId));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(":");
}

/** The address, or null when it cannot be opened (another key, another session, damage). */
export function openPushToken(
  sealed: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !body) return null;
  const { key, previousKey } = pushConfig(env);
  for (const candidate of [key, previousKey]) {
    if (!candidate) continue;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        candidate,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAAD(aad(sessionId));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Not this key: try the previous one.
    }
  }
  return null;
}

interface DeviceRow {
  session_id: string;
  user_id: string;
  installation_id: string;
  provider: PushProvider;
  project_id: string;
  token_hash: string;
  generation: number;
  registered_at: Date;
  updated_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}
const view = (row: DeviceRow): PushDevice => ({
  provider: row.provider,
  projectId: row.project_id,
  generation: row.generation,
  registeredAt: row.registered_at,
  updatedAt: row.updated_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * What was made for a device that cannot be sent to any more. A message that has
 * left cannot be taken back; one that has not is dropped here, so a person who
 * turns push off and on again does not get the old ones.
 */
export async function skipPushDeliveries(
  q: Queryable,
  where: { deviceSessionId?: string; userId?: string; types?: string[] },
  code: "rebound" | "revoked" | "preferences",
  now = new Date(),
) {
  const { rowCount } = await q.query(
    `UPDATE push_deliveries d SET status='skipped',error_code=$4,finished_at=$5,lease_token=NULL,lease_until=NULL
     WHERE d.status IN ('pending','sending')
       AND ($1::uuid IS NULL OR d.device_session_id=$1)
       AND ($2::uuid IS NULL OR d.recipient_id=$2)
       AND ($3::text[] IS NULL OR d.notification_id IN (SELECT id FROM notifications WHERE type=ANY($3)))`,
    [
      where.deviceSessionId ?? null,
      where.userId ?? null,
      where.types ?? null,
      code,
      now,
    ],
  );
  return rowCount ?? 0;
}

/**
 * Registers (or renews) the push address of the device session. Idempotent: the
 * same address from the same install is the same generation. A new address, a
 * new project or a new install, or a registration made again after it was
 * revoked, is the next generation. The caller runs it in a transaction.
 */
export async function registerPushDevice(
  q: Queryable,
  input: PushRegistration & { userId: string; sessionId: string },
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<PushDevice> {
  const config = pushConfig(env);
  if (!config.registry || !config.key)
    throw new PushRegistryError("unavailable", "Push пока не подключён.");
  if (!config.projects.includes(input.projectId))
    throw new PushRegistryError("project", "Этот проект push не подключён.");
  // One registration of a person at a time: the quota below cannot be raced.
  await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.userId]);
  const session = await q.query(
    "SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND kind='device' AND expires_at>$3",
    [input.sessionId, input.userId, now],
  );
  if (!session.rowCount)
    throw new PushRegistryError("session", "Нужна сессия приложения.");
  const existing = (
    await q.query<DeviceRow>(
      "SELECT * FROM push_devices WHERE session_id=$1 FOR UPDATE",
      [input.sessionId],
    )
  ).rows[0];
  if (
    existing &&
    input.expectedGeneration != null &&
    input.expectedGeneration !== existing.generation
  )
    throw new PushRegistryError(
      "stale",
      "Привязка телефона изменилась: прочитайте её заново.",
    );
  const hash = pushTokenHash(input.token);
  // The address goes to whoever holds it now. Its previous holder (a phone
  // that signed in as someone else, a reinstall) is revoked and gets nothing.
  const holders = await q.query<{ session_id: string }>(
    `UPDATE push_devices SET revoked_at=$4,revoke_reason='replaced',updated_at=$4
     WHERE provider=$1 AND token_hash=$2 AND revoked_at IS NULL AND session_id<>$3 RETURNING session_id`,
    [input.provider, hash, input.sessionId, now],
  );
  for (const holder of holders.rows)
    await skipPushDeliveries(
      q,
      { deviceSessionId: holder.session_id },
      "revoked",
      now,
    );
  const live = (
    await q.query<{ count: number }>(
      "SELECT count(*)::int count FROM push_devices WHERE user_id=$1 AND revoked_at IS NULL AND session_id<>$2",
      [input.userId, input.sessionId],
    )
  ).rows[0].count;
  if (live >= pushDevicesPerUser)
    throw new PushRegistryError(
      "limit",
      "Слишком много телефонов с push: отключите ненужные.",
    );
  const sealed = sealPushToken(input.token, input.sessionId, config.key);
  if (!existing) {
    const created = await q.query<DeviceRow>(
      `INSERT INTO push_devices(session_id,user_id,installation_id,provider,project_id,token_ciphertext,token_hash,registered_at,updated_at,last_seen_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8) RETURNING *`,
      [
        input.sessionId,
        input.userId,
        input.installationId,
        input.provider,
        input.projectId,
        sealed,
        hash,
        now,
      ],
    );
    return view(created.rows[0]);
  }
  const same =
    existing.revoked_at === null &&
    existing.installation_id === input.installationId &&
    existing.provider === input.provider &&
    existing.project_id === input.projectId &&
    existing.token_hash === hash;
  if (same) {
    const touched = await q.query<DeviceRow>(
      "UPDATE push_devices SET last_seen_at=$2 WHERE session_id=$1 RETURNING *",
      [input.sessionId, now],
    );
    return view(touched.rows[0]);
  }
  await skipPushDeliveries(
    q,
    { deviceSessionId: input.sessionId },
    "rebound",
    now,
  );
  const rebound = await q.query<DeviceRow>(
    `UPDATE push_devices SET installation_id=$2,provider=$3,project_id=$4,token_ciphertext=$5,token_hash=$6,
       generation=generation+1,registered_at=$7,updated_at=$7,last_seen_at=$7,revoked_at=NULL,revoke_reason=NULL
     WHERE session_id=$1 RETURNING *`,
    [
      input.sessionId,
      input.installationId,
      input.provider,
      input.projectId,
      sealed,
      hash,
      now,
    ],
  );
  return view(rebound.rows[0]);
}

/** The live registration of a device session, or null. */
export async function pushDeviceOf(q: Queryable, sessionId: string) {
  const row = (
    await q.query<DeviceRow>(
      "SELECT * FROM push_devices WHERE session_id=$1 AND revoked_at IS NULL",
      [sessionId],
    )
  ).rows[0];
  return row ? view(row) : null;
}

/** Ends the registration of a device session (the person's choice, or the provider's word). */
export async function revokePushDevice(
  q: Queryable,
  sessionId: string,
  reason: "user" | "invalid_token",
  now = new Date(),
) {
  const { rowCount } = await q.query(
    "UPDATE push_devices SET revoked_at=$2,revoke_reason=$3,updated_at=$2 WHERE session_id=$1 AND revoked_at IS NULL",
    [sessionId, now, reason],
  );
  await skipPushDeliveries(q, { deviceSessionId: sessionId }, "revoked", now);
  return (rowCount ?? 0) > 0;
}
