import { expect, it, vi } from "vitest";
import {
  ComponentPhotoSearch,
  commonsResults,
  commonsQuery,
  commonsUrl,
} from "../src/component-photos.js";
import { SettingsStore } from "../src/settings.js";
import { ManufacturerHttpClient } from "../src/http.js";
import { commonsFixture } from "./fixtures/component-photos.js";

it("skips malformed Commons pages and images without trusting external JSON", () => {
  const valid = commonsFixture().query.pages[1];
  expect(
    commonsResults({
      query: {
        pages: { valid, empty: null, invalid: { imageinfo: [false, null] } },
      },
    }),
  ).toHaveLength(1);
  for (const field of ["size", "width", "height", "url", "descriptionurl"])
    expect(
      commonsResults({
        query: {
          pages: [
            { ...valid, imageinfo: [{ ...valid.imageinfo[0], [field]: {} }] },
          ],
        },
      }),
    ).toEqual([]);
  for (const payload of [null, false, "invalid", []])
    expect(() => commonsResults(payload)).toThrow("Commons unavailable");
});

it("Commons returns bounded plain-text attribution, safe URLs and supported licenses only", () => {
  const data = commonsFixture();
  expect(commonsResults(data)[0]).toMatchObject({
    creator: "Fixture author",
    credit: "Own work",
    license: "CC BY-SA 4.0",
  });
  for (const patch of [
    { url: "http://127.0.0.1/x" },
    { url: "https://upload.wikimedia.org.evil.test/x" },
    { descriptionurl: "javascript:alert(1)" },
    { mime: "image/svg+xml" },
    { width: 500, height: 399 },
    { width: 10000, height: 10000 },
    { size: 9 * 1024 * 1024 },
    { width: undefined },
    { extmetadata: {} },
  ]) {
    const changed = structuredClone(data);
    Object.assign(changed.query.pages[1].imageinfo[0], patch);
    expect(commonsResults(changed)).toHaveLength(1);
  }
  data.query.pages[1].imageinfo[0].extmetadata.LicenseUrl.value =
    "https://creativecommons.org/licenses/by-nc/4.0/";
  expect(commonsResults(data)).toHaveLength(1);
  expect(commonsResults({})).toEqual([]);
  expect(() => commonsResults({ error: { code: "maxlag" } })).toThrow();
  for (const url of [
    "http://upload.wikimedia.org/x",
    "https://user:pass@upload.wikimedia.org/x",
    "https://169.254.169.254/x",
    "file:///etc/passwd",
    "https://upload.wikimedia.org:8443/x",
  ])
    expect(() => commonsUrl(url)).toThrow();
});
it("search uses category/brand/name, caches results, issues expiring tokens and honours disable", async () => {
  const settings = new SettingsStore(),
    get = vi.fn(async () => ({ body: JSON.stringify(commonsFixture()) }));
  const getBytes = vi.fn(async () => ({
    bytes: Buffer.from("fixture"),
    contentType: "image/svg+xml",
  }));
  const provider = new ComponentPhotoSearch(settings, {
    get,
    getBytes,
  } as unknown as ManufacturerHttpClient);
  const query = { category: "Седло", brand: "Brooks", name: "C17" };
  expect(commonsQuery(query)).toBe('"saddle" "Brooks" "C17" filetype:bitmap');
  const first = await provider.search(query),
    second = await provider.search(query);
  expect(first.photos).toHaveLength(2);
  expect(get).toHaveBeenCalledTimes(1);
  expect(first.photos[0].id).not.toBe(second.photos[0].id);
  await expect(provider.photo("unknown")).rejects.toThrow("expired");
  await expect(provider.photo(first.photos[0].id)).rejects.toThrow(
    "Unsupported",
  );
  getBytes.mockResolvedValue({
    bytes: Buffer.from("fixture"),
    contentType: "image/png",
  });
  expect((await provider.photo(first.photos[0].id)).source).toEqual(
    first.photos[0].source,
  );
  const now = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() + 16 * 60 * 1000);
  await expect(provider.photo(first.photos[0].id)).rejects.toThrow("expired");
  now.mockRestore();
  settings.value.photoSearch = false;
  await expect(provider.search(query)).rejects.toThrow("unavailable");
  await expect(provider.photo(second.photos[0].id)).rejects.toThrow(
    "unavailable",
  );
});

it("retries an empty or filtered search without category, but keeps brand and model", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({ body: JSON.stringify({ query: { pages: {} } }) })
    .mockResolvedValueOnce({ body: JSON.stringify(commonsFixture()) });
  const provider = new ComponentPhotoSearch(new SettingsStore(), {
    get,
  } as unknown as ManufacturerHttpClient);
  const input = { category: "Седло", brand: "Brooks", name: "C17" };
  expect((await provider.search(input)).photos).toHaveLength(2);
  expect(get).toHaveBeenCalledTimes(2);
  expect(new URL(get.mock.calls[1][0]).searchParams.get("gsrsearch")).toBe(
    '"Brooks" "C17" filetype:bitmap',
  );
  await provider.search(input);
  expect(get).toHaveBeenCalledTimes(2);
});
it("bounds fallback queries, caches misses and does not retry an API error", async () => {
  const get = vi.fn(async () => ({ body: JSON.stringify({}) }));
  const provider = new ComponentPhotoSearch(new SettingsStore(), {
    get,
  } as unknown as ManufacturerHttpClient);
  const input = { category: "Седло", brand: "Brooks", name: "Cambium C17" };
  await provider.search(input);
  await provider.search(input);
  expect(get).toHaveBeenCalledTimes(3);
  for (const [url] of get.mock.calls as unknown as [string][]) {
    const query = new URL(url).searchParams.get("gsrsearch")!;
    expect(query).toContain('"Brooks"');
    expect(query).toContain("C17");
  }
  const failing = vi.fn(async () => ({
    body: JSON.stringify({ error: { code: "maxlag" } }),
  }));
  await expect(
    new ComponentPhotoSearch(new SettingsStore(), {
      get: failing,
    } as unknown as ManufacturerHttpClient).search(input),
  ).rejects.toThrow();
  expect(failing).toHaveBeenCalledTimes(1);
});
it("uses a bounded Commons thumbnail for a large original and validates that thumbnail", () => {
  const data = commonsFixture();
  const image = data.query.pages[1].imageinfo[0] as any;
  Object.assign(image, {
    size: 20 * 1024 * 1024,
    width: 9000,
    height: 6000,
    thumburl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/1600px-Test.jpg",
    thumbwidth: 1600,
    thumbheight: 1067,
    thumbmime: "image/jpeg",
  });
  expect(commonsResults(data)[0].imageUrl).toBe(image.thumburl);
  image.thumburl = "https://evil.test/image.jpg";
  expect(commonsResults(data)).toHaveLength(1);
  image.thumburl = image.url;
  image.thumbwidth = 30000;
  image.thumbheight = 30000;
  expect(commonsResults(data)).toHaveLength(1);
});
