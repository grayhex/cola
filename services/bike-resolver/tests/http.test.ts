import { it, expect, vi, beforeEach } from "vitest";
import pino from "pino";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("undici", async () => {
  const actual = await vi.importActual<any>("undici");
  return { ...actual, fetch: vi.fn() };
});
import { lookup } from "node:dns/promises";
import { fetch } from "undici";
import { ManufacturerHttpClient } from "../src/http.js";
import { withResolution } from "../src/context.js";
const client = () =>
  new ManufacturerHttpClient(pino({ level: "silent" }), 0, 1000);
it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"])(
  "preserves network error classification for %s",
  async (code) => {
    vi.mocked(lookup).mockRejectedValueOnce(
      Object.assign(new Error("fixture"), { code }),
    );
    const http = new ManufacturerHttpClient(
      pino({ level: "silent" }),
      0,
      1000,
      undefined,
      { attempts: 1 },
    );
    await expect(
      http.get("https://cube.eu/", ["cube.eu"]),
    ).rejects.toMatchObject({
      reason: code === "ECONNREFUSED" ? "connection_failed" : "dns_failed",
      retryable: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("Commons policy honours Retry-After without retries, identifies the client and forbids redirect downgrade", async () => {
  const backoff = vi.fn();
  const http = new ManufacturerHttpClient(
    pino({ level: "silent" }),
    0,
    1000,
    undefined,
    {
      attempts: 1,
      userAgent: "ColaBike/1.0 (https://colabike.ru)",
      onBackoff: backoff,
      httpsOnly: true,
    },
  );
  vi.mocked(fetch).mockResolvedValue(
    new Response("", { status: 429, headers: { "retry-after": "60" } }) as any,
  );
  await expect(
    http.get("https://commons.wikimedia.org/", ["commons.wikimedia.org"]),
  ).rejects.toThrow("429");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(backoff).toHaveBeenCalledWith(60000);
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
    "User-Agent": "ColaBike/1.0 (https://colabike.ru)",
  });
  vi.mocked(fetch).mockResolvedValue(
    new Response("", {
      status: 302,
      headers: { location: "http://commons.wikimedia.org/" },
    }) as any,
  );
  await expect(
    http.get("https://commons.wikimedia.org/", ["commons.wikimedia.org"]),
  ).rejects.toThrow("HTTPS required");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("request-scoped cache fetches a tracking-equivalent document once", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("<h1>Bike</h1>") as any);
  const http = client();
  await withResolution(new AbortController().signal, undefined, async () => {
    await http.get("https://cube.eu/?a=1&utm_source=x", ["cube.eu"]);
    await http.get("https://cube.eu/?a=1", ["cube.eu"]);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("propagates cancellation to the active fetch without retrying", async () => {
  const controller = new AbortController();
  vi.mocked(fetch).mockImplementation(
    async (_url, options: any) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("abort")),
          { once: true },
        );
        controller.abort();
      }),
  );
  await expect(
    withResolution(controller.signal, undefined, () =>
      client().get("https://cube.eu/", ["cube.eu"]),
    ),
  ).rejects.toBeDefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reports upstream timeout and does not leave retries running", async () => {
  vi.mocked(fetch).mockImplementation(
    async (_url, options: any) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        ),
      ),
  );
  const http = new ManufacturerHttpClient(pino({ level: "silent" }), 0, 20);
  await expect(http.get("https://cube.eu/", ["cube.eu"])).rejects.toMatchObject(
    { reason: "timeout" },
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as any);
});
it("blocks private DNS before making a request", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "127.0.0.1", family: 4 },
  ] as any);
  await expect(client().get("https://cube.eu/", ["cube.eu"])).rejects.toThrow(
    "Non-public",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("checks each redirect and rejects localhost before the second request", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response("", {
      status: 302,
      headers: { location: "http://127.0.0.1/" },
    }) as any,
  );
  await expect(client().get("https://cube.eu/", ["cube.eu"])).rejects.toThrow(
    "allowlist",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("checks DNS again on an allowed official-host redirect", async () => {
  vi.mocked(lookup)
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as any)
    .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as any);
  vi.mocked(fetch).mockResolvedValue(
    new Response("", {
      status: 302,
      headers: { location: "https://www.cube.eu/" },
    }) as any,
  );
  await expect(
    client().get("https://cube.eu/", ["cube.eu", "www.cube.eu"]),
  ).rejects.toThrow("Non-public");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not retry forbidden responses or bypass challenges", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("", { status: 403 }) as any);
  await expect(client().get("https://cube.eu/", ["cube.eu"])).rejects.toThrow(
    "403",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValue(
    new Response('<script src="/_Incapsula_Resource"></script>') as any,
  );
  await expect(client().get("https://cube.eu/", ["cube.eu"])).rejects.toThrow(
    "challenge",
  );
});
it("enforces redirect limit", async () => {
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Response("", {
        status: 302,
        headers: { location: "https://cube.eu/loop" },
      }) as any,
  );
  await expect(client().get("https://cube.eu/", ["cube.eu"])).rejects.toThrow(
    "Redirect limit",
  );
  expect(fetch).toHaveBeenCalledTimes(5);
});
it("per-host queue prevents overlapping requests", async () => {
  let active = 0,
    max = 0;
  vi.mocked(fetch).mockImplementation(async () => {
    active++;
    max = Math.max(active, max);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response("<html>ok</html>") as any;
  });
  const http = client();
  await Promise.all([
    http.get("https://cube.eu/one", ["cube.eu"]),
    http.get("https://cube.eu/two", ["cube.eu"]),
  ]);
  expect(max).toBe(1);
});
it("cancelling a queued request preserves the active host queue", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.mocked(fetch)
    .mockImplementationOnce(async () => {
      await gate;
      return new Response("first") as any;
    })
    .mockResolvedValue(new Response("third") as any);
  const http = client(),
    first = http.get("https://cube.eu/first", ["cube.eu"]);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const cancel = new AbortController();
  const second = withResolution(cancel.signal, undefined, () =>
    http.get("https://cube.eu/second", ["cube.eu"]),
  );
  cancel.abort();
  await expect(second).rejects.toBeDefined();
  const third = http.get("https://cube.eu/third", ["cube.eu"]);
  await new Promise((r) => setTimeout(r, 20));
  expect(fetch).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, third]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("manual pages allow unlisted public shops and cross-domain redirects", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "https://cdn.shop.example/page" },
      }) as any,
    )
    .mockResolvedValueOnce(new Response("<h1>Shop</h1>") as any);
  const doc = await client().get("https://new.shop.example/bike", {
    blockedDomains: [],
  });
  expect(doc.url).toBe("https://cdn.shop.example/page");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("manual blacklist blocks root, subdomains and trailing-dot bypass before fetch", async () => {
  for (const url of [
    "https://shop.example/",
    "https://www.shop.example/",
    "https://shop.example./",
  ])
    await expect(
      client().get(url, { blockedDomains: ["shop.example"] }),
    ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("manual redirects cannot reach forbidden domains or private addresses", async () => {
  for (const location of [
    "https://blocked.example/",
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/",
  ]) {
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValue(
      new Response("", { status: 302, headers: { location } }) as any,
    );
    await expect(
      client().get("https://shop.example/", {
        blockedDomains: ["blocked.example"],
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it("manual domains with private DNS remain forbidden", async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "192.168.1.200", family: 4 },
  ] as any);
  await expect(
    client().get("https://shop.example/", { blockedDomains: [] }),
  ).rejects.toThrow("Non-public");
  expect(fetch).not.toHaveBeenCalled();
});

it("allows bounded large XML catalogues without raising product or image limits", async () => {
  const body = "x".repeat(9 * 1024 * 1024);
  const response = (type: string) =>
    new Response(body, { headers: { "content-type": type } }) as any;
  vi.mocked(fetch).mockResolvedValueOnce(response("application/xml"));
  expect(
    (await client().get("https://cube.eu/sitemap.xml", ["cube.eu"])).body
      .length,
  ).toBe(body.length);
  for (const [url, type] of [
    ["https://cube.eu/product", "application/xml"],
    ["https://cube.eu/sitemap.xml", "text/html"],
    ["https://cube.eu/photo.jpg", "image/jpeg"],
  ]) {
    vi.mocked(fetch).mockResolvedValueOnce(response(type));
    await expect(client().get(url, ["cube.eu"])).rejects.toThrow("8 MiB");
  }
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("x".repeat(25 * 1024 * 1024), {
      headers: { "content-type": "text/xml" },
    }) as any,
  );
  await expect(
    client().get("https://cube.eu/sitemap.xml", ["cube.eu"]),
  ).rejects.toThrow("24 MiB");
});

it("accepts octet-stream XML only from the known manufacturer catalogue paths", async () => {
  const response = () =>
    new Response("<urlset>" + " ".repeat(9 * 1024 * 1024) + "</urlset>", {
      headers: { "content-type": "application/octet-stream" },
    }) as any;
  for (const url of [
    "https://media.specialized.com/sitemaps/US-Product-en-USD.xml",
    "https://wcpcdn.blob.core.windows.net/hybris/sitemap/Trek-en-US-01.xml",
  ]) {
    vi.mocked(fetch).mockResolvedValueOnce(response());
    await expect(
      client().get(url, [new URL(url).hostname]),
    ).resolves.toBeDefined();
  }
  for (const url of [
    "https://upload.wikimedia.org/image.xml",
    "https://media.specialized.com/photos/large.xml",
    "https://media.specialized.com/sitemaps/photo.jpg",
  ]) {
    vi.mocked(fetch).mockResolvedValueOnce(response());
    await expect(client().get(url, [new URL(url).hostname])).rejects.toThrow(
      "8 MiB",
    );
  }
});
