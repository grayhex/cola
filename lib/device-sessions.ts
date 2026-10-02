import { randomBytes, randomUUID } from "node:crypto";
import type { Queryable } from "./db.ts";
import { digest } from "./password.ts";

// Device sessions for native clients (#303, ADR in #156). A device is one more
// kind of row in `sessions`: a pair of opaque tokens, a short-lived access token
// and a one-time refresh token that is rotated on every use. Everything that
// ends a browser session (sign out everywhere, a new password, blocking,
// deleting the account) ends a device session through the same rows.

export const ACCESS_PREFIX = "cola_at_";
export const REFRESH_PREFIX = "cola_rt_";
// 32 random bytes in base64url after the prefix.
const body = "[A-Za-z0-9_-]{43}";
export const accessTokenPattern = new RegExp(`^${ACCESS_PREFIX}${body}$`);
export const refreshTokenPattern = new RegExp(`^${REFRESH_PREFIX}${body}$`);

/** A replay of the previous refresh token this soon is a lost response. */
export const REFRESH_GRACE_SECONDS = 30;

export interface DeviceSessionConfig {
  accessMinutes: number;
  idleDays: number;
  absoluteDays: number;
  limit: number;
}

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  return value !== undefined &&
    /^\d+$/.test(value) &&
    parsed >= min &&
    parsed <= max
    ? parsed
    : fallback;
}

/**
 * Lifetimes the owner accepted (ADR #156): access 15 minutes, refresh idle 60
 * days and absolute 180 days, up to 20 devices. A bad value falls back to the
 * default; the idle limit never exceeds the absolute one.
 */
export function deviceSessionConfig(env = process.env): DeviceSessionConfig {
  const idleDays = integer(env.DEVICE_REFRESH_IDLE_DAYS, 60, 1, 365);
  const absoluteDays = integer(env.DEVICE_REFRESH_ABSOLUTE_DAYS, 180, 1, 730);
  return {
    accessMinutes: integer(env.DEVICE_ACCESS_TOKEN_MINUTES, 15, 1, 24 * 60),
    idleDays: Math.min(idleDays, absoluteDays),
    absoluteDays,
    limit: 20,
  };
}

export interface DeviceInfo {
  name: string;
  platform: "ios" | "android" | "other";
  appVersion: string | null;
}

export interface TokenGrant {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  /** When the refresh token stops working if it is not used. */
  refreshTokenExpiresAt: Date;
}

const newToken = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");

/** The digest `sessions.token_hash` holds for an access token. */
export const accessHash = (token: string) => digest(token);

/**
 * Starts a device session and returns its first token pair. The user row is
 * locked, so two sign-ins of one person cannot both fit under the limit; the
 * least recently used devices beyond it are signed out.
 */
export async function createDeviceSession(
  q: Queryable,
  userId: string,
  device: DeviceInfo,
  userAgent: string,
  config: DeviceSessionConfig = deviceSessionConfig(),
): Promise<TokenGrant> {
  await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  await q.query(
    "DELETE FROM sessions WHERE user_id=$1 AND kind='device' AND expires_at<=now()",
    [userId],
  );
  // Keep the newest limit-1 so that the new one makes limit.
  await q.query(
    `DELETE FROM sessions WHERE id IN (
       SELECT id FROM sessions WHERE user_id=$1 AND kind='device'
       ORDER BY last_seen_at DESC, created_at DESC OFFSET $2)`,
    [userId, config.limit - 1],
  );
  const accessToken = newToken(ACCESS_PREFIX);
  const refreshToken = newToken(REFRESH_PREFIX);
  const { rows } = await q.query<{
    id: string;
    access_expires_at: Date;
    expires_at: Date;
  }>(
    `INSERT INTO sessions(token_hash,user_id,expires_at,user_agent,kind,device_name,platform,app_version,access_expires_at,refresh_hash,rotated_at,absolute_expires_at)
     VALUES($1,$2,least(now()+make_interval(days=>$3),now()+make_interval(days=>$4)),$5,'device',$6,$7,$8,now()+make_interval(mins=>$9),$10,now(),now()+make_interval(days=>$4))
     RETURNING id,access_expires_at,expires_at`,
    [
      accessHash(accessToken),
      userId,
      config.idleDays,
      config.absoluteDays,
      userAgent.slice(0, 300),
      device.name,
      device.platform,
      device.appVersion,
      config.accessMinutes,
      digest(refreshToken),
    ],
  );
  return {
    sessionId: rows[0].id,
    accessToken,
    accessTokenExpiresAt: rows[0].access_expires_at,
    refreshToken,
    refreshTokenExpiresAt: rows[0].expires_at,
  };
}

/** The session a refresh token belongs to, current or previous, without a lock. */
export async function sessionOfRefreshToken(q: Queryable, token: string) {
  if (!refreshTokenPattern.test(token)) return null;
  const hash = digest(token);
  return (
    (
      await q.query<{ id: string }>(
        "SELECT id FROM sessions WHERE kind='device' AND (refresh_hash=$1 OR previous_refresh_hash=$1)",
        [hash],
      )
    ).rows[0]?.id ?? null
  );
}

