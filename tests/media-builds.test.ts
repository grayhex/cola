import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createMediaBuildQueue,
  MediaCacheBusyError,
} from "../lib/media-build-queue.ts";
import {
  cachedDerivative,
  mediaVariant,
  removeCacheFiles,
  purgeMediaVariants,
  revalidatedMedia,
  sweepMediaCache,
  mediaBusyResponse,
} from "../lib/media-cache.ts";
import sharp from "sharp";
const latch = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("twenty cold readers share one build; hits, directories and versions stay distinct", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-flight-"));
  const env = { NODE_ENV: "test" as const, MEDIA_CACHE_DIR: dir };
  let count = 0;
  const build = async () => {
    count++;
    return Buffer.from("image");
  };
  try {
    const readers = await Promise.all(
      Array.from({ length: 20 }, () =>
        cachedDerivative("v1-a.jpg", build, env),
      ),
    );
    assert.equal(count, 1);
    readers.forEach((bytes) => assert.deepEqual(bytes, readers[0]));
    await cachedDerivative("v1-a.jpg", build, env);
    assert.equal(count, 1);
    await cachedDerivative("v2-a.jpg", build, env);
    await cachedDerivative("v1-a.jpg", build, {
      ...env,
      MEDIA_CACHE_DIR: path.join(dir, "other"),
    });
    assert.equal(count, 3);
    const original = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "#abc" },
    })
      .png()
      .toBuffer();
    let reads = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        mediaVariant(
          "photo",
          320,
          async () => {
            reads++;
            return original;
          },
          env,
        ),
      ),
    );
    assert.equal(reads, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded FIFO generation and bounded same-key readers reject overload, then recover", async () => {
  const queue = createMediaBuildQueue(2, 3),
    gate = latch(),
    started = latch();
  let running = 0,
    maximum = 0,
    count = 0;
  const build = async () => {
    running++;
    maximum = Math.max(maximum, running);
    count++;
    if (count === 2) started.resolve();
    await gate.promise;
    running--;
    return Buffer.from("ok");
  };
  const accepted = Array.from({ length: 5 }, (_, i) =>
    queue.run(String(i), build),
  );
  await started.promise;
  await assert.rejects(queue.run("overflow", build), MediaCacheBusyError);
  const duplicates = Array.from({ length: 63 }, () => queue.run("0", build));
  await assert.rejects(queue.run("0", build), MediaCacheBusyError);
  gate.resolve();
  await Promise.all([...accepted, ...duplicates]);
  assert.equal(maximum, 2);
  assert.equal(count, 5);
  await queue.run("overflow", build);
  assert.equal(count, 6);
  const response = mediaBusyResponse(new MediaCacheBusyError())!;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "1");
});

test("failure frees its slot and key; purge during build rejects readers without resurrecting files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-flight-"));
  const env = { NODE_ENV: "test" as const, MEDIA_CACHE_DIR: dir };
  try {
    await assert.rejects(
      cachedDerivative(
        "broken.jpg",
        async () => {
          throw new Error("encode");
        },
        env,
      ),
      /encode/,
    );
    assert.equal(
      (
        await cachedDerivative(
          "broken.jpg",
          async () => Buffer.from("retry"),
          env,
        )
      ).toString(),
      "retry",
    );
    const gate = latch(),
      started = latch();
    const pending = cachedDerivative(
      "v1-photo-320.webp",
      async () => {
        started.resolve();
        await gate.promise;
        return Buffer.from("old");
      },
      env,
    );
    const rejected = assert.rejects(pending, /недоступно/);
    await started.promise;
    await purgeMediaVariants(["photo"], env);
    gate.resolve();
    await rejected;
    assert.deepEqual(await readdir(dir), ["broken.jpg"]);
    await removeCacheFiles(["broken.jpg"], env);
    assert.deepEqual(await readdir(dir), []);
    await assert.rejects(
      mediaVariant(
        "missing",
        320,
        async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        env,
      ),
      { code: "ENOENT" },
    );
    assert.deepEqual(await readdir(dir), []);
    // Failed atomic rename must clean its temporary file and still deliver.
    await mkdir(path.join(dir, "blocked.jpg"));
    const bytes = await cachedDerivative(
      "blocked.jpg",
      async () => Buffer.from("fallback"),
      env,
    );
    assert.equal(bytes.toString(), "fallback");
    assert.ok((await readdir(dir)).every((name) => !name.endsWith(".tmp")));
    // Filesystem capacity/read-only failures use the same write-failure path.
    await writeFile(path.join(dir, "not-dir"), "x");
    assert.equal(
      (
        await cachedDerivative("x.jpg", async () => Buffer.from("fallback"), {
          ...env,
          MEDIA_CACHE_DIR: path.join(dir, "not-dir"),
        })
      ).toString(),
      "fallback",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every waiting request rechecks its own ACL, including revocation during generation", async () => {
  const queue = createMediaBuildQueue(),
    gate = latch(),
    started = latch();
  let permitted = true,
    builds = 0;
  const read = () =>
    queue.run("private", async () => {
      builds++;
      started.resolve();
      await gate.promise;
      return Buffer.from("private");
    });
  const owner = revalidatedMedia(read, async () => {});
  const viewer = revalidatedMedia(read, async () => {
    if (!permitted) throw new Error("revoked");
  });
  const denied = assert.rejects(viewer, /revoked/);
  await started.promise;
  permitted = false;
  gate.resolve();
  assert.equal((await owner).toString(), "private");
  await denied;
  assert.equal(builds, 1);
});

test("overlapping sweeps share one maintenance promise", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-sweep-"));
  try {
    const env = { NODE_ENV: "test" as const, MEDIA_CACHE_DIR: dir };
    const first = sweepMediaCache(env),
      second = sweepMediaCache(env);
    assert.equal(first, second);
    assert.equal(await first, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
