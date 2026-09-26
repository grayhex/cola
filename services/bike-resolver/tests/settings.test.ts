import { it, expect, vi } from "vitest";
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
    ).toEqual(["specialized", "canyon", "giant", "gt"]);
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
it("upgrade drops legacy allowed domains without banning them", async () => {
  const db = new PGlite();
  try {
    for (const m of ["001_cache", "002_settings"])
      await db.exec(
        readFileSync(
          new URL("../migrations/" + m + ".sql", import.meta.url),
          "utf8",
        ),
      );
    await db.query(
      `UPDATE bike_resolver.settings SET value=value || '{"manualDomains":["www.velo-port.ru"]}'::jsonb`,
    );
    await db.exec(
      readFileSync(
        new URL("../migrations/003_source_policy.sql", import.meta.url),
        "utf8",
      ),
    );
    const settings = new SettingsStore(db as any);
    await settings.load();
    expect(settings.value.blockedDomains).toEqual([]);
    expect(settings.value).not.toHaveProperty("manualDomains");
  } finally {
    await db.close();
  }
});

it("internal settings require the configured service token", async () => {
  const previous = process.env.BIKE_RESOLVER_TOKEN;
  process.env.BIKE_RESOLVER_TOKEN = "test-internal-token";
  const cache = new MemoryCache(),
    logger = pino({ level: "silent" });
  const app = buildApp(
    new Resolver(
      createAdapters(new ManufacturerHttpClient(logger)),
      cache,
      logger,
    ),
    cache,
  );
  try {
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/internal/settings")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/internal/settings",
          headers: { authorization: "Bearer wrong" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/internal/settings",
          headers: { authorization: "Bearer test-internal-token" },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BIKE_RESOLVER_TOKEN;
    else process.env.BIKE_RESOLVER_TOKEN = previous;
  }
});

it("settings reads are bounded before database access and recover after the window", async () => {
  const previous = process.env.BIKE_RESOLVER_TOKEN;
  process.env.BIKE_RESOLVER_TOKEN = "test-internal-token";
  const query = vi.fn(async () => ({ rows: [] }));
  const settings = new SettingsStore({ query } as any);
  const cache = new MemoryCache(),
    logger = pino({ level: "silent" });
  const app = buildApp(
    new Resolver(
      createAdapters(new ManufacturerHttpClient(logger)),
      cache,
      logger,
    ),
    cache,
    settings,
  );
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const headers = { authorization: "Bearer test-internal-token" };
  try {
    // Invalid credentials cannot consume the authenticated settings budget.
    for (let i = 0; i < 65; i++)
      expect((await app.inject("/internal/settings")).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    // One shared budget: changing the caller or spoofing proxy headers cannot bypass it.
    for (let i = 0; i < 60; i++) {
      const response = await app.inject({
        url: "/internal/settings",
        remoteAddress: `192.0.2.${i + 1}`,
        headers: { ...headers, "x-forwarded-for": `198.51.100.${i + 1}` },
      });
      expect(response.statusCode).toBe(200);
    }
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ url: "/internal/settings", headers }),
      ),
    );
    const limited = responses.filter((r) => r.statusCode === 429);
    expect(limited).toHaveLength(5);
    expect(limited[0].headers["retry-after"]).toBe("60");
    expect(
      (await app.inject({ method: "HEAD", url: "/internal/settings", headers }))
        .statusCode,
    ).toBe(429);
    expect(query).toHaveBeenCalledTimes(60);
    for (const url of ["/health", "/ready", "/v1/brands"])
      expect((await app.inject(url)).statusCode).toBe(200);
    clock.mockReturnValue(now + 60_001);
    expect(
      (await app.inject({ url: "/internal/settings", headers })).statusCode,
    ).toBe(200);
    expect(query).toHaveBeenCalledTimes(61);
  } finally {
    clock.mockRestore();
    await app.close();
    if (previous === undefined) delete process.env.BIKE_RESOLVER_TOKEN;
    else process.env.BIKE_RESOLVER_TOKEN = previous;
  }
});