export type RefreshResult =
  | { ok: true; grant: TokenGrant; userId: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "reuse"; userId: string; sessionId: string };

interface RefreshRow {
  id: string;
  user_id: string;
  refresh_hash: string;
  access_used_at: Date | null;
  in_grace: boolean;
  expired: boolean;
  blocked: boolean;
}

/**
 * Exchanges a refresh token for a new pair (ADR D3, D4). One transaction, the
 * session row locked: two parallel refreshes with one token are decided one
 * after the other, never both as "current". The pair is replaced by UPDATE.
 *
 * - the current token: rotate, the old one becomes the previous;
 * - the previous token, within the grace period and before the new access
 *   token was ever used: the client lost the answer, so a newer pair replaces
 *   the unclaimed one;
 * - the previous token otherwise: theft or a broken client, the session ends.
 */
export async function refreshDeviceSession(
  transaction: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
  token: string,
  config: DeviceSessionConfig = deviceSessionConfig(),
): Promise<RefreshResult> {
  if (!refreshTokenPattern.test(token)) return { ok: false, reason: "invalid" };
  const hash = digest(token);
  return transaction<RefreshResult>(async (q) => {
    const row = (
      await q.query<RefreshRow>(
        `SELECT s.id,s.user_id,s.refresh_hash,s.access_used_at,
                coalesce(s.rotated_at>now()-make_interval(secs=>$2),false) AS in_grace,
                (s.expires_at<=now() OR s.absolute_expires_at<=now()) AS expired,
                u.blocked
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.kind='device' AND (s.refresh_hash=$1 OR s.previous_refresh_hash=$1)
         FOR UPDATE OF s`,
        [hash, REFRESH_GRACE_SECONDS],
      )
    ).rows[0];
    if (!row) return { ok: false, reason: "invalid" };
    if (row.expired) {
      await q.query("DELETE FROM sessions WHERE id=$1", [row.id]);
      return { ok: false, reason: "invalid" };
    }
    // A blocked account is refused everywhere; its rows stay for the admin.
    if (row.blocked) return { ok: false, reason: "invalid" };
    const current = row.refresh_hash === hash;
    const tolerated = !current && row.in_grace && row.access_used_at === null;
    if (!current && !tolerated) {
      await q.query("DELETE FROM sessions WHERE id=$1", [row.id]);
      await q.query(
        `INSERT INTO notifications(id,recipient_id,actor_id,type,dedup_key)
         VALUES($1,$2,NULL,'session_reuse',$3) ON CONFLICT(recipient_id,dedup_key) DO NOTHING`,
        [randomUUID(), row.user_id, "session_reuse:" + row.id],
      );
      return {
        ok: false,
        reason: "reuse",
        userId: row.user_id,
        sessionId: row.id,
      };
    }
    const accessToken = newToken(ACCESS_PREFIX);
    const refreshToken = newToken(REFRESH_PREFIX);
    // A tolerated replay keeps the previous token and the rotation time, so the
    // grace period is measured from the original rotation and cannot be extended.
    const { rows } = await q.query<{
      access_expires_at: Date;
      expires_at: Date;
    }>(
      `UPDATE sessions SET token_hash=$2,
         access_expires_at=now()+make_interval(mins=>$3),
         refresh_hash=$4,
         previous_refresh_hash=CASE WHEN $6 THEN previous_refresh_hash ELSE $5 END,
         rotated_at=CASE WHEN $6 THEN rotated_at ELSE now() END,
         access_used_at=NULL,last_seen_at=now(),
         expires_at=least(now()+make_interval(days=>$7),absolute_expires_at)
       WHERE id=$1 RETURNING access_expires_at,expires_at`,
      [
        row.id,
        accessHash(accessToken),
        config.accessMinutes,
        digest(refreshToken),
        row.refresh_hash,
        tolerated,
        config.idleDays,
      ],
    );
    return {
      ok: true,
      userId: row.user_id,
      grant: {
        sessionId: row.id,
        accessToken,
        accessTokenExpiresAt: rows[0].access_expires_at,
        refreshToken,
        refreshTokenExpiresAt: rows[0].expires_at,
      },
    };
  });
}

/**
 * Why a Bearer token found no viewer: an access token that only ran out of time
 * (the client refreshes) or one that is unknown, revoked or of a blocked
 * account (the client signs in again).
 */
export async function bearerFailure(q: Queryable, hash: string) {
  const row = (
    await q.query<{ expired: boolean }>(
      `SELECT s.access_expires_at<=now() AS expired FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.kind='device' AND s.expires_at>now()
         AND s.absolute_expires_at>now() AND NOT u.blocked`,
      [hash],
    )
  ).rows[0];
  return row?.expired ? ("token_expired" as const) : ("invalid_token" as const);
}

/** Ends the session an access token belongs to; true when there was one. */
export async function endDeviceSession(q: Queryable, hash: string) {
  const { rowCount } = await q.query(
    "DELETE FROM sessions WHERE token_hash=$1 AND kind='device'",
    [hash],
  );
  return (rowCount ?? 0) > 0;
}
