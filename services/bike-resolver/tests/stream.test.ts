import { it, expect, vi } from "vitest";
import pino from "pino";
import { buildApp } from "../src/app.js";
import { MemoryCache } from "../src/cache.js";
import { Resolver } from "../src/resolver.js";
import { parseDocument } from "../src/extract.js";
import { SettingsStore } from "../src/settings.js";
import type { BikeManufacturerAdapter } from "../src/domain.js";
import { resolutionContext, abortable } from "../src/context.js";
const query = { brand: "Giant", model: "Test", trim: null, year: 2026 };
const document = {
  url: "https://www.giant-bicycles.com/test",
  hash: "x",
  fetchedAt: "2026-09-19T00:00:00Z",
  body: "<h1>Giant Test 2026</h1><dl><dt>Frame</dt><dd>Alloy</dd><dt>Fork</dt><dd>Fox</dd><dt>Chain</dt><dd>Shimano</dd></dl>",
};
function setup() {
  const adapter: BikeManufacturerAdapter = {
    id: "giant",
    brand: "Giant",
    aliases: [],
    allowedDomains: ["www.giant-bicycles.com"],
    adapterVersion: 1,
    discover: vi.fn(async () => [
      {
        brand: "Giant",
        canonicalName: "Giant Test 2026",
        year: 2026,
        url: document.url,
      },
    ]),
    fetch: vi.fn(async () => document),
    parse: async () => parseDocument(document),
  };
  const cache = new MemoryCache(),
    settings = new SettingsStore(),
    app = buildApp(
      new Resolver([adapter], cache, pino({ level: "silent" })),
      cache,
      settings,
      { get: async () => document } as any,
    );
  return { app, adapter };
}
it("client disconnect aborts server work", async () => {
  const { app, adapter } = setup();
  let cancelled = false;
  adapter.discover = async () => {
    const signal = resolutionContext.getStore()!.signal;
    signal.addEventListener(
      "abort",
      () => {
        cancelled = true;
      },
      { once: true },
    );
    return await abortable(new Promise(() => {}), signal);
  };
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  try {
    const response = await fetch(address + "/v1/resolve/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    await vi.waitFor(() => expect(cancelled).toBe(true));
  } finally {
    // Node 22's fetch pool may open an idle replacement socket after abort.
    // Assert server cancellation first, then close only this test server's sockets.
    app.server.closeAllConnections();
    await app.close();
  }
});
it("streams ordered trace, partial result, then an honest cache hit without discovery", async () => {
  const { app, adapter } = setup();
  try {
    const first = await app.inject({
      method: "POST",
      url: "/v1/resolve/stream",
      payload: query,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("application/x-ndjson");
    const lines = first.body
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(lines[0].event).toBe("resolve_started");
    expect(lines.at(-1).result.quality.level).toBe("partial");
    const events = lines.filter((v) => v.type === "event").map((v) => v.event);
    expect(events.indexOf("cache_checked")).toBeLessThan(
      events.indexOf("discovery_started"),
    );
    expect(events).toContain("components_recognized");
    expect(events.at(-1)).toBe("completed");
    const second = await app.inject({
      method: "POST",
      url: "/v1/resolve/stream",
      payload: query,
    });
    const cached = second.body
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(cached.at(-1).result.cached).toBe(true);
    expect(cached.map((v) => v.event)).toContain("cache_hit");
    expect(cached.map((v) => v.event)).not.toContain("discovery_started");
    expect(adapter.fetch).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
it("supports explicit URL in stream and preserves ordinary JSON endpoint", async () => {
  const { app, adapter } = setup();
  try {
    const stream = await app.inject({
      method: "POST",
      url: "/v1/resolve/stream",
      payload: { ...query, sourceUrl: document.url },
    });
    expect(
      JSON.parse(stream.body.trim().split("\n").at(-1)!).result.status,
    ).toBe("resolved");
    expect(adapter.discover).not.toHaveBeenCalled();
    const normal = await app.inject({
      method: "POST",
      url: "/v1/resolve",
      payload: query,
    });
    expect(normal.json().status).toBe("resolved");
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/resolve/stream",
      payload: { ...query, privateSecret: "no" },
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
it("uses supplied manual source after official failure through the planner", async () => {
  const { app, adapter } = setup();
  (adapter.discover as any).mockResolvedValue([]);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/resolve",
      payload: { ...query, sourceUrl: document.url },
    });
    expect(response.json().status).toBe("resolved");
    expect(response.json().manualSelection).toBe(true);
  } finally {
    await app.close();
  }
});
