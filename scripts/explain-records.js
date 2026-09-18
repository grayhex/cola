// Isolated in-memory benchmark. Never connects to production or modifies its tables.
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { leaderboardSQL, rankRecords } from "../lib/gamification.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { defaultGamification } from "../lib/gamification-definitions.js";
const q = new PGlite();
try {
  for (const f of (await readdir(new URL("../db", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await q.exec(
      await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
    );
  await q.exec(`ALTER TABLE bikes DISABLE TRIGGER awards_bike; ALTER TABLE components DISABLE TRIGGER awards_component; ALTER TABLE photos DISABLE TRIGGER awards_photo; ALTER TABLE bike_likes DISABLE TRIGGER awards_like;
 INSERT INTO users(id,email,name,password_hash,username) SELECT md5('user'||n)::uuid,'u'||n||'@example.test','Rider '||n,'hash','rider-'||n FROM generate_series(1,500) n;
 INSERT INTO bikes(id,owner_id,share_id,name,brand,model,year,category,price,weight,show_bike_price,is_public) SELECT md5('bike'||n)::uuid,md5('user'||(1+n%500))::uuid,md5('share'||n)::uuid,'Build '||n,'Cube','Travel',2020,(ARRAY['road','gravel','mtb'])[1+n%3],10000+n*200,5+n%25,true,n%10<>0 FROM generate_series(1,2000) n;
 INSERT INTO photos(id,bike_id,filename) SELECT md5('photo'||n)::uuid,md5('bike'||n)::uuid,n||'.webp' FROM generate_series(1,2000)n;
 INSERT INTO components(id,bike_id,section,category,name) SELECT md5('part'||b||'-'||p)::uuid,md5('bike'||b)::uuid,'build','Part '||p,'Component '||p FROM generate_series(1,2000)b CROSS JOIN generate_series(1,21)p;
 INSERT INTO bike_likes(bike_id,user_id) SELECT md5('bike'||b)::uuid,md5('user'||(1+p))::uuid FROM generate_series(1,2000)b CROSS JOIN generate_series(1,10)p;
 ANALYZE;`);
  const explain = await q.query(
    "EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) " + leaderboardSQL,
  );
  console.log(
    "Dataset: 500 owners, 2,000 bikes (1,800 public), 42,000 components, 2,000 photos, 20,000 likes. PGlite PostgreSQL; timings indicative, not a production SLA.",
  );
  console.log(explain.rows.map((r) => r["QUERY PLAN"]).join("\n"));
  const start = performance.now(),
    rows = (await q.query(leaderboardSQL)).rows,
    middle = performance.now();
  const ranked = rankRecords(rows, defaultGamification, {
    settings: defaultSettings,
    catalog: defaultCatalog,
  });
  console.log(
    JSON.stringify({
      rows: rows.length,
      records: ranked.length,
      bulkQueryMs: Math.round(middle - start),
      rankingMs: Math.round(performance.now() - middle),
    }),
  );
} finally {
  await q.close();
}
