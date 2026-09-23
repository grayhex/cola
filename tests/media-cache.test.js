import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  immutableMediaCache,
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
  privateMediaCache,
  purgeMediaVariants,
  sweepMediaCache,
} from "../lib/media-cache.js";

test("only the closed set of widths is accepted", () => {
  assert.equal(mediaWidth(null), null);
  assert.equal(mediaWidth(""), null);
  for (const width of ["160", "320", "640", "1280"])
    assert.equal(mediaWidth(width), Number(width));
  for (const bad of ["100", "0640", "640.0", "2400", "abc", "-1", "1e3"])
    assert.equal(mediaWidth(bad), undefined, bad);
});

test("ETags identify ID and size; revalidation matches strong and weak forms", () => {
  const etag = mediaEtag("photo-1", 640);
  assert.equal(etag, '"v1-photo-1-640"');
  assert.notEqual(etag, mediaEtag("photo-1"));
  const request = (value) =>
    new Request("http://app.test/", { headers: { "If-None-Match": value } });
  assert.equal(notModified(request(etag), etag), true);
  assert.equal(notModified(request('"other", W/' + etag), etag), true);
  assert.equal(notModified(request('"other"'), etag), false);
  assert.equal(notModified(new Request("http://app.test/"), etag), false);
});

test("responses revalidate private media and keep site graphics immutable", async () => {
  const ok = mediaResponse(Buffer.from("x"), '"e"');
  assert.equal(ok.headers.get("Cache-Control"), "private, no-cache");
  assert.equal(ok.headers.get("ETag"), '"e"');
  assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(privateMediaCache, "private, no-cache");
  const asset = mediaResponse(Buffer.from("x"), '"a"', {
    cache: immutableMediaCache,
    contentType: "image/svg+xml",
    headers: { "Content-Security-Policy": "sandbox" },
  });
  assert.equal(asset.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(asset.headers.get("Content-Security-Policy"), "sandbox");
  const revalidated = notModifiedResponse('"e"', { headers: { Vary: "Cookie" } });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("Vary"), "Cookie");
  assert.equal(await revalidated.text(), "");
});

test("variants are generated once, cached, bounded and purged", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-media-"));
  const env = { MEDIA_CACHE_DIR: dir };
  try {
    const original = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#7a9" },
    })
      .webp()
      .toBuffer();
    let reads = 0;
    const readOriginal = async () => {
      reads++;
      return original;
    };
    const first = await mediaVariant("photo-a", 640, readOriginal, env);
    const meta = await sharp(first).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 640);
    const again = await mediaVariant("photo-a", 640, readOriginal, env);
    assert.equal(reads, 1, "a cached variant does not decode the original again");
    assert.deepEqual(again, first);
    await mediaVariant("photo-a", 160, readOriginal, env);
    await assert.rejects(mediaVariant("photo-a", 500, readOriginal, env), /INVALID_MEDIA_WIDTH/);
    assert.deepEqual((await readdir(dir)).sort(), ["v1-photo-a-160.webp", "v1-photo-a-640.webp"]);

    await purgeMediaVariants(["photo-a"], env);
    assert.deepEqual(await readdir(dir), []);

    // Oldest files go first once the cache is above its limit.
    for (let i = 0; i < 4; i++) {
      const file = path.join(dir, `v1-old-${i}-640.webp`);
      await writeFile(file, Buffer.alloc(400 * 1024));
      await utimes(file, 1000 + i, 1000 + i);
    }
    // 1.6 MB against a 1 MB limit: remove the oldest until at most 80% remains.
    const removed = await sweepMediaCache({ ...env, MEDIA_CACHE_MAX_MB: "1" });
    assert.equal(removed, 2);
    assert.deepEqual((await readdir(dir)).sort(), ["v1-old-2-640.webp", "v1-old-3-640.webp"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unwritable cache still serves the generated variant", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-media-"));
  const blocked = path.join(dir, "file-not-dir");
  await writeFile(blocked, "x");
  try {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#999" },
    })
      .png()
      .toBuffer();
    const bytes = await mediaVariant(
      "photo-b",
      320,
      async () => original,
      { MEDIA_CACHE_DIR: path.join(blocked, "cache") },
    );
    assert.equal((await sharp(bytes).metadata()).width, 320);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
