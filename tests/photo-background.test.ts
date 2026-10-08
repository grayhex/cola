import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { changePhoto, removeBike } from "../lib/bike-service.ts";
import { checkPhotoQuota, limits, QuotaError } from "../lib/limits.ts";
import {
  PhotoBackgroundError,
  applyPreview,
  cutOut,
  discardPreview,
  previewOfCandidate,
  readPreview,
  restoreOriginal,
  settlePreviews,
  storePreview,
  type Cutout,
} from "../lib/photo-background.ts";
import { encodeWithAlpha } from "../lib/images.ts";
import { present } from "./support/assertions.ts";
import { bikeRow, photoRow } from "./support/bikes.ts";
import { testDatabase, type TestDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";

// #370: the new version of a photo without its backdrop. The picture is made
// here from pixels (the server looks at bytes, not at names); the database is
// the real schema; the files lie in a disposable directory, and so does the
// media cache, where the previews live.
const width = 640,
  height = 480;
async function studioPhoto(
  background: (x: number, y: number) => [number, number, number] = () => [
    255, 255, 255,
  ],
) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = (x - 320) ** 2 + (y - 240) ** 2 <= 120 ** 2;
      const [r, g, b] = inside ? [190, 30, 30] : background(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .webp({ quality: 90 })
    .toBuffer();
}
const alphaOf = async (bytes: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
};

interface World {
  db: TestDatabase;
  uploads: string;
  cache: string;
  owner: string;
  stranger: string;
  bike: string;
  close(): Promise<void>;
}
async function world(): Promise<World> {
  const root = await mkdtemp(path.join(os.tmpdir(), "photo-background-"));
  const uploads = path.join(root, "uploads"),
    cache = path.join(root, "cache");
  process.env.MEDIA_CACHE_DIR = cache;
  const db = await testDatabase();
  const owner = (await userRow(db)).id,
    stranger = (await userRow(db)).id;
  const bike = (await bikeRow(db, owner)).id;
  await mkdir(uploads, { recursive: true });
  return {
    db,
    uploads,
    cache,
    owner,
    stranger,
    bike,
    async close() {
      await db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
// A stored photo as the upload makes it: a row and its file.
async function storePhoto(w: World, bytes: Buffer, cover = false) {
  const id = randomUUID();
  await writeFile(path.join(w.uploads, id + ".webp"), bytes);
  return photoRow(w.db, w.bike, {
    id,
    is_cover: cover,
    size_bytes: String(bytes.length),
  });
}
const refused = (status: number, reason: string) => (e: unknown) =>
  e instanceof PhotoBackgroundError &&
  e.status === status &&
  e.reason === reason;
async function tryOn(w: World, photoId: string, bytes: Buffer) {
  const result = await cutOut(bytes, w.owner);
  return storePreview(w.db, w.owner, { kind: "photo", photoId }, result);
}

test("a try makes WebP with transparency; what cannot be cleared is refused with a reason and a status", async () => {
  const photo = await studioPhoto();
  const result = await cutOut(photo, "owner");
  assert.equal(result.width, width);
  assert.equal(result.height, height);
  assert.ok(result.removed > 0.6 && result.removed < 0.9, `${result.removed}`);
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.hasAlpha, true);
  assert.equal(await alphaOf(result.bytes, 5, 5), 0, "the backdrop is clear");
  assert.equal(await alphaOf(result.bytes, 320, 240), 255, "the bike stays");

  // A plain wall of one colour: nothing is left of the bike.
  await assert.rejects(
    cutOut(await studioPhoto(() => [190, 30, 30]), "owner"),
    refused(422, "everything_removed"),
  );
  // Not a backdrop at all.
  await assert.rejects(
    cutOut(
      await studioPhoto((x) => [
        (x * 255) / width,
        90,
        200 - (x * 150) / width,
      ]),
      "owner",
    ),
    refused(422, "not_uniform"),
  );
  // Already clear: nothing to take.
  const clear = await encodeWithAlpha({
    data: new Uint8Array(width * height * 4),
    width,
    height,
  });
  await assert.rejects(
    cutOut(clear, "owner"),
    refused(422, "already_transparent"),
  );
  // Not a picture, and not a format the site decodes.
  await assert.rejects(
    cutOut(Buffer.from("not a picture"), "owner"),
    refused(422, "unreadable"),
  );
  await assert.rejects(
    cutOut(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "owner"),
    refused(422, "unreadable"),
  );
});

test("time and the client's patience are limited: a result that is late or unwanted never leaves", async () => {
  const photo = await studioPhoto();
  await assert.rejects(
    cutOut(photo, "owner", { timeoutMs: -1 }),
    refused(504, "timeout"),
  );
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(
    cutOut(photo, "owner", { signal: gone.signal }),
    refused(408, "aborted"),
  );
  // A try that failed gives its place back: the same person may try again.
  assert.ok((await cutOut(photo, "owner")).bytes.length > 0);
});

test("one try at a time per person, and only a few at once: the rest are told to come back", async () => {
  const photo = await studioPhoto();
  const first = cutOut(photo, "a");
  await assert.rejects(cutOut(photo, "a"), (e) => {
    return (
      e instanceof PhotoBackgroundError &&
      e.status === 429 &&
      e.reason === "busy" &&
      !!e.retryAfter
    );
  });
  const second = cutOut(photo, "b");
  await assert.rejects(cutOut(photo, "c"), refused(429, "busy"));
  await Promise.all([first, second]);
  // Everybody has left: the places are free again.
  assert.ok((await cutOut(photo, "c")).bytes.length > 0);
});

test("a preview is the owner's: nobody else reads it, it expires, and a person keeps a handful", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const photo = await storePhoto(w, bytes, true);
    const preview = await tryOn(w, photo.id, bytes);
    assert.equal(preview.url, `/api/bikes/previews/${preview.id}`);
    assert.equal(preview.beforeUrl, null);
    assert.ok(present(await readPreview(w.db, w.owner, preview.id)).length > 0);
    assert.equal(await readPreview(w.db, w.stranger, preview.id), null);
    assert.equal(await readPreview(w.db, w.owner, preview.id, "before"), null);
    assert.equal(await readPreview(w.db, w.owner, randomUUID()), null);

    await w.db.query(
      "UPDATE photo_previews SET expires_at=now() - interval '1 second' WHERE id=$1",
      [preview.id],
    );
    assert.equal(await readPreview(w.db, w.owner, preview.id), null, "expired");
    await assert.rejects(
      applyPreview(w.db.transaction, {
        owner: w.owner,
        bikeId: w.bike,
        photoId: photo.id,
        previewId: preview.id,
        directory: w.uploads,
      }),
      refused(404, "gone"),
    );

    // The next try sweeps what expired, and the oldest beyond six go too.
    const made: string[] = [];
    for (let i = 0; i < 8; i++) made.push((await tryOn(w, photo.id, bytes)).id);
    const rows = await w.db.query<{ id: string }>(
      "SELECT id FROM photo_previews WHERE owner_id=$1 ORDER BY created_at",
      [w.owner],
    );
    assert.deepEqual(
      rows.rows.map((r) => r.id),
      made.slice(-6),
    );
    const files = await readdir(w.cache);
    assert.equal(
      files.filter((f) => f.startsWith("preview-")).length,
      6,
      "the files of the swept previews are gone with their rows",
    );

    await discardPreview(w.db, w.stranger, made[7]);
    assert.ok(
      await readPreview(w.db, w.owner, made[7]),
      "not the stranger's to drop",
    );
    await discardPreview(w.db, w.owner, made[7]);
    assert.equal(await readPreview(w.db, w.owner, made[7]), null);
    assert.equal(
      existsSync(path.join(w.cache, `preview-${made[7]}.webp`)),
      false,
    );
  } finally {
    await w.close();
  }
});

test("applying: a new photo ID, the original kept, the place, the cover and the size accounted; repeating answers the same", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const cover = await storePhoto(w, bytes, true);
    const other = await storePhoto(w, await studioPhoto(() => [250, 250, 250]));
    const preview = await tryOn(w, cover.id, bytes);
    const preview2 = await tryOn(w, cover.id, bytes);
    const given = {
      owner: w.owner,
      bikeId: w.bike,
      photoId: cover.id,
      directory: w.uploads,
    };

    const applied = await applyPreview(w.db.transaction, {
      ...given,
      previewId: preview.id,
    });
    assert.equal(applied.repeated, false);
    assert.equal(applied.previousId, cover.id);
    assert.notEqual(
      applied.id,
      cover.id,
      "a new media ID, not a rewritten file",
    );

    const { rows } = await w.db.query<{
      id: string;
      filename: string;
      is_cover: boolean;
      created_at: Date;
      size_bytes: string;
      original_filename: string;
      original_size_bytes: string;
    }>("SELECT * FROM photos WHERE bike_id=$1 ORDER BY created_at,id", [
      w.bike,
    ]);
    assert.equal(rows.length, 2, "no second photo in the gallery");
    const now = present(rows.find((r) => r.id === applied.id));
    assert.equal(now.filename, applied.id + ".webp");
    assert.equal(now.is_cover, true);
    assert.deepEqual(
      now.created_at,
      cover.created_at,
      "the place in the order",
    );
    assert.equal(now.original_filename, cover.filename);
    assert.equal(Number(now.original_size_bytes), bytes.length);
    const processed = await readFile(path.join(w.uploads, now.filename));
    assert.equal(
      Number(now.size_bytes),
      processed.length + bytes.length,
      "both files are the owner's disk",
    );
    assert.equal(
      (await readFile(path.join(w.uploads, cover.filename))).equals(bytes),
      true,
      "the original is untouched",
    );
    assert.equal(await alphaOf(processed, 5, 5), 0);
    assert.equal(rows.find((r) => r.id === other.id)?.original_filename, null);

    // The preview is spent: its picture is gone, and asking again is not a new try.
    assert.equal(await readPreview(w.db, w.owner, preview.id), null);
    const again = await applyPreview(w.db.transaction, {
      ...given,
      previewId: preview.id,
    });
    assert.deepEqual(again, {
      id: applied.id,
      previousId: cover.id,
      repeated: true,
    });
    assert.equal(
      (await w.db.query("SELECT 1 FROM photos WHERE bike_id=$1", [w.bike]))
        .rowCount,
      2,
    );
    assert.equal(
      (await readdir(w.uploads)).length,
      3,
      "two originals and one new file: no duplicate was written",
    );

    // Another preview of the version that is gone never fits the photo that took its place.
    await assert.rejects(
      applyPreview(w.db.transaction, { ...given, previewId: preview2.id }),
      refused(409, "stale"),
    );
    // And a photo that already is a cut-out is not cleared again: it goes back first.
    await assert.rejects(
      applyPreview(w.db.transaction, {
        ...given,
        photoId: applied.id,
        previewId: preview2.id,
      }),
      refused(409, "stale"),
    );
  } finally {
    await w.close();
  }
});

