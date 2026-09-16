import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { PostgresCache } from "../src/cache.js";
import { queryKey } from "../src/normalize.js";
it("PostgreSQL cache persists provenance, respects expiry and adapter version", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      readFileSync(
        new URL("../migrations/001_cache.sql", import.meta.url),
        "utf8",
      ),
    );
    const cache = new PostgresCache(db as any);
    await cache.ready();
    const q = { brand: "CUBE", model: "Travel", trim: "SL", year: 2020 };
    const result: any = {
      status: "resolved",
      query: q,
      source: { url: "https://archiv.cube.eu/2020/350600" },
      rawSpecification: { FRAME: "Aluminium" },
      components: [],
      cached: false,
    };
    await cache.put(queryKey(q), q, result, "cube", 1, "sha256");
    expect(await cache.get(queryKey(q), "cube", 1)).toEqual(result);
    expect(await cache.get(queryKey(q), "cube", 2)).toBeNull();
    const { rows }: any = await db.query("SELECT * FROM bike_resolver.cache");
    expect(rows[0]).toMatchObject({
      source_hash: "sha256",
      source_url: result.source.url,
      adapter_version: 1,
    });
    await db.query(
      "UPDATE bike_resolver.cache SET expires_at=now()-interval '1 second'",
    );
    expect(await cache.get(queryKey(q), "cube", 1)).toBeNull();
    await cache.put(queryKey(q), q, result, "cube", 2, "new-hash");
    expect(await cache.get(queryKey(q), "cube", 2)).toEqual(result);
  } finally {
    await db.close();
  }
}, 45000);
