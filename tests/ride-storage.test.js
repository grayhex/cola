import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  readFile,
  readdir,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  utimes,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  previewRide,
  previewParse,
  saveRide,
  planRide,
  deleteRide,
  rideDefaults,
} from "../lib/rides.ts";
import {
  collectRideFiles,
  drainRideFileGc,
  expireRidePreviews,
  scanRideOrphans,
  cleanupRides,
  putOriginal,
} from "../lib/ride-storage.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
import { gpx, loop } from "./ride-fixtures.js";

// #248: requests release only their own files; the storage pass is bounded,
// resumable and never drops a queued deletion on a storage error.
const config = { ...rideDefaults, uploadRate: 60 };
const old = new Date(Date.now() - 3 * 86400000);
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
async function setup() {
  const dir = await mkdtemp(tmpdir() + "/cola-ride-storage-");
  process.env.RIDES_DIR = dir;
  const db = new PGlite();
  for (const f of (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultSettings),
  ]);
  await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
    JSON.stringify(defaultCatalog),
  ]);
  const owner = randomUUID(),
    bike = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,'s@x','storage','hash','storage')",
    [owner],
  );
  await db.query(
    "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Test',2026,'road',true)",
    [bike, owner],
  );
  return { dir, db, owner, bike };
}
/** Other people's old files with no rows: what a global scan would visit. */
async function addOrphans(dir, count) {
  const names = Array.from(
    { length: count },
    () => `ride-${randomUUID()}.gpx.gz`,
  );
  for (let i = 0; i < names.length; i += 500)
    await Promise.all(
      names.slice(i, i + 500).map(async (name) => {
        const p = path.join(dir, name);
        await writeFile(p, "x");
        await utimes(p, old, old);
      }),
    );
  return names;
}
const counting = (q, counter) =>
  new Proxy(q, {
    get(target, key) {
      if (key === "query")
        return (...args) => {
          counter.n++;
          return target.query(...args);
        };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
/** The request paths of app/api/rides as the route runs them. */
async function requests(db, owner, bike, round) {
  const counts = {};
  const run = async (name, fn) => {
    const counter = { n: 0 },
      started = performance.now();
    const result = await fn(counter);
    counts[name] = { queries: counter.n, ms: performance.now() - started };
    return result;
  };
  const bytes = gpx([
    loop.map((p) => [p[0] + round * 0.001, p[1], p[2], p[3]]),
  ]);
  const preview = await run("preview", (c) => {
    const parsed = previewParse(bytes, config);
    return db.transaction((q) =>
      previewRide(counting(q, c), owner, bytes, config, { parsed }),
    );
  });
  const saved = await run("save", async (c) => {
    const r = await db.transaction((q) =>
      saveRide(
        counting(q, c),
        owner,
        {
          previewId: preview.previewId,
          bikeId: bike,
          title: "Round " + round,
          description: "",
          isPublic: false,
          privacyEnabled: false,
          privacyRadiusM: 500,
        },
        config,
      ),
    );
    await collectRideFiles(counting(db, c), [
      { id: preview.previewId, kind: "preview" },
    ]);
    return r;
  });
  await run("plan", (c) =>
    db.transaction((q) =>
      planRide(
        counting(q, c),
        owner,
        {
          bikeId: bike,
          title: "Plan " + round,
          description: "",
          isPublic: false,
          privacyEnabled: false,
          privacyRadiusM: 500,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          meetingVisibility: "public",
        },
        config,
      ),
    ),
  );
  await run("delete", async (c) => {
    const { fileId } = await db.transaction((q) =>
      deleteRide(counting(q, c), owner, saved.id),
    );
    await collectRideFiles(counting(db, c), [{ id: fileId, kind: "ride" }]);
  });
  return counts;
}

test("request paths never walk storage: queries stay flat at 0 / 1 000 / 10 000 old foreign files", async () => {
  const { dir, db, owner, bike } = await setup();
  try {
    const rows = [];
    let orphans = [];
    for (const [round, total] of [
      [1, 0],
      [2, 1000],
      [3, 10000],
    ]) {
      orphans = orphans.concat(await addOrphans(dir, total - orphans.length));
      const counts = await requests(db, owner, bike, round);
      rows.push({ orphans: total, ...counts });
      // Nobody else's file was touched by a request.
      const left = (await readdir(dir)).filter((n) => orphans.includes(n));
      assert.equal(left.length, total);
      // The request's own files: the consumed preview and the deleted
      // ride's track are gone right away.
      assert.equal(
        (await readdir(dir)).filter((n) => !orphans.includes(n)).length,
        0,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM ride_file_gc")).rows[0].n,
        0,
      );
    }
    for (const op of ["preview", "save", "plan", "delete"])
      assert.deepEqual(
        rows.map((r) => r[op].queries),
        rows.map(() => rows[0][op].queries),
        op + " query count must not grow with storage",
      );
    // Measured on this machine for the PR; PGlite, synthetic data.
    console.log(
      "ride request paths",
      JSON.stringify(
        rows.map((r) => ({
          orphans: r.orphans,
          ...Object.fromEntries(
            ["preview", "save", "plan", "delete"].map((op) => [
              op,
              `${r[op].queries} q / ${r[op].ms.toFixed(1)} ms`,
            ]),
          ),
        })),
      ),
    );
    // The scheduled pass does reach them, in bounded resumable slices.
    let passes = 0,
      report;
    do {
      report = await scanRideOrphans(db, { limit: 4000 });
      passes++;
    } while (!report.wrapped);
    assert.equal(passes, 3);
    assert.equal(
      (await readdir(dir)).filter((n) => orphans.includes(n)).length,
      0,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RIDES_DIR;
  }
});

test("GC queue: bounded batches, live track files kept, ENOENT, storage errors kept for retry, rollback", async () => {
  const { dir, db, owner, bike } = await setup();
  try {
    const queue = async (id, kind = "ride") =>
      db.query("INSERT INTO ride_file_gc(id,kind) VALUES($1,$2)", [id, kind]);
    const queued = async () =>
      (await db.query("SELECT count(*)::int n FROM ride_file_gc")).rows[0].n;
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (const id of ids) {
      await putOriginal(id, Buffer.from("track"));
      await queue(id);
    }
    // Bounded: one call handles one batch only.
    const first = await drainRideFileGc(db, { limit: 2 });
    assert.equal(first.batch, 2);
    assert.equal(first.removed, 2);
    assert.equal(await queued(), 3);
    // A crash after unlink and before the row was confirmed: ENOENT next time.
    // The queue orders by time, then id: equal timestamps make the first
    // batch any two of the five, so take a file that is still queued.
    const [pending] = (
      await db.query("SELECT id FROM ride_file_gc ORDER BY id LIMIT 1")
    ).rows;
    await rm(path.join(dir, `ride-${pending.id}.gpx.gz`));
    // Two passes at once finish the queue without errors or double counts.
    const [a, b] = await Promise.all([
      drainRideFileGc(db, { limit: 10 }),
      drainRideFileGc(db, { limit: 10 }),
    ]);
    assert.equal(a.failed + b.failed, 0);
    assert.equal(await queued(), 0);
    for (const id of ids)
      assert.equal(await exists(path.join(dir, `ride-${id}.gpx.gz`)), false);

    // A queued key that is still a live track (RWGPS track_file_id) stays.
    const ride = randomUUID(),
      track = randomUUID();
    await db.query(
      "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,has_track,track_file_id) VALUES($1,$1,$2,$3,'Live',0,0,0,'[]',500,'live',true,$4)",
      [ride, owner, bike, track],
    );
    await putOriginal(track, Buffer.from("live"));
    await queue(track);
    const live = await drainRideFileGc(db);
    assert.equal(live.kept, 1);
    assert.equal(await exists(path.join(dir, `ride-${track}.gpx.gz`)), true);
    assert.equal(await queued(), 0);

    // A storage error keeps the row and is reported, then succeeds later.
    const stuck = randomUUID(),
      stuckPath = path.join(dir, `ride-${stuck}.gpx.gz`);
    await mkdir(stuckPath);
    await writeFile(path.join(stuckPath, "blocker"), "x");
    await queue(stuck);
    const failed = await drainRideFileGc(db);
    assert.equal(failed.failed, 1);
    assert.equal(await queued(), 1);
    await rm(stuckPath, { recursive: true });
    assert.equal((await drainRideFileGc(db)).removed, 1);
    assert.equal(await queued(), 0);

    // A rolled-back delete queues nothing and keeps its file.
    await assert.rejects(
      db.transaction(async (q) => {
        await deleteRide(q, owner, ride);
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(await queued(), 0);
    assert.equal(await exists(path.join(dir, `ride-${track}.gpx.gz`)), true);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RIDES_DIR;
  }
});

test("orphans: grace period, references kept, resumable cursor; expired previews free the quota", async () => {
  const { dir, db, owner, bike } = await setup();
  try {
    // Young unreferenced file (an import that has not committed yet).
    const young = `ride-${randomUUID()}.gpx.gz`;
    await writeFile(path.join(dir, young), "x");
    // Old file of an existing ride (id and track key) and of a live preview.
    const ride = randomUUID(),
      preview = randomUUID();
    await db.query(
      "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,has_track) VALUES($1,$1,$2,$3,'Old',0,0,0,'[]',500,'old',true)",
      [ride, owner, bike],
    );
    await db.query(
      "INSERT INTO ride_previews(id,owner_id,source_hash) VALUES($1,$2,'p')",
      [preview, owner],
    );
    const kept = [`ride-${ride}.gpx.gz`, `preview-${preview}.gpx.gz`];
    for (const name of kept) {
      await writeFile(path.join(dir, name), "x");
      await utimes(path.join(dir, name), old, old);
    }
    const orphans = await addOrphans(dir, 5);
    await writeFile(path.join(dir, "notes.txt"), "not ours");
    const passes = [];
    let report;
    do {
      report = await scanRideOrphans(db, { limit: 3 });
      passes.push(report);
    } while (!report.wrapped);
    // 8 matching files in slices of 3: 3 + 3 + 2.
    assert.deepEqual(
      passes.map((p) => p.checked),
      [3, 3, 2],
    );
    assert.equal(
      passes.reduce((n, p) => n + p.removed, 0),
      orphans.length,
    );
    const left = await readdir(dir);
    for (const name of [young, ...kept, "notes.txt"])
      assert.ok(left.includes(name), name + " must stay");
    for (const name of orphans) assert.ok(!left.includes(name));

    // Ten expired previews neither hold the quota nor survive the pass.
    for (let i = 0; i < 10; i++)
      await db.query(
        "INSERT INTO ride_previews(id,owner_id,source_hash,expires_at) VALUES($1,$2,'e',now()-interval '1 minute')",
        [randomUUID(), owner],
      );
    const bytes = gpx([loop]);
    const fresh = await db.transaction((q) =>
      previewRide(q, owner, bytes, config),
    );
    assert.ok(fresh.previewId);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM ride_previews WHERE expires_at<now()",
        )
      ).rows[0].n,
      0,
    );
    // Their files are queued; the scheduled pass drains the queue.
    assert.ok(
      (await db.query("SELECT count(*)::int n FROM ride_file_gc")).rows[0].n >=
        10,
    );
    await db.query(
      "UPDATE ride_previews SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [fresh.previewId],
    );
    assert.equal(await expireRidePreviews(db, { limit: 1 }), 1);
    const pass = await cleanupRides(db, { batch: 4 });
    assert.equal(pass.skipped, false);
    assert.equal(pass.gc.failed, 0);
    assert.deepEqual(pass.backlog, {
      queued: 0,
      oldestQueuedAt: null,
      expiredPreviews: 0,
    });
    assert.equal(
      await exists(path.join(dir, `preview-${fresh.previewId}.gpx.gz`)),
      false,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RIDES_DIR;
  }
});