test("a preview made for one photo is never applied to a changed, deleted or foreign photo", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const photo = await storePhoto(w, bytes, true);
    const preview = await tryOn(w, photo.id, bytes);
    const given = {
      bikeId: w.bike,
      photoId: photo.id,
      previewId: preview.id,
      directory: w.uploads,
    };

    // Not the owner of the preview.
    await assert.rejects(
      applyPreview(w.db.transaction, { ...given, owner: w.stranger }),
      refused(404, "gone"),
    );
    // The photo of the URL is not the photo the preview was made of.
    const decoy = await storePhoto(w, bytes);
    await assert.rejects(
      applyPreview(w.db.transaction, {
        ...given,
        owner: w.owner,
        photoId: decoy.id,
      }),
      refused(409, "stale"),
    );
    // Deleted while the preview waited.
    const removed = await changePhoto(
      w.db.transaction,
      w.bike,
      photo.id,
      "remove",
    );
    assert.deepEqual(removed, [photo.filename]);
    await assert.rejects(
      applyPreview(w.db.transaction, { ...given, owner: w.owner }),
      refused(409, "stale"),
    );
    assert.equal((await readdir(w.uploads)).includes(photo.id + ".webp"), true);
  } finally {
    await w.close();
  }
});

test("a lost room is refused without a trace: no file left, nothing changed", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const photo = await storePhoto(w, bytes, true);
    const preview = await tryOn(w, photo.id, bytes);
    await w.db.query("UPDATE photos SET size_bytes=$2 WHERE id=$1", [
      photo.id,
      String(limits.storageBytes),
    ]);
    await assert.rejects(
      applyPreview(w.db.transaction, {
        owner: w.owner,
        bikeId: w.bike,
        photoId: photo.id,
        previewId: preview.id,
        directory: w.uploads,
      }),
      QuotaError,
    );
    assert.deepEqual(await readdir(w.uploads), [photo.id + ".webp"]);
    const { rows } = await w.db.query<{
      id: string;
      original_filename: string | null;
    }>("SELECT id,original_filename FROM photos WHERE bike_id=$1", [w.bike]);
    assert.deepEqual(rows, [{ id: photo.id, original_filename: null }]);
    assert.ok(
      await readPreview(w.db, w.owner, preview.id),
      "the preview waits for room",
    );
  } finally {
    await w.close();
  }
});

