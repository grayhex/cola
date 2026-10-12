// Isolated synthetic PostgreSQL database, never the supplied database itself.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { userRow } from "../tests/support/people.ts";
import { bikeRow, componentRow, photoRow } from "../tests/support/bikes.ts";
import { seedSiteDefaults } from "../tests/support/database.ts";
import {
  ownedBikeList,
  ownedBikeCards,
  ownedBikeChoices,
} from "../lib/showcase.ts";
import { getSite } from "../lib/site.ts";
const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !["127.0.0.1", "localhost"].includes(new URL(connection).hostname)
)
  throw new Error("Set TEST_DATABASE_URL to local disposable PostgreSQL");
const ref = process.argv
  .find((v) => v.startsWith("--baseline-ref="))
  ?.split("=")[1];
if (!ref) throw new Error("Pass --baseline-ref=SHA");
const sha = execFileSync("git", ["rev-parse", "--verify", ref + "^{commit}"], {
  encoding: "utf8",
}).trim();
const directory = await mkdtemp(path.join(tmpdir(), "cola-owner-baseline-"));
execFileSync("tar", ["-x", "-C", directory], {
  input: execFileSync(
    "git",
    ["archive", sha, "lib", "services/bike-resolver/src"],
    { maxBuffer: 32 * 1024 * 1024 },
  ),
});
await symlink(
  path.resolve("node_modules"),
  path.join(directory, "node_modules"),
);
const old = await import(
    pathToFileURL(path.join(directory, "lib/showcase.ts"))
  ),
  service = await import(
    pathToFileURL(path.join(directory, "lib/bike-service.ts"))
  );
const admin = new pg.Client({ connectionString: connection });
await admin.connect();
const name = "cola_owner_" + randomUUID().replaceAll("-", "");
let pool,
  created = false;
try {
  await admin.query(`CREATE DATABASE ${name}`);
  created = true;
  const url = new URL(connection);
  url.pathname = "/" + name;
  pool = new pg.Pool({ connectionString: url.href, max: 4 });
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pool.query(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await seedSiteDefaults(pool);
  const site = await getSite(pool);
  for (const count of [1, 10, 50]) {
    const owner = await userRow(pool);
    for (let i = 0; i < count; i++) {
      const bike = await bikeRow(pool, owner.id, {
        name: `Synthetic ${i}`,
        description: "Notes ".repeat(300),
        is_public: i % 2 === 0,
        is_former: i % 3 === 0,
      });
      // A large historical factory payload is private editor data; retained by legacy/detail.
      await pool.query("UPDATE bikes SET factory_spec=$2 WHERE id=$1", [
        bike.id,
        { legacy: "Factory notes ".repeat(1000) },
      ]);
      for (let c = 0; c < 24; c++)
        await componentRow(pool, bike.id, {
          name: `Component ${c}`,
          category: `Part ${c}`,
          notes: "Notes ".repeat(150),
          price: "1000",
        });
      await photoRow(pool, bike.id, { is_cover: true });
      await photoRow(pool, bike.id);
    }
    for (const [mode, fn] of [
      [
        "baseline-full",
        async (q) => {
          const rows = await service.ownBikeRows(q, owner.id);
          return {
            bikes: await Promise.all(
              rows.map((b) => old.decorateBike(q, b, owner.id, site)),
            ),
          };
        },
      ],
      [
        "head-full",
        async (q) => ({ bikes: await ownedBikeList(q, owner.id, site) }),
      ],
      ["head-cards", (q) => ownedBikeCards(q, owner.id, site)],
      ["head-overview", (q) => ownedBikeCards(q, owner.id, site, { limit: 3 })],
      [
        "head-choices",
        async (q) => ({ bikes: await ownedBikeChoices(q, owner.id) }),
      ],
    ]) {
      const elapsed = [];
      let queries = 0,
        rows = 0,
        result;
      const statements = [];
      for (let sample = 0; sample < 4; sample++) {
        queries = 0;
        rows = 0;
        statements.length = 0;
        const measured = {
          async query(sql, values) {
            queries++;
            statements.push([sql, values]);
            const r = await pool.query(sql, values);
            rows += r.rows.length;
            return r;
          },
        };
        const start = performance.now();
        result = await fn(measured);
        elapsed.push(performance.now() - start);
      }
      const warm = elapsed.slice(1).sort((a, b) => a - b)[1];
      console.log(
        JSON.stringify({
          baseline: sha,
          count,
          mode,
          queries,
          returnedSqlRows: rows,
          returnedBikes: result.bikes.length,
          jsonBytes: Buffer.byteLength(JSON.stringify(result)),
          coldMs: +elapsed[0].toFixed(2),
          warmMedianMs: +warm.toFixed(2),
        }),
      );
      if (count === 50 && mode === "head-cards")
        for (const [sql, values] of statements) {
          const explain = await pool.query(
            "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql,
            values,
          );
          const plan = explain.rows[0]["QUERY PLAN"][0];
          console.log(
            JSON.stringify({
              explain: sql.split(" FROM ")[0],
              planningMs: plan["Planning Time"],
              executionMs: plan["Execution Time"],
              plan: plan.Plan,
            }),
          );
        }
    }
    for (const [mode, fn] of [
      [
        "baseline-full-burst10",
        async (q) => {
          const rows = await service.ownBikeRows(q, owner.id);
          return Promise.all(
            rows.map((b) => old.decorateBike(q, b, owner.id, site)),
          );
        },
      ],
      ["head-cards-burst10", (q) => ownedBikeCards(q, owner.id, site)],
    ]) {
      let maxWaiting = 0;
      const measured = {
        query(sql, values) {
          const pending = pool.query(sql, values);
          maxWaiting = Math.max(maxWaiting, pool.waitingCount);
          return pending;
        },
      };
      const cpu = process.cpuUsage(),
        start = performance.now(),
        rssBefore = process.memoryUsage().rss;
      await Promise.all(Array.from({ length: 10 }, () => fn(measured)));
      const used = process.cpuUsage(cpu);
      console.log(
        JSON.stringify({
          count,
          mode,
          elapsedMs: +(performance.now() - start).toFixed(2),
          nodeCpuMs: (used.user + used.system) / 1000,
          rssBefore,
          rssAfter: process.memoryUsage().rss,
          poolMax: 4,
          maxWaiting,
          waitingAfter: pool.waitingCount,
          note: "CPU/RSS are Node client only, not PostgreSQL server",
        }),
      );
    }
  }
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
