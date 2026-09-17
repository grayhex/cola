import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import pino from "pino";
import { SettingsStore, defaultSettings } from "../src/settings.js";
import { buildApp } from "../src/app.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { createAdapters } from "../src/adapters/index.js";
import { ManufacturerHttpClient } from "../src/http.js";
it("settings persist, reject stale saves and disable adapters before network access", async () => {
  const db = new PGlite();
  for (const m of ["001_cache", "002_settings"])
    await db.exec(
      readFileSync(
        new URL("../migrations/" + m + ".sql", import.meta.url),
        "utf8",
      ),
    );
  const settings = new SettingsStore(db as any);
  await settings.load();
  const logger = pino({ level: "silent" }),
    cache = new MemoryCache();
  const app = buildApp(
    new Resolver(
      createAdapters(new ManufacturerHttpClient(logger)),
      cache,
      logger,
    ),
    cache,
    settings,
  );
  try {
    expect(
      (await app.inject("/v1/brands"))
        .json()
        .brands.filter((b: any) => b.enabled)
        .map((b: any) => b.id),
    ).toEqual(["specialized", "canyon", "giant"]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/resolve",
          payload: { brand: "CUBE", model: "Travel", trim: "SL", year: 2020 },
        })
      ).json().status,
    ).toBe("unsupported_brand");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/internal/settings",
          payload: {
            version: 1,
            value: { ...defaultSettings, enabled: false },
          },
        })
      ).statusCode,
    ).toBe(200);
    const reloaded = new SettingsStore(db as any);
    await reloaded.load();
    expect(reloaded.value.enabled).toBe(false);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/internal/settings",
          payload: { version: 1, value: defaultSettings },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/internal/settings",
          payload: { version: 2, value: { ...defaultSettings, timeoutMs: 0 } },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
    await db.close();
  }
}, 45000);
it('upgrade drops legacy allowed domains without banning them',async()=>{
 const db=new PGlite();
 try{
  for(const m of ['001_cache','002_settings'])await db.exec(readFileSync(new URL('../migrations/'+m+'.sql',import.meta.url),'utf8'));
  await db.query(`UPDATE bike_resolver.settings SET value=value || '{"manualDomains":["www.velo-port.ru"]}'::jsonb`);
  await db.exec(readFileSync(new URL('../migrations/003_source_policy.sql',import.meta.url),'utf8'));
  const settings=new SettingsStore(db as any);await settings.load();expect(settings.value.blockedDomains).toEqual([]);expect(settings.value).not.toHaveProperty('manualDomains');
 }finally{await db.close();}
});