test("a new version takes room but is not one more photo: a full bike can still clear a backdrop", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const photo = await storePhoto(w, bytes, true);
    const tight = { ...limits, photosPerBike: 1, photos: 1 };
    await assert.rejects(
      w.db.transaction((q) =>
        checkPhotoQuota(q, w.owner, w.bike, [100], tight),
      ),
      QuotaError,
    );
    await w.db.transaction((q) =>
      checkPhotoQuota(q, w.owner, w.bike, [100], tight, { replacing: true }),
    );
    // Bytes still count: no room, no new version.
    const cramped = { ...limits, storageBytes: bytes.length + 10 };
    await assert.rejects(
      w.db.transaction((q) =>
        checkPhotoQuota(q, w.owner, w.bike, [100], cramped, {
          replacing: true,
        }),
      ),
      QuotaError,
    );
    assert.ok(photo.id);
  } finally {
    await w.close();
  }
});

test("going back: the original returns under a new ID, the cut-out is deleted, and there is nothing to go back to twice", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const photo = await storePhoto(w, bytes, true);
    const preview = await tryOn(w, photo.id, bytes);
    const applied = await applyPreview(w.db.transaction, {
      owner: w.owner,
      bikeId: w.bike,
      photoId: photo.id,
      previewId: preview.id,
      directory: w.uploads,
    });
    const given = { owner: w.owner, bikeId: w.bike, directory: w.uploads };

    await assert.rejects(
      restoreOriginal(w.db.transaction, {
        ...given,
        owner: w.stranger,
        photoId: applied.id,
      }),
      refused(404, "gone"),
    );
    const back = await restoreOriginal(w.db.transaction, {
      ...given,
      photoId: applied.id,
    });
    assert.notEqual(back.id, applied.id, "no cache may show the old picture");
    assert.notEqual(back.id, photo.id);
    const { rows } = await w.db.query<{
      id: string;
      filename: string;
      is_cover: boolean;
      size_bytes: string;
      original_filename: string | null;
      original_size_bytes: string | null;
    }>("SELECT * FROM photos WHERE bike_id=$1", [w.bike]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, back.id);
    assert.equal(rows[0].filename, photo.filename);
    assert.equal(rows[0].is_cover, true);
    assert.equal(Number(rows[0].size_bytes), bytes.length);
    assert.equal(rows[0].original_filename, null);
    assert.equal(rows[0].original_size_bytes, null);
    assert.deepEqual(await readdir(w.uploads), [photo.filename]);
    assert.equal(
      (await readFile(path.join(w.uploads, photo.filename))).equals(bytes),
      true,
    );

    await assert.rejects(
      restoreOriginal(w.db.transaction, { ...given, photoId: back.id }),
      refused(409, "no_original"),
    );
    await assert.rejects(
      restoreOriginal(w.db.transaction, { ...given, photoId: applied.id }),
      refused(404, "gone"),
    );

    // A lost original must not turn the photo into a broken picture.
    const next = await tryOn(w, back.id, bytes);
    const second = await applyPreview(w.db.transaction, {
      ...given,
      photoId: back.id,
      previewId: next.id,
    });
    await rm(path.join(w.uploads, photo.filename));
    await assert.rejects(
      restoreOriginal(w.db.transaction, { ...given, photoId: second.id }),
      refused(409, "no_original"),
    );
    const still = await w.db.query<{ filename: string }>(
      "SELECT filename FROM photos WHERE id=$1",
      [second.id],
    );
    assert.equal(still.rows[0].filename, second.id + ".webp");
  } finally {
    await w.close();
  }
});

