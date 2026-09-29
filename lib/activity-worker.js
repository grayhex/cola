import { randomUUID } from "node:crypto";
import { openActivityToken } from "./activity-credentials.js";
import {
  rwgpsConfig,
  rwgpsChanges,
  rwgpsTrip,
  rwgpsTrack,
  rwgpsMetrics,
  revokeRwgpsToken,
  ActivityError,
} from "./rwgps.js";
import { chooseActivityBike } from "./activity-sync.js";
import { rideSettings, importActivityRide, deleteRide } from "./rides.js";
import { drainRideFileGc } from "./ride-storage.js";

async function currentJob(q, job, c) {
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
        [c.owner_id],
      )
    ).rows.length
  )
    return null;
  const connection = (
    await q.query(
      "SELECT * FROM activity_connections WHERE id=$1 AND generation=$2 FOR UPDATE",
      [c.id, c.generation],
    )
  ).rows[0];
  if (!connection) return null;
  const current = (
    await q.query(
      "SELECT id FROM activity_jobs WHERE id=$1 AND revision=$2 FOR UPDATE",
      [job.id, job.revision],
    )
  ).rows[0];
  return current ? connection : null;
}
async function complete(q, job, c) {
  await q.query("DELETE FROM activity_jobs WHERE id=$1 AND revision=$2", [
    job.id,
    job.revision,
  ]);
  const remaining = (
    await q.query(
      "SELECT 1 FROM activity_jobs WHERE connection_id=$1 LIMIT 1",
      [c.id],
    )
  ).rows.length;
  if (!remaining)
    await q.query(
      "UPDATE activity_connections SET last_sync_at=now(),last_error=NULL WHERE id=$1",
      [c.id],
    );
}
async function activityRow(q, job, c) {
  return (
    await q.query(
      "SELECT * FROM external_activities WHERE owner_id=$1 AND provider=$2 AND external_user_id=$3 AND external_id=$4 FOR UPDATE",
      [c.owner_id, c.provider, c.external_user_id, job.external_id],
    )
  ).rows[0];
}
/** Perform vendor calls outside transactions; recheck the connection generation
 * and job revision inside the committing transaction after taking the owner lock. */
