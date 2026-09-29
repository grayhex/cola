import {
  mkdir,
  writeFile,
  readFile,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
export const rideDir = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.RIDES_DIR || "rides");
function file(id, kind) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !["ride", "preview"].includes(kind))
    throw Error("Invalid storage key");
  return path.join(rideDir(), `${kind}-${id}.gpx.gz`);
}
export async function putOriginal(id, bytes, kind = "ride") {
  await mkdir(rideDir(), { recursive: true, mode: 0o700 });
  await writeFile(file(id, kind), await compress(bytes), {
    flag: "wx",
    mode: 0o600,
  });
}
export async function getOriginal(id, kind = "ride") {
  return decompress(await readFile(file(id, kind)), {
    maxOutputLength: 10 * 1024 * 1024,
  });
}
export async function removeOriginal(id, kind = "ride") {
  await unlink(file(id, kind)).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}

// ── Maintenance (#248) ─────────────────────────────────────────────────
// HTTP requests never walk the storage or other people's files: they only
// release the file keys they freed themselves (collectRideFiles). The
// durable queue, expired previews and crash-created orphans are served in
// bounded batches by scripts/cleanup-rides.js; the activity worker drains
// a bounded slice of the queue it fills.

const orphanGraceMs = 86400000;
const orphanCursor = "ride-orphans";

/** Keys that are still a live file, so their queued deletion is dropped
 * instead of unlinking a file in use. A ride file is live while it is the
 * ride's track: its track_file_id, or its own id without one.
 * @param {any} q @param {{id: string, kind: string}[]} keys */
async function liveKeys(q, keys) {
  const rides = keys.filter((k) => k.kind === "ride").map((k) => k.id),
    previews = keys.filter((k) => k.kind === "preview").map((k) => k.id),
    live = new Set();
  if (rides.length)
    for (const r of (
      await q.query(
        "SELECT track_file_id AS id FROM rides WHERE track_file_id=ANY($1::uuid[]) UNION SELECT id FROM rides WHERE id=ANY($1::uuid[]) AND track_file_id IS NULL AND has_track",
        [rides],
      )
    ).rows)
      live.add("ride:" + r.id);
  if (previews.length)
    for (const r of (
      await q.query("SELECT id FROM ride_previews WHERE id=ANY($1::uuid[])", [
        previews,
      ])
    ).rows)
      live.add("preview:" + r.id);
  return live;
}
/** Unlink queued files and confirm each row only after its unlink (or
 * ENOENT). A storage error keeps the row for the next pass and is counted,
 * never dropped silently. @param {any} q @param {{id: string, kind: string}[]} rows */
async function releaseQueued(q, rows) {
  const result = { removed: 0, kept: 0, failed: 0 };
  if (!rows.length) return result;
  const live = await liveKeys(q, rows),
    done = [];
  for (const r of rows) {
    if (live.has(r.kind + ":" + r.id)) {
      result.kept++;
      done.push(r);
      continue;
    }
    try {
      await removeOriginal(r.id, r.kind);
      result.removed++;
      done.push(r);
    } catch {
      result.failed++;
    }
  }
  if (done.length)
    await q.query(
      "DELETE FROM ride_file_gc g USING unnest($1::uuid[],$2::text[]) d(id,kind) WHERE g.id=d.id AND g.kind=d.kind",
      [done.map((r) => r.id), done.map((r) => r.kind)],
    );
  return result;
}
/** Files a request released itself — its deleted ride or consumed preview.
 * Bounded by the keys given; no scan and no other owner's rows.
 * @param {any} q @param {{id: string, kind: "ride"|"preview"}[]} keys */
export async function collectRideFiles(q, keys) {
  const valid = keys.filter((k) => k?.id);
  if (!valid.length) return { removed: 0, kept: 0, failed: 0 };
  const rows = (
    await q.query(
      "SELECT g.id,g.kind FROM ride_file_gc g JOIN unnest($1::uuid[],$2::text[]) d(id,kind) ON g.id=d.id AND g.kind=d.kind",
      [valid.map((k) => k.id), valid.map((k) => k.kind)],
    )
  ).rows;
  return releaseQueued(q, rows);
}
/** One bounded batch of the durable queue, oldest first.
 * @param {any} q @param {{limit?: number}} [options] */
export async function drainRideFileGc(q, { limit = 200 } = {}) {
  const rows = (
    await q.query(
      "SELECT id,kind FROM ride_file_gc ORDER BY created_at,id LIMIT $1",
      [limit],
    )
  ).rows;
  return { ...(await releaseQueued(q, rows)), batch: rows.length };
}
/** Expired previews in bounded batches; their files join the queue through
 * the delete trigger. @param {any} q @param {{limit?: number}} [options] */
export async function expireRidePreviews(q, { limit = 500 } = {}) {
  return (
    await q.query(
      "DELETE FROM ride_previews WHERE id IN (SELECT id FROM ride_previews WHERE expires_at<now() ORDER BY expires_at LIMIT $1)",
      [limit],
    )
  ).rowCount;
}
/** A bounded, resumable pass over crash-created orphans: at most `limit`
 * files are checked, in name order after the stored cursor; references are
 * checked per batch, not per file. Files younger than the grace period are
 * never touched. @param {any} q @param {{limit?: number, now?: number}} [options] */