test("deleting the photo or the bike deletes both files; the audit and the recount know the original", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const make = async () => {
      const photo = await storePhoto(w, bytes);
      const preview = await tryOn(w, photo.id, bytes);
      const applied = await applyPreview(w.db.transaction, {
        owner: w.owner,
        bikeId: w.bike,
        photoId: photo.id,
        previewId: preview.id,
        directory: w.uploads,
      });
      return { photo, applied };
    };
    const first = await make();
    assert.equal((await readdir(w.uploads)).length, 2);
    const names = await changePhoto(
      w.db.transaction,
      w.bike,
      first.applied.id,
      "remove",
    );
    assert.deepEqual(
      names.sort(),
      [first.photo.filename, first.applied.id + ".webp"].sort(),
    );

    // The route unlinks what the service names, after the commit.
    await Promise.all(names.map((name) => rm(path.join(w.uploads, name))));
    assert.deepEqual(await readdir(w.uploads), []);

    await make();
    await make();
    assert.equal((await readdir(w.uploads)).length, 4);
    assert.equal(await removeBike(w.db, w.bike, w.owner, w.uploads), true);
    assert.deepEqual(
      await readdir(w.uploads),
      [],
      "no original is left behind",
    );
  } finally {
    await w.close();
  }
});

test("a found photo's preview rides the import: only its owner's, for that photo, once", async () => {
  const w = await world();
  try {
    const bytes = await studioPhoto();
    const candidate = randomUUID();
    const result: Cutout = await cutOut(bytes, w.owner);
    const preview = await storePreview(
      w.db,
      w.owner,
      { kind: "candidate", candidateId: candidate },
      result,
      Buffer.from("the picture as it was"),
    );
    assert.equal(
      preview.beforeUrl,
      `/api/bikes/previews/${preview.id}?side=before`,
    );
    assert.equal(
      (await readPreview(w.db, w.owner, preview.id, "before"))?.toString(),
      "the picture as it was",
    );
    assert.equal(
      (await previewOfCandidate(w.db, w.owner, preview.id, candidate)).equals(
        result.bytes,
      ),
      true,
    );
    // Another person, another photo, a preview that is not of a found photo.
    await assert.rejects(
      previewOfCandidate(w.db, w.stranger, preview.id, candidate),
      refused(404, "gone"),
    );
    await assert.rejects(
      previewOfCandidate(w.db, w.owner, preview.id, randomUUID()),
      refused(404, "gone"),
    );
    const upload = await storePreview(
      w.db,
      w.owner,
      { kind: "upload" },
      result,
    );
    await assert.rejects(
      previewOfCandidate(w.db, w.owner, upload.id, candidate),
      refused(404, "gone"),
    );
    // Once on the bike it is spent, and its files are let go.
    const photo = randomUUID();
    await settlePreviews(w.db, w.owner, [
      { previewId: preview.id, photoId: photo },
    ]);
    await assert.rejects(
      previewOfCandidate(w.db, w.owner, preview.id, candidate),
      refused(404, "gone"),
    );
    assert.deepEqual(
      (await readdir(w.cache)).filter((f) => f.includes(preview.id)),
      [],
    );
  } finally {
    await w.close();
  }
});