export async function processActivityJob(db, tx, job) {
  const c = (
    await db.query(
      "SELECT c.* FROM activity_connections c JOIN users u ON u.id=c.owner_id WHERE c.id=$1 AND NOT u.blocked",
      [job.connection_id],
    )
  ).rows[0];
  if (!c) return;
  const token = openActivityToken(c.credentials, c.provider + ":" + c.id);
  if (job.action === "sync") {
    const since = new Date(c.cursor_at || c.import_since).toISOString(),
      changes = await rwgpsChanges(token, since);
    if (
      Date.parse(changes.meta.rwgps_datetime) < Date.parse(since) ||
      Date.parse(changes.meta.rwgps_datetime) > Date.now() + 300000
    )
      throw new ActivityError("Некорректное время синхронизации Ride with GPS");
    await tx(async (q) => {
      if (!(await currentJob(q, job, c))) return;
      const latest = new Map();
      for (const item of changes.items) {
        if (
          item.item_type !== "trip" ||
          String(item.item_user_id) !== c.external_user_id ||
          !["created", "updated", "deleted"].includes(item.action)
        )
          continue;
        const old = latest.get(item.item_id);
        if (
          !old ||
          Date.parse(item.datetime) > Date.parse(old.datetime) ||
          (item.datetime === old.datetime && item.action === "deleted")
        )
          latest.set(item.item_id, item);
      }
      for (const item of latest.values()) {
        const external = String(item.item_id),
          action = item.action === "deleted" ? "deleted" : "upsert";
        await q.query(
          `INSERT INTO external_activities(id,owner_id,provider,external_user_id,external_id,event_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,provider,external_user_id,external_id)
          DO UPDATE SET event_at=greatest(external_activities.event_at,EXCLUDED.event_at)`,
          [
            randomUUID(),
            c.owner_id,
            c.provider,
            c.external_user_id,
            external,
            item.datetime,
          ],
        );
        await q.query(
          `INSERT INTO activity_jobs(id,connection_id,external_id,action,event_at) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(connection_id,external_id) DO UPDATE SET action=EXCLUDED.action,event_at=EXCLUDED.event_at,revision=activity_jobs.revision+1,attempts=0,next_attempt_at=now()
          WHERE EXCLUDED.event_at>=activity_jobs.event_at`,
          [randomUUID(), c.id, external, action, item.datetime],
        );
      }
      await q.query(
        "UPDATE activity_connections SET cursor_at=$2 WHERE id=$1",
        [c.id, changes.meta.rwgps_datetime],
      );
      await complete(q, job, c);
    });
    return;
  }
  if (job.action === "deleted") {
    await tx(async (q) => {
      if (!(await currentJob(q, job, c))) return;
      const a = await activityRow(q, job, c);
      if (a) {
        await q.query(
          "UPDATE external_activities SET status='deleted',metadata='{}',last_error=NULL,updated_at=now() WHERE id=$1",
          [a.id],
        );
        if (a.ride_id) await deleteRide(q, c.owner_id, a.ride_id);
      }
      await complete(q, job, c);
    });
    return;
  }
  const old = (
    await db.query(
      "SELECT status,ride_id FROM external_activities WHERE owner_id=$1 AND provider=$2 AND external_user_id=$3 AND external_id=$4",
      [c.owner_id, c.provider, c.external_user_id, job.external_id],
    )
  ).rows[0];
  if (["deleted", "local_deleted"].includes(old?.status)) {
    await tx(async (q) => {
      if (await currentJob(q, job, c)) await complete(q, job, c);
    });
    return;
  }
  const config = await rideSettings(db);
  if (!config.enabled)
    throw new ActivityError("Импорт покатушек временно выключен", 403);
  const trip = await rwgpsTrip(token, job.external_id);
  if (
    String(trip.id) !== job.external_id ||
    String(trip.user_id) !== c.external_user_id
  )
    throw new ActivityError("Ride with GPS вернул чужую активность", 403);
  const cycling = trip.activity_type?.startsWith("cycling:");
  if (
    cycling &&
    (!trip.departed_at || Date.parse(trip.departed_at) > Date.now() + 300000)
  )
    throw new ActivityError("В источнике не указана корректная дата поездки");
  // The backfill boundary limits new imports. Existing history does not vanish
  // merely because the user reconnects more than twelve months later.
  const eligible =
    cycling &&
    trip.departed_at &&
    (old?.ride_id || Date.parse(trip.departed_at) >= +new Date(c.import_since));
  const bytes =
    eligible && !trip.stationary
      ? await rwgpsTrack(token, job.external_id, config.maxGpxBytes)
      : null;
  await tx(async (q) => {
    const current = await currentJob(q, job, c);
    if (!current) return;
    const a = await activityRow(q, job, c);
    if (!a) return;
    if (["deleted", "local_deleted"].includes(a.status)) {
      await complete(q, job, c);
      return;
    }
    if (!eligible) {
      // A previously imported trip changed to a non-cycling activity.
      if (a.ride_id) {
        await q.query(
          "UPDATE external_activities SET status='deleted' WHERE id=$1",
          [a.id],
        );
        await deleteRide(q, c.owner_id, a.ride_id);
      }
      await q.query(
        "UPDATE external_activities SET status='ignored',metadata='{}',last_error=NULL,updated_at=now() WHERE id=$1",
        [a.id],
      );
      await complete(q, job, c);
      return;
    }
    const metadata = {
      name: trip.name.trim().slice(0, 120) || "Покатушка Ride with GPS",
      activityType: trip.activity_type,
      startedAt: trip.departed_at,
    };
    const bikes = (
      await q.query(
        "SELECT id,category,classification,is_former FROM bikes WHERE owner_id=$1",
        [c.owner_id],
      )
    ).rows;
    const bike = chooseActivityBike(bikes, trip.activity_type, current.bike_id);
    let result;
    if (bike || a.ride_id)
      result = await importActivityRide(
        q,
        c.owner_id,
        a,
        bike,
        bytes,
        { ...metadata, metrics: rwgpsMetrics(trip) },
        config,
      );
    await q.query(
      "UPDATE external_activities SET status=$2,ride_id=$3,metadata=$4,last_error=NULL,updated_at=now() WHERE id=$1",
      [
        a.id,
        result?.duplicate
          ? "duplicate"
          : result?.id
            ? "synced"
            : "waiting_bike",
        result?.id || a.ride_id,
        JSON.stringify(metadata),
      ],
    );
    await complete(q, job, c);
  });
}
export async function runActivityBatch(db, tx, { limit = 20 } = {}) {
  const config = rwgpsConfig();
  if (!config) return;
  const revocations = (
    await db.query(
      "SELECT * FROM activity_revocations WHERE next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 5",
    )
  ).rows;
  for (const r of revocations) {
    try {
      await revokeRwgpsToken(
        openActivityToken(r.credentials, r.provider + ":" + r.id),
        config,
      );
      await db.query("DELETE FROM activity_revocations WHERE id=$1", [r.id]);
    } catch {
      await db.query(
        "UPDATE activity_revocations SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::int) WHERE id=$1",
        [r.id],
      );
    }
  }
  const jobs = (
    await db.query(
      `SELECT j.* FROM activity_jobs j JOIN activity_connections c ON c.id=j.connection_id JOIN users u ON u.id=c.owner_id
    WHERE j.next_attempt_at<=now() AND NOT u.blocked ORDER BY j.next_attempt_at,j.id LIMIT $1`,
      [limit],
    )
  ).rows;
  for (const job of jobs) {
    try {
      await processActivityJob(db, tx, job);
    } catch (e) {
      // Only controlled diagnostics, never vendor bodies, tokens or request URLs.
      const message =
        e instanceof ActivityError
          ? e.message
          : e.status === 429
            ? "Лимит импорта: повторим позже"
            : "Не удалось импортировать активность. Повторим автоматически.";
      await tx(async (q) => {
        const c = (
          await q.query("SELECT * FROM activity_connections WHERE id=$1", [
            job.connection_id,
          ])
        ).rows[0];
        if (!c || !(await currentJob(q, job, c))) return;
        await q.query(
          "UPDATE activity_jobs SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::int) WHERE id=$1",
          [job.id],
        );
        await q.query(
          "UPDATE activity_connections SET last_error=$2 WHERE id=$1",
          [c.id, message],
        );
        if (job.external_id)
          await q.query(
            "UPDATE external_activities SET status='error',last_error=$5,updated_at=now() WHERE owner_id=$1 AND provider=$2 AND external_user_id=$3 AND external_id=$4 AND status NOT IN ('deleted','local_deleted')",
            [
              c.owner_id,
              c.provider,
              c.external_user_id,
              job.external_id,
              message,
            ],
          );
      });
    }
  }
  // Replaced and deleted imports queue their files; a bounded slice of the
  // queue is enough here. The full storage pass is scripts/cleanup-rides.js.
  await drainRideFileGc(db, { limit: 100 });
}