export async function scanRideOrphans(
  q,
  { limit = 2000, now = Date.now() } = {},
) {
  const from =
      (
        await q.query(
          "SELECT position FROM maintenance_cursors WHERE name=$1",
          [orphanCursor],
        )
      ).rows[0]?.position || "",
    names = (await readdir(/*turbopackIgnore: true*/ rideDir()).catch(() => []))
      .filter((n) => /^(ride|preview)-[a-f0-9-]{36}\.gpx\.gz$/.test(n))
      .sort(),
    start = names.findIndex((n) => n > from),
    slice = start < 0 ? [] : names.slice(start, start + limit),
    result = { checked: 0, removed: 0, failed: 0, wrapped: false };
  const old = [];
  for (const name of slice) {
    // Names were filtered by the same pattern above.
    const [, kind, id] = /** @type {RegExpExecArray} */ (
      /^(ride|preview)-(.+)\.gpx\.gz$/.exec(name)
    );
    const info = await stat(file(id, kind)).catch(() => null);
    result.checked++;
    if (info && now - info.mtimeMs >= orphanGraceMs) old.push({ id, kind });
  }
  // Orphans stay conservative: any ride row with this id or track file keeps
  // the file; replaced tracks are released through the queue instead.
  const rides = old.filter((k) => k.kind === "ride").map((k) => k.id),
    previews = old.filter((k) => k.kind === "preview").map((k) => k.id),
    referenced = new Set();
  if (rides.length)
    for (const r of (
      await q.query(
        "SELECT id FROM rides WHERE id=ANY($1::uuid[]) UNION SELECT track_file_id FROM rides WHERE track_file_id=ANY($1::uuid[])",
        [rides],
      )
    ).rows)
      referenced.add("ride:" + r.id);
  if (previews.length)
    for (const r of (
      await q.query("SELECT id FROM ride_previews WHERE id=ANY($1::uuid[])", [
        previews,
      ])
    ).rows)
      referenced.add("preview:" + r.id);
  for (const k of old) {
    if (referenced.has(k.kind + ":" + k.id)) continue;
    try {
      await removeOriginal(k.id, k.kind);
      result.removed++;
    } catch {
      result.failed++;
    }
  }
  // The next pass continues after the last checked name; the end wraps.
  const next = slice.length === limit ? slice[slice.length - 1] : "";
  result.wrapped = next === "";
  await q.query(
    "INSERT INTO maintenance_cursors(name,position) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position,updated_at=now()",
    [orphanCursor, next],
  );
  return result;
}
/** Backlog for diagnostics: counts only, no ids or paths. @param {any} q */
export async function rideStorageBacklog(q) {
  const row = (
    await q.query(
      "SELECT (SELECT count(*)::int FROM ride_file_gc) queued,(SELECT min(created_at) FROM ride_file_gc) oldest,(SELECT count(*)::int FROM ride_previews WHERE expires_at<now()) expired",
    )
  ).rows[0];
  return {
    queued: row.queued,
    oldestQueuedAt: row.oldest ? new Date(row.oldest).toISOString() : null,
    expiredPreviews: row.expired,
  };
}
/** The scheduled pass (scripts/cleanup-rides.js): expired previews, the
 * queue in batches until empty or out of time, then one bounded orphan
 * slice. A session advisory lock lets only one pass run at a time.
 * @param {any} q a pg Pool or a single connection
 * @param {{batch?: number, budgetMs?: number, orphanLimit?: number}} [options] */
export async function cleanupRides(
  q,
  { batch = 200, budgetMs = 20000, orphanLimit = 2000 } = {},
) {
  const client = typeof q.connect === "function" ? await q.connect() : q;
  const lock = 0x7269_6465; // "ride"
  try {
    const locked = (
      await client.query("SELECT pg_try_advisory_lock($1) ok", [lock])
    ).rows[0].ok;
    if (!locked) return { skipped: true };
    try {
      const deadline = Date.now() + budgetMs,
        report = {
          skipped: false,
          expiredPreviews: 0,
          gc: { removed: 0, kept: 0, failed: 0, batches: 0 },
          orphans: { checked: 0, removed: 0, failed: 0, wrapped: false },
        };
      let expired;
      do {
        expired = await expireRidePreviews(client, { limit: batch });
        report.expiredPreviews += expired;
      } while (expired === batch && Date.now() < deadline);
      for (;;) {
        const step = await drainRideFileGc(client, { limit: batch });
        report.gc.batches++;
        report.gc.removed += step.removed;
        report.gc.kept += step.kept;
        report.gc.failed += step.failed;
        // Stop when a batch was short or only failures remain.
        if (step.batch < batch || step.failed === step.batch) break;
        if (Date.now() >= deadline) break;
      }
      if (Date.now() < deadline)
        report.orphans = await scanRideOrphans(client, { limit: orphanLimit });
      return { ...report, backlog: await rideStorageBacklog(client) };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lock]);
    }
  } finally {
    if (client !== q) client.release();
  }
}
