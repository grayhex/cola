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
const client = () =>
  new ManufacturerHttpClient(pino({ level: "silent" }), 0, 1000);
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

it('manual pages allow unlisted public shops and cross-domain redirects', async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:302,headers:{location:'https://cdn.shop.example/page'}}) as any).mockResolvedValueOnce(new Response('<h1>Shop</h1>') as any);
 const doc=await client().get('https://new.shop.example/bike',{blockedDomains:[]});
 expect(doc.url).toBe('https://cdn.shop.example/page');expect(fetch).toHaveBeenCalledTimes(2);
});
it('manual blacklist blocks root, subdomains and trailing-dot bypass before fetch',async()=>{
 for(const url of ['https://shop.example/','https://www.shop.example/','https://shop.example./']) await expect(client().get(url,{blockedDomains:['shop.example']})).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();
});
it('manual redirects cannot reach forbidden domains or private addresses',async()=>{
 for(const location of ['https://blocked.example/','http://169.254.169.254/latest/meta-data/','http://127.0.0.1/']){
 vi.mocked(fetch).mockClear();vi.mocked(fetch).mockResolvedValue(new Response('',{status:302,headers:{location}}) as any);
 await expect(client().get('https://shop.example/',{blockedDomains:['blocked.example']})).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
 }
});
it('manual domains with private DNS remain forbidden',async()=>{
 vi.mocked(lookup).mockResolvedValue([{address:'192.168.1.200',family:4}] as any);
 await expect(client().get('https://shop.example/',{blockedDomains:[]})).rejects.toThrow('Non-public');expect(fetch).not.toHaveBeenCalled();
});
