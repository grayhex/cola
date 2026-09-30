import type * as ActivityContractsTypes from "./activity-contracts.ts";
import type { Queryable } from "./db.ts";
import type {
  ActivityNotification,
  ActivityBike,
} from "./activity-contracts.ts";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  sealActivityToken,
  openActivityToken,
} from "./activity-credentials.ts";
import { ActivityError, exchangeRwgpsCode, rwgpsConfig } from "./rwgps.ts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function lockActivityOwner(q: Queryable, owner: string) {
  const user = (
    await q.query<{ id: string }>(
      "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [owner],
    )
  ).rows[0];
  if (!user) throw new ActivityError("Пользователь недоступен", 403);
}
export async function checkActivityBike(
  q: Queryable,
  owner: string,
  bike: string | null | undefined,
) {
  if (!bike) return null;
  const row = (
    await q.query<{ id: string }>(
      "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 AND NOT is_former FOR UPDATE",
      [bike, owner],
    )
  ).rows[0];
  if (!row) throw new ActivityError("Выберите свой текущий велосипед", 400);
  return row.id;
}
export function twelveMonthsAgo(now = new Date()) {
  const result = new Date(now),
    day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() - 1);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result.toISOString();
}
export async function queueActivitySync(q: Queryable, connectionId: string) {
  await q.query(
    `INSERT INTO activity_jobs(id,connection_id,action) VALUES($1,$2,'sync')
    ON CONFLICT(connection_id,external_id) DO UPDATE SET revision=activity_jobs.revision+1,next_attempt_at=now(),attempts=0`,
    [randomUUID(), connectionId],
  );
}
export async function beginActivityOAuth(
  q: Queryable,
  owner: string,
  session: string | null,
  bikeId: string | null | undefined,
) {
  const config = rwgpsConfig();
  if (!config) throw new ActivityError("Ride with GPS пока недоступен", 503);
  await lockActivityOwner(q, owner);
  if (
    (
      await q.query(
        "SELECT 1 FROM activity_revocations WHERE owner_id=$1 AND provider='rwgps' LIMIT 1",
        [owner],
      )
    ).rows.length
  )
    throw new ActivityError(
      "Отзыв предыдущего подключения ещё выполняется. Попробуйте позже.",
      409,
    );
  if (
    (
      await q.query(
        "SELECT 1 FROM activity_connections WHERE owner_id=$1 AND provider='rwgps'",
        [owner],
      )
    ).rows.length
  )
    throw new ActivityError("Сначала отключите текущее подключение", 409);
  const bike = await checkActivityBike(q, owner, bikeId),
    state = randomBytes(32).toString("base64url");
  await q.query(
    "DELETE FROM activity_oauth_states WHERE expires_at<now() OR (owner_id=$1 AND provider='rwgps')",
    [owner],
  );
  await q.query(
    "INSERT INTO activity_oauth_states(state_hash,owner_id,session_hash,provider,bike_id) VALUES($1,$2,$3,'rwgps',$4)",
    [hash(state), owner, session, bike],
  );
  const url = new URL("https://ridewithgps.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
  }).toString();
  return { url: url.toString() };
}
// Caller holds a transaction. The owner lock fences concurrent disconnect and
// account deletion during the bounded code exchange. State belongs to a session.
export async function finishActivityOAuth(
  q: Queryable,
  owner: string,
  session: string | null,
  state: string,
  code: string,
) {
  const config = rwgpsConfig();
  if (!config) throw new ActivityError("Ride with GPS выключен", 503);
  await lockActivityOwner(q, owner);
  const pending = (
    await q.query<{ bike_id: string | null }>(
      "DELETE FROM activity_oauth_states WHERE state_hash=$1 AND owner_id=$2 AND session_hash=$3 AND expires_at>now() RETURNING bike_id",
      [hash(state), owner, session],
    )
  ).rows[0];
  if (!pending)
    throw new ActivityError("Подключение истекло. Начните заново.", 400);
  const existing = (
    await q.query(
      "SELECT 1 FROM activity_connections WHERE owner_id=$1 AND provider='rwgps'",
      [owner],
    )
  ).rows[0];
  if (existing) throw new ActivityError("Ride with GPS уже подключён", 409);
  const bike = await checkActivityBike(q, owner, pending.bike_id);
  const token = await exchangeRwgpsCode(code, config),
    id = randomUUID();
  const encrypted = sealActivityToken(token.access_token, "rwgps:" + id);
  // On a rejected connection retain a revocation job rather than lose a token.
  const revoking = (
    await q.query(
      "SELECT 1 FROM activity_revocations WHERE provider='rwgps' AND external_user_id=$1 LIMIT 1",
      [String(token.user_id)],
    )
  ).rows.length;
  const inserted = revoking
    ? { rows: [] }
    : await q.query<{ id: string }>(
        `INSERT INTO activity_connections(id,owner_id,provider,external_user_id,credentials,generation,bike_id,import_since)
    VALUES($1,$2,'rwgps',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
        [
          id,
          owner,
          String(token.user_id),
          encrypted,
          randomUUID(),
          bike,
          twelveMonthsAgo(),
        ],
      );
  if (!inserted.rows.length) {
    const linked = (
      await q.query<{ id: string; credentials: string }>(
        "SELECT id,credentials FROM activity_connections WHERE provider='rwgps' AND external_user_id=$1",
        [String(token.user_id)],
      )
    ).rows[0];
    // Some OAuth providers return an existing grant. Do not revoke another
    // ColaBike account's identical active token when refusing a duplicate link.
    if (
      !linked ||
      openActivityToken(linked.credentials, "rwgps:" + linked.id) !==
        token.access_token
    )
      await q.query(
        "INSERT INTO activity_revocations(id,provider,credentials,owner_id,external_user_id) VALUES($1,'rwgps',$2,$3,$4)",
        [id, encrypted, owner, String(token.user_id)],
      );
    return { connected: false };
  }
  await queueActivitySync(q, id);
  return { connected: true };
}
export async function activityStatus(q: Queryable, owner: string) {
  let enabled = false;
  try {
    enabled = !!rwgpsConfig();
  } catch {
    /* Unconfigured integration is presented as disabled. */
  }
  const c = (
    await q.query<
      Pick<
        ActivityContractsTypes.ActivityConnectionRow,
        "id" | "bike_id" | "last_sync_at" | "last_error"
      >
    >(
      "SELECT id,bike_id,last_sync_at,last_error FROM activity_connections WHERE owner_id=$1 AND provider='rwgps'",
      [owner],
    )
  ).rows[0];
  if (!c)
    return {
      enabled,
      connected: false,
      revoking: !!(
        await q.query(
          "SELECT 1 FROM activity_revocations WHERE owner_id=$1 AND provider='rwgps' LIMIT 1",
          [owner],
        )
      ).rows.length,
    };
  const counts = (
    await q.query<{ status: string; n: number }>(
      "SELECT status,count(*)::int n FROM external_activities WHERE owner_id=$1 AND provider='rwgps' GROUP BY status",
      [owner],
    )
  ).rows;
  const pending = (
    await q.query<{ n: number }>(
      "SELECT count(*)::int n FROM activity_jobs WHERE connection_id=$1",
      [c.id],
    )
  ).rows[0].n;
  const items = (
    await q.query<{
      id: string;
      status: string;
      name: string | null;
      last_error: string | null;
    }>(
      `SELECT a.id,a.status,a.metadata->>'name' AS name,a.last_error FROM external_activities a
    JOIN activity_connections c ON c.owner_id=a.owner_id AND c.provider=a.provider AND c.external_user_id=a.external_user_id
    WHERE a.owner_id=$1 AND a.status IN ('waiting_bike','error') ORDER BY a.updated_at DESC LIMIT 20`,
      [owner],
    )
  ).rows;
  return {
    enabled,
    connected: true,
    bikeId: c.bike_id,
    lastSyncAt: c.last_sync_at,
    error: c.last_error,
    pending,
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    items,
  };
}
export async function requestActivitySync(
  q: Queryable,
  owner: string,
  bikeId: string | null | undefined,
) {
  await lockActivityOwner(q, owner);
  const c = (
    await q.query<{ id: string; external_user_id: string }>(
      "SELECT id,external_user_id FROM activity_connections WHERE owner_id=$1 AND provider='rwgps' FOR UPDATE",
      [owner],
    )
  ).rows[0];
  if (!c) throw new ActivityError("Подключите Ride with GPS", 404);
  if (bikeId !== undefined)
    await q.query("UPDATE activity_connections SET bike_id=$2 WHERE id=$1", [
      c.id,
      await checkActivityBike(q, owner, bikeId),
    ]);
  // Retry individual failures too: the cursor can have advanced past their event.
  await q.query(
    `INSERT INTO activity_jobs(id,connection_id,external_id,action,event_at)
    SELECT a.id,$1,a.external_id,'upsert',a.event_at FROM external_activities a
    WHERE a.owner_id=$2 AND a.provider='rwgps' AND a.external_user_id=$3 AND a.status IN ('waiting_bike','error')
    ON CONFLICT(connection_id,external_id) DO UPDATE SET revision=activity_jobs.revision+1,attempts=0,next_attempt_at=now()`,
    [c.id, owner, c.external_user_id],
  );
  await q.query(
    "UPDATE activity_jobs SET attempts=0,next_attempt_at=now(),revision=revision+1 WHERE connection_id=$1",
    [c.id],
  );
  await queueActivitySync(q, c.id);
  return { ok: true };
}
export async function disconnectActivity(q: Queryable, owner: string) {
  await lockActivityOwner(q, owner);
  await q.query(
    "DELETE FROM activity_oauth_states WHERE owner_id=$1 AND provider='rwgps'",
    [owner],
  );
  await q.query(
    "DELETE FROM activity_connections WHERE owner_id=$1 AND provider='rwgps'",
    [owner],
  );
  return { ok: true };
}
export async function receiveActivityNotifications(
  q: Queryable,
  notifications: ActivityNotification[],
) {
  const owners = [
    ...new Set(
      notifications
        .filter(
          (n) =>
            n.item_type === "trip" &&
            n.user_id === n.item_user_id &&
            ["created", "updated", "deleted"].includes(n.action),
        )
        .map((n) => String(n.user_id)),
    ),
  ];
  if (!owners.length) return;
  // One SQL statement persists the notifications before acknowledging. No vendor
  // calls or user-row locks in the webhook's one-second response budget.
  await q.query(
    `INSERT INTO activity_jobs(id,connection_id,action)
    SELECT gen_random_uuid(),c.id,'sync' FROM activity_connections c JOIN users u ON u.id=c.owner_id
    WHERE c.provider='rwgps' AND c.external_user_id=ANY($1::text[]) AND NOT u.blocked
    ON CONFLICT(connection_id,external_id) DO UPDATE SET revision=activity_jobs.revision+1,next_attempt_at=now(),attempts=0`,
    [owners],
  );
}
export function chooseActivityBike(
  bikes: ActivityBike[],
  type: string | null,
  preferred: string | null = null,
) {
  const current = bikes.filter((b) => !b.is_former);
  if (preferred) return current.find((b) => b.id === preferred)?.id || null;
  if (current.length === 1) return current[0].id;
  const category = (
    {
      "cycling:mountain": "mtb",
      "cycling:road": "road",
      "cycling:gravel": "gravel",
      "cycling:commute": "urban_touring",
    } as Record<string, string>
  )[type ?? ""];
  const matches = category
    ? current.filter(
        (b) =>
          (b.classification?.subtype ||
            b.classification?.category ||
            b.category) === category,
      )
    : [];
  return matches.length === 1 ? matches[0].id : null;
}
