// Disposable benchmark: PostgreSQL is required unless --pglite is explicit.
// Never seeds or migrates the database in TEST_DATABASE_URL itself.
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { records, gameShelf, leaderboardSQL } from "../lib/gamification.ts";
import { communityHome } from "../lib/discovery.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";
const args = process.argv.slice(2),
  embedded = args.includes("--pglite");
const baselineRef = args
  .find((v) => v.startsWith("--baseline-ref="))
  ?.split("=")[1];
if (!embedded && !process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL for a disposable PostgreSQL benchmark, or explicitly choose --pglite (not production evidence)",
  );
let baseline, baselineDir, admin;
const reports = [];
try {
  if (baselineRef) {
    const sha = execFileSync(
      "git",
      ["rev-parse", "--verify", baselineRef + "^{commit}"],
      { encoding: "utf8" },
    ).trim();
    baselineDir = await mkdtemp(path.join(tmpdir(), "cola-perf-baseline-"));
    execFileSync("tar", ["-x", "-C", baselineDir], {
      input: execFileSync(
        "git",
        ["archive", sha, "lib", "services/bike-resolver/src"],
        { maxBuffer: 32 * 1024 * 1024 },
      ),
      maxBuffer: 32 * 1024 * 1024,
    });
    await symlink(
      path.resolve("node_modules"),
      path.join(baselineDir, "node_modules"),
    );
    baseline = {
      ...(await import(
        pathToFileURL(path.join(baselineDir, "lib/gamification.ts"))
      )),
      ...(await import(
        pathToFileURL(path.join(baselineDir, "lib/discovery.ts"))
      )),
    };
    console.log(JSON.stringify({ baseline: sha }));
  }
  if (!embedded) {
    admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
  }
  for (const size of [40, 1000]) {
    const name = "cola_perf_" + randomUUID().replaceAll("-", "");
    let db;
    if (embedded) db = new PGlite();
    else {
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.pathname = "/" + name;
      db = new pg.Client({ connectionString: url.href });
      await db.connect();
    }
    const exec = (sql) => (embedded ? db.exec(sql) : db.query(sql));
    try {
      for (const f of (await readdir(new URL("../db", import.meta.url)))
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await exec(
          await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
        );
      await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
        {
          ...defaultSettings,
          scoring: {
            ...defaultSettings.scoring,
            rules: [
              { groupId: "", category: "", match: "Shimano", points: 8 },
              {
                groupId: "frame",
                category: "Part 1",
                match: "Component 1",
                points: 3,
              },
            ],
          },
        },
      ]);
      await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
        defaultCatalog,
      ]);
      // Disable only milestone triggers for bulk fixture creation; all read-side
      // privacy/functions/indexes stay real. No production table is touched.
      await exec(`ALTER TABLE bikes DISABLE TRIGGER awards_bike; ALTER TABLE components DISABLE TRIGGER awards_component; ALTER TABLE photos DISABLE TRIGGER awards_photo; ALTER TABLE bike_likes DISABLE TRIGGER awards_like;
    INSERT INTO users(id,email,name,password_hash,username) SELECT md5('user'||n)::uuid,'u'||n||'@example.test','Rider '||n,'hash','rider-'||n FROM generate_series(1,50) n;
    INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,price,weight,show_bike_price,is_public,description)
    SELECT md5('bike'||n)::uuid,md5('user'||(1+n%50))::uuid,md5('share'||n)::uuid,'Build '||n,'Cube','Travel',2020,(ARRAY['road','gravel','mtb'])[1+n%3],10000+n*200,5+n%25,n%7<>0,n%10<>0,repeat('description ',200) FROM generate_series(1,${size}) n;
    INSERT INTO photos(id,bike_id,filename,is_cover) SELECT md5('photo'||b||'-'||p)::uuid,md5('bike'||b)::uuid,b||'-'||p||'.webp',p=1 FROM generate_series(1,${size}) b CROSS JOIN generate_series(1,8) p;
    INSERT INTO components(id,bike_id,section,category,name,notes,group_id) SELECT md5('part'||b||'-'||p)::uuid,md5('bike'||b)::uuid,'build','Part '||p,'Shimano Component '||p,repeat('notes ',100),'frame' FROM generate_series(1,${size}) b CROSS JOIN generate_series(1,21) p;
    INSERT INTO bike_likes(bike_id,user_id) SELECT md5('bike'||b)::uuid,md5('user'||(1+p))::uuid FROM generate_series(1,${size}) b CROSS JOIN generate_series(1,10)p;
    INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,elapsed_time_s,moving_time_s,avg_speed_mps,elevation_gain_m,point_count,public_point_count,public_geometry,is_public,privacy_radius_m,source_hash,started_at)
    SELECT md5('ride'||n)::uuid,md5('ride-share'||n)::uuid,md5('user'||(1+n%50))::uuid,md5('bike'||n)::uuid,'Ride '||n,20000+n*10,3600,3000,6,100,2,2,'[]',n%9<>0,100,md5('ride'||n),now() FROM generate_series(1,${size}) n;
    INSERT INTO game_rules(key,kind,subject,metric,direction,category,min_distance_km,name,position)
    SELECT 'perf_'||g.key||'_'||n,'record',g.subject,g.metric,CASE WHEN n%2=0 THEN 'min' ELSE 'max' END,g.category,g.min_distance_km,'Synthetic rule '||n,1000+n FROM game_rules g CROSS JOIN generate_series(1,8) n WHERE g.kind='record' AND g.subject IN ('ride','user');
    ANALYZE;`);
      const viewer = (
        await db.query("SELECT id FROM users WHERE username='rider-2'")
      ).rows[0].id;
      const scopes = Number(
        (
          await db.query(
            "SELECT count(DISTINCT (subject,metric,category,CASE WHEN subject='ride' THEN min_distance_km END)) n FROM game_rules WHERE kind='record' AND enabled AND subject<>'bike'",
          )
        ).rows[0].n,
      );
      const paths = {
        home: (q) => communityHome(q, viewer),
        records: (q) => records(q),
        shelf: (q) => gameShelf(q, { userId: viewer }),
      };
      const oldPaths = baseline
        ? {
            home: (q) => baseline.communityHome(q, viewer),
            records: (q) => baseline.records(q),
            shelf: (q) => baseline.gameShelf(q, { userId: viewer }),
          }
        : null;
      const normalize = (key, v) =>
        Object.fromEntries(
          Object.entries(v).filter(
            ([field]) => field !== (key === "home" ? "bikeOfWeek" : "asOf"),
          ),
        );
      const plans = new Map();
      for (const [key, run] of Object.entries(paths)) {
        let previous;
        for (const [version, fn] of [
          ...(baseline ? [["baseline", oldPaths[key]]] : []),
          ["optimized", run],
        ]) {
          for (let iteration = 0; iteration < 3; iteration++) {
            let sqlCount = 0,
              rows = 0,
              bytes = 0;
            const cpu = process.cpuUsage(),
              rss = process.memoryUsage().rss,
              start = performance.now();
            const measured = {
              query: async (sql, params) => {
                sqlCount++;
                const r = await db.query(sql, params);
                rows += r.rows.length;
                bytes += Buffer.byteLength(JSON.stringify(r.rows));
                if (version === "optimized" && key === "home") {
                  assert(
                    r.rows.filter((row) =>
                      Object.hasOwn(row, "author_username"),
                    ).length <= 9,
                    "home hydrates at most nine bike cards",
                  );
                  assert(
                    r.rows.filter(
                      (row) =>
                        Object.hasOwn(row, "is_cover") &&
                        Object.hasOwn(row, "bike_id"),
                    ).length <= 9,
                    "home hydrates at most nine photo rows",
                  );
                  assert(
                    !r.rows.some(
                      (row) =>
                        Object.hasOwn(row, "notes") &&
                        Object.hasOwn(row, "bike_id"),
                    ),
                    "home does not hydrate component notes",
                  );
                }

                if (version === "optimized" && iteration === 0)
                  plans.set(sql, params);
                return r;
              },
            };
            const result = await fn(measured),
              elapsed = performance.now() - start,
              used = process.cpuUsage(cpu);
            if (version === "baseline") previous = normalize(key, result);
            else {
              if (previous)
                assert.deepEqual(
                  normalize(key, result),
                  previous,
                  `${key} matches baseline`,
                );
              assert(
                sqlCount <=
                  (key === "home" ? 11 : key === "shelf" ? 7 : 6) + scopes,
                `${key} query budget: ${sqlCount}`,
              );
              assert(
                bytes <= 110000 + size * 600,
                `${key} fixture JSON byte budget: ${bytes}`,
              );
              if (key === "home") {
                assert(result.popular.length <= 9);
                assert(result.popular.every((b) => b.photos.length <= 1));
              }
            }
            const report = {
              engine: embedded ? "PGlite (not production)" : "PostgreSQL",
              size,
              path: key,
              version,
              phase:
                iteration === 0
                  ? "first-call (DB analyzed; no shared app cache)"
                  : "repeat",
              sqlCount,
              rows,
              jsonBytes: bytes,
              latencyMs: Math.round(elapsed * 100) / 100,
              cpuMs: Math.round((used.user + used.system) / 1000),
              rssBytes: process.memoryUsage().rss,
              rssDelta: process.memoryUsage().rss - rss,
            };
            reports.push(report);
            console.log(JSON.stringify(report));
          }
        }
      }
      // Explain every distinct optimized query with its real parameters, including
      // home cover selection and metric functions, not just the final LIMIT.
      for (const [sql, params] of plans) {
        const explain = await db.query(
          "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql,
          params,
        );
        console.log(
          JSON.stringify({
            engine: embedded ? "PGlite" : "PostgreSQL",
            size,
            sql,
            plan: explain.rows[0]["QUERY PLAN"],
          }),
        );
      }
      const compact = (await db.query(leaderboardSQL)).rows;
      assert(compact.every((b) => !("components" in b) && !("photos" in b)));
    } finally {
      await (embedded ? db.close() : db.end());
      if (!embedded) await admin.query(`DROP DATABASE ${name}`);
    }
  }
  console.log(JSON.stringify({ summary: reports }));
} finally {
  if (admin) await admin.end();
  if (baselineDir) await rm(baselineDir, { recursive: true, force: true });
}
