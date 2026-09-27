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
