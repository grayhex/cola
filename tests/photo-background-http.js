import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
// Taking the backdrop off a photo (#370), through the real server and
// PostgreSQL: who may try and who may look at the result, the new version with
// a new media ID in every URL and cache key, transparency down to the
// thumbnails, the original kept and brought back, the quota and the files.
// The pictures are made here from pixels: the server looks at bytes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";

const base = process.env.TEST_ORIGIN;
const uploads = process.env.UPLOAD_DIR;
const cache = process.env.MEDIA_CACHE_DIR;
assert.ok(uploads && cache, "the test server's directories are known");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const nonce = randomUUID().slice(0, 8);

function client() {
  let cookie = "";
  const call = async (url, method = "GET", data, type) => {
    const binary = Buffer.isBuffer(data);
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data
          ? {
              "Content-Type":
                type ||
                (binary ? "application/octet-stream" : "application/json"),
            }
          : {}),
      },
      body: data ? (binary ? data : JSON.stringify(data)) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const bytes = Buffer.from(await response.arrayBuffer());
    let body = null;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      /* A picture is not JSON. */
    }
    return { status: response.status, body, bytes, headers: response.headers };
  };
  // A raw GET that keeps the session, with an optional revalidation header.
  call.raw = async (url, etag) => {
    const response = await fetch(base + url, {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(etag ? { "If-None-Match": etag } : {}),
      },
    });
    return {
      status: response.status,
      headers: response.headers,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  };
  return call;
}
async function member(label) {
  const call = client();
  const registered = await call("auth/register", "POST", {
    ...testConsents,
    name: "Фон " + label,
    email: `background-${label}-${nonce}@example.test`,
    password: "background-http-secret-123",
  });
  assert.equal(registered.status, 201, registered.bytes.toString());
  call.id = (await call("me")).body.user.id;
  return call;
}
const bikeBody = (name) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
});

const width = 800,
  height = 600;
async function studio(background = () => [255, 255, 255]) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = (x - 400) ** 2 + (y - 300) ** 2 <= 150 ** 2;
      const [r, g, b] = inside ? [190, 30, 30] : background(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
const gradient = () =>
  studio((x) => [(x * 255) / width, 90, 200 - (x * 150) / width]);
const alphaAt = async (bytes, x, y) => {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
};
const withAlpha = async (bytes) => {
  const meta = await sharp(bytes).metadata();
  return meta.hasAlpha === true;
};
const files = async () => (await readdir(uploads)).sort();

const owner = await member("owner"),
  stranger = await member("stranger"),
  guest = client();
const studioPng = await studio();
const bike = (await owner("bikes", "POST", bikeBody("Фон"))).body.id;
const first = await owner(
  `bikes/${bike}/photos`,
  "POST",
  studioPng,
  "image/png",
);
assert.equal(first.status, 201, first.bytes.toString());
const second = await owner(
  `bikes/${bike}/photos`,
  "POST",
  await gradient(),
  "image/png",
);
assert.equal(second.status, 201);
const photo = first.body.id;
const original = await owner.raw("/api/photos/" + photo);
assert.equal(original.status, 200);
const originalBytes = original.bytes;

// ── Who may try, and who may look ────────────────────────────────────────
const tryUrl = `bikes/${bike}/photos/${photo}/background`;
assert.equal(
  (await guest(tryUrl, "POST")).status,
  401,
  "a guest tries nothing",
);
for (const method of ["POST", "PUT", "DELETE"])
  assert.equal(
    (
      await stranger(
        tryUrl,
        method,
        method === "PUT" ? { previewId: randomUUID() } : undefined,
      )
    ).status,
    404,
    method + " on a bike that is not theirs",
  );

const made = await owner(tryUrl, "POST");
assert.equal(made.status, 201, made.bytes.toString());
assert.equal(made.headers.get("cache-control"), "no-store");
const preview = made.body.preview;
assert.deepEqual(
  Object.keys(preview).sort(),
  ["beforeUrl", "bytes", "height", "id", "removed", "url", "width"],
  "what the page needs, nothing of the server's files",
);
assert.equal(preview.beforeUrl, null, "the saved photo is its own «before»");
assert.equal(preview.url, `/api/bikes/previews/${preview.id}`);
assert.equal(preview.width, width);
assert.ok(preview.removed > 0.5 && preview.removed < 0.95, preview.removed);

const shown = await owner.raw(preview.url);
assert.equal(shown.status, 200);
assert.equal(shown.headers.get("content-type"), "image/webp");
assert.equal(shown.headers.get("cache-control"), "private, no-store");
assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
assert.equal(shown.bytes.length, preview.bytes);
assert.equal(await withAlpha(shown.bytes), true);
assert.equal(await alphaAt(shown.bytes, 5, 5), 0, "the backdrop is clear");
assert.equal(await alphaAt(shown.bytes, 400, 300), 255, "the bike stays");
assert.equal((await owner.raw(preview.url + "?side=before")).status, 404);
assert.equal(
  (await stranger.raw(preview.url)).status,
  404,
  "not the stranger's",
);
assert.equal((await guest.raw(preview.url)).status, 401);
assert.equal(
  (await owner.raw("/api/photos/" + preview.id)).status,
  404,
  "a preview is no photo: the media route does not know it",
);
assert.equal((await owner.raw("/api/bikes/previews/not-an-id")).status, 404);
// Looking changes nothing: the photo is the one it was.
const unchanged = await owner.raw("/api/photos/" + photo);
assert.equal(unchanged.headers.get("etag"), original.headers.get("etag"));
assert.equal(unchanged.bytes.equals(originalBytes), true);

// ── Applying: a new ID everywhere, nothing of the old picture ────────────
const warm = await owner.raw(`/api/photos/${photo}?width=640`);
assert.equal(warm.status, 200);
assert.equal(await withAlpha(warm.bytes), false, "a photo with a backdrop");
const stalePreviewId = (await owner(tryUrl, "POST")).body.preview.id;
assert.equal(
  (
    await stranger(`bikes/${bike}/photos/${photo}/background`, "PUT", {
      previewId: preview.id,
    })
  ).status,
  404,
);
assert.equal(
  (
    await owner(`bikes/${bike}/photos/${photo}/background`, "PUT", {
      previewId: "nope",
    })
  ).status,
  400,
);
const applied = await owner(`bikes/${bike}/photos/${photo}/background`, "PUT", {
  previewId: preview.id,
});
assert.equal(applied.status, 200, applied.bytes.toString());
assert.equal(applied.body.previousId, photo);
assert.equal(applied.body.repeated, false);
const version = applied.body.id;
assert.notEqual(version, photo);

for (const url of [`/api/photos/${photo}`, `/api/photos/${photo}?width=640`]) {
  assert.equal((await owner.raw(url)).status, 404, url + " is gone");
  assert.equal(
    (await guest.raw(url)).status,
    404,
    url + " is gone for a guest",
  );
}
assert.equal(
  (await owner.raw(`/api/photos/${photo}?width=640`, warm.headers.get("etag")))
    .status,
  404,
  "a cached copy of the old ID is not revalidated into a 304",
);
const full = await owner.raw(`/api/photos/${version}`);
assert.equal(full.status, 200);
assert.equal(full.headers.get("content-type"), "image/webp");
assert.match(
  full.headers.get("etag"),
  new RegExp(`^"v1-${version}-original"$`),
);
assert.equal(await withAlpha(full.bytes), true);
assert.equal(await alphaAt(full.bytes, 5, 5), 0);
assert.equal(await alphaAt(full.bytes, 400, 300), 255);
for (const size of [160, 320, 640, 1280]) {
  const thumb = await guest.raw(`/api/photos/${version}?width=${size}`);
  assert.equal(thumb.status, 200, "public bike, size " + size);
  assert.match(
    thumb.headers.get("etag"),
    new RegExp(`^"v1-${version}-${size}"$`),
  );
  assert.equal(
    await withAlpha(thumb.bytes),
    true,
    `a ${size}px thumbnail keeps transparency`,
  );
  assert.equal(
    await alphaAt(thumb.bytes, 2, 2),
    0,
    `${size}px: nothing painted in`,
  );
}

// The same spent preview answers with the same version, and is no picture now.
const repeated = await owner(
  `bikes/${bike}/photos/${photo}/background`,
  "PUT",
  {
    previewId: preview.id,
  },
);
assert.equal(repeated.status, 200);
assert.deepEqual(repeated.body, {
  id: version,
  previousId: photo,
  repeated: true,
});
assert.equal((await owner.raw(preview.url)).status, 404);
// A preview of the version that is gone is never put on its successor.
const late = await owner(`bikes/${bike}/photos/${photo}/background`, "PUT", {
  previewId: stalePreviewId,
});
assert.equal(late.status, 409);
assert.equal(late.body.reason, "stale");
const lateOnNew = await owner(
  `bikes/${bike}/photos/${version}/background`,
  "PUT",
  {
    previewId: stalePreviewId,
  },
);
assert.equal(lateOnNew.status, 409);
// A cut-out is not cleared again: it is brought back first.
const twice = await owner(`bikes/${bike}/photos/${version}/background`, "POST");
assert.equal(twice.status, 409);
assert.equal(twice.body.reason, "already_removed");

// The gallery: same bike, same place, same cover, no second photo; the mark of
// the kept original is the owner's.
const mine = (await owner("bikes/" + bike)).body.bike;
assert.deepEqual(
  mine.photos.map((p) => [p.id, p.is_cover, p.has_original]),
  [
    [version, true, true],
    [second.body.id, false, false],
  ],
);
const publicBike = await guest.raw("/api/shared/" + mine.share_id);
assert.equal(publicBike.status, 200);
const publicPhotos = JSON.parse(publicBike.bytes.toString()).bike.photos;
assert.equal(publicPhotos.length, 2);
assert.ok(
  publicPhotos.every((p) => !("has_original" in p)),
  "the public view does not tell a photo was edited",
);
const row = (
  await db.query(
    "SELECT filename,size_bytes,original_filename,original_size_bytes FROM photos WHERE id=$1",
    [version],
  )
).rows[0];
assert.equal(row.filename, version + ".webp");
assert.equal(row.original_filename, photo + ".webp");
assert.equal(Number(row.original_size_bytes), originalBytes.length);
const processed = await readFile(path.join(uploads, row.filename));
assert.equal(
  Number(row.size_bytes),
  processed.length + originalBytes.length,
  "the quota counts both files",
);
assert.ok(
  (await files()).includes(photo + ".webp"),
  "the original stays on disk",
);

// ── Going back ───────────────────────────────────────────────────────────
assert.equal(
  (await stranger(`bikes/${bike}/photos/${version}/background`, "DELETE"))
    .status,
  404,
);
const back = await owner(
  `bikes/${bike}/photos/${version}/background`,
  "DELETE",
);
assert.equal(back.status, 200, back.bytes.toString());
assert.equal(back.body.previousId, version);
const restored = back.body.id;
assert.notEqual(restored, version);
assert.notEqual(restored, photo, "a new ID, so no cache shows the cut-out");
const returned = await owner.raw("/api/photos/" + restored);
assert.equal(returned.status, 200);
assert.equal(
  returned.bytes.equals(originalBytes),
  true,
  "the very file it was",
);
assert.equal((await owner.raw("/api/photos/" + version)).status, 404);
assert.equal((await guest.raw(`/api/photos/${version}?width=320`)).status, 404);
assert.ok(
  !(await files()).includes(version + ".webp"),
  "the cut-out file is gone",
);
const goneAgain = await owner(
  `bikes/${bike}/photos/${restored}/background`,
  "DELETE",
);
assert.equal(goneAgain.status, 409);
assert.equal(goneAgain.body.reason, "no_original");
const after = (await owner("bikes/" + bike)).body.bike.photos;
assert.deepEqual(
  after.map((p) => [p.id, p.is_cover, p.has_original]),
  [
    [restored, true, false],
    [second.body.id, false, false],
  ],
);

// ── Deleting a cut-out deletes the original with it ─────────────────────
const again = await owner(
  `bikes/${bike}/photos/${restored}/background`,
  "POST",
);
const appliedAgain = await owner(
  `bikes/${bike}/photos/${restored}/background`,
  "PUT",
  { previewId: again.body.preview.id },
);
assert.equal(appliedAgain.status, 200);
const kept = appliedAgain.body.id;
// The original goes back under the name it always had; the new version is `kept`.
assert.ok((await files()).includes(photo + ".webp"));
assert.ok((await files()).includes(kept + ".webp"));
assert.equal(
  (await owner(`bikes/${bike}/photos/${kept}`, "DELETE")).status,
  200,
);
assert.deepEqual(
  (await files()).filter(
    (name) => name.startsWith(photo) || name.startsWith(kept),
  ),
  [],
  "neither the cut-out nor the original is left",
);
assert.equal(
  (await owner(`bikes/${bike}/photos/${second.body.id}`, "PATCH")).status,
  200,
);

// ── A picture that cannot be cleared says why, and changes nothing ───────
const scene = await owner(
  `bikes/${bike}/photos/${second.body.id}/background`,
  "POST",
);
assert.equal(scene.status, 422);
assert.equal(scene.body.reason, "not_uniform");
assert.match(scene.body.error, /не однотонный/);
const missing = await owner(
  `bikes/${bike}/photos/${randomUUID()}/background`,
  "POST",
);
assert.equal(missing.status, 404);

// ── A file chosen in the wizard: a preview of bytes, before any bike ─────
const draft = await owner("bikes/previews", "POST", studioPng, "image/png");
assert.equal(draft.status, 201, draft.bytes.toString());
assert.equal(draft.body.preview.beforeUrl, null);
const draftShown = await owner.raw(draft.body.preview.url);
assert.equal(await alphaAt(draftShown.bytes, 5, 5), 0);
assert.equal((await stranger.raw(draft.body.preview.url)).status, 404);
assert.equal(
  (await owner(`bikes/previews/${draft.body.preview.id}`, "DELETE")).status,
  200,
);
assert.equal((await owner.raw(draft.body.preview.url)).status, 404, "let go");
assert.equal(
  (await guest("bikes/previews", "POST", studioPng, "image/png")).status,
  401,
);
const wrongType = await owner(
  "bikes/previews",
  "POST",
  studioPng,
  "text/plain",
);
assert.equal(wrongType.status, 415);
const noImage = await owner(
  "bikes/previews",
  "POST",
  Buffer.from("not a picture"),
  "image/png",
);
assert.equal(noImage.status, 422);
assert.equal(noImage.body.reason, "unreadable");
const svg = await owner(
  "bikes/previews",
  "POST",
  Buffer.from(
    "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'/>",
  ),
  "image/png",
);
assert.equal(svg.status, 422, "SVG is never decoded");
const huge = await owner(
  "bikes/previews",
  "POST",
  Buffer.alloc(10 * 1024 * 1024 + 1),
  "image/png",
);
assert.equal(huge.status, 413);
const flat = await owner(
  "bikes/previews",
  "POST",
  await studio(() => [190, 30, 30]),
  "image/png",
);
assert.equal(flat.status, 422);
assert.equal(flat.body.reason, "everything_removed");

// ── A found photo: its own try, and its cut-out rides the import ─────────
const query = { brand: "Giant", model: "Tourer", trim: "GTS", year: 2024 };
const sourceUrl = "https://www.velo-port.ru/test-bike";
const search = await owner("bikes/photo-search", "POST", {
  ...query,
  sourceUrl,
});
assert.equal(search.status, 200);
const candidate = search.body.photos[0].id;
assert.equal(
  (await stranger(`bikes/photo-candidates/${candidate}/background`, "POST"))
    .status,
  404,
);
assert.equal(
  (await guest(`bikes/photo-candidates/${candidate}/background`, "POST"))
    .status,
  401,
);
const found = await owner(
  `bikes/photo-candidates/${candidate}/background`,
  "POST",
);
// The fixture's picture is one flat colour all over: nothing of a bike is
// left once its backdrop is gone, and the refusal says so.
assert.equal(found.status, 422, found.bytes.toString());
assert.equal(found.body.reason, "everything_removed");

// What the server made, with the transparency it has, in the cache directory.
const cutout = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><circle cx="320" cy="240" r="150" fill="#be1e1e"/></svg>`,
  ),
)
  .webp({ quality: 90, alphaQuality: 100 })
  .toBuffer();
async function plant(ownerId, candidateId) {
  const id = randomUUID();
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, `preview-${id}.webp`), cutout);
  await db.query(
    "INSERT INTO photo_previews(id,owner_id,source,candidate_id,width,height,size_bytes,removed,expires_at) VALUES($1,$2,'candidate',$3,640,480,$4,0.5,now() + interval '10 minutes')",
    [id, ownerId, candidateId, cutout.length],
  );
  return id;
}
const importBike = (await owner("bikes", "POST", bikeBody("Находки"))).body.id;
const importUrl = `bikes/${importBike}/photos/import`;
const foreign = await plant(stranger.id, candidate);
const elsewhere = await plant(owner.id, randomUUID());
const planted = await plant(owner.id, candidate);
const strayKey = await owner(importUrl, "POST", {
  ids: [candidate],
  cutouts: { [randomUUID()]: planted },
});
assert.equal(
  strayKey.status,
  400,
  "a cut-out for a photo that is not imported",
);
for (const [name, id] of [
  ["a stranger's", foreign],
  ["another photo's", elsewhere],
]) {
  const refused = await owner(importUrl, "POST", {
    ids: [candidate],
    cutouts: { [candidate]: id },
  });
  assert.equal(refused.status, 404, name + " preview");
  assert.equal(refused.body.reason, "gone");
}
assert.deepEqual((await owner("bikes/" + importBike)).body.bike.photos, []);
const imported = await owner(importUrl, "POST", {
  ids: [candidate],
  cutouts: { [candidate]: planted },
});
assert.equal(imported.status, 201, imported.bytes.toString());
const importedPhoto = imported.body.ids[0];
const importedBytes = await owner.raw("/api/photos/" + importedPhoto);
assert.equal(
  importedBytes.bytes.equals(cutout),
  true,
  "the cut-out, not the original",
);
assert.equal(await withAlpha(importedBytes.bytes), true);
const importedBike = (await owner("bikes/" + importBike)).body.bike;
assert.equal(
  importedBike.photos[0].source_page_url,
  sourceUrl,
  "the credit stays",
);
assert.equal(
  importedBike.photos[0].has_original,
  false,
  "no original of a draft is kept",
);
assert.equal(
  (
    await db.query("SELECT applied_photo_id FROM photo_previews WHERE id=$1", [
      planted,
    ])
  ).rows[0].applied_photo_id,
  importedPhoto,
);
assert.equal(
  (await readdir(cache)).includes(`preview-${planted}.webp`),
  false,
  "the spent preview's file is let go",
);
const spent = await owner(importUrl, "POST", {
  ids: [candidate],
  cutouts: { [candidate]: planted },
});
assert.equal(spent.status, 404, "a preview is spent once");

// ── A bike with all its photos can still clear a backdrop ────────────────
const full12 = await member("full");
const crowded = (await full12("bikes", "POST", bikeBody("Двенадцать"))).body.id;
const flatJpeg = await sharp({
  create: { width: 800, height: 600, channels: 3, background: "#5b8a72" },
})
  .jpeg()
  .toBuffer();
const lead = await full12(
  `bikes/${crowded}/photos`,
  "POST",
  studioPng,
  "image/png",
);
assert.equal(lead.status, 201);
for (let i = 1; i < 12; i++)
  assert.equal(
    (await full12(`bikes/${crowded}/photos`, "POST", flatJpeg, "image/jpeg"))
      .status,
    201,
    "photo " + (i + 1),
  );
const refusedThirteenth = await full12(
  `bikes/${crowded}/photos`,
  "POST",
  flatJpeg,
  "image/jpeg",
);
assert.equal(refusedThirteenth.status, 409, "twelve is the limit");
const crowdedPreview = await full12(
  `bikes/${crowded}/photos/${lead.body.id}/background`,
  "POST",
);
assert.equal(crowdedPreview.status, 201);
const crowdedApplied = await full12(
  `bikes/${crowded}/photos/${lead.body.id}/background`,
  "PUT",
  {
    previewId: crowdedPreview.body.preview.id,
  },
);
assert.equal(
  crowdedApplied.status,
  200,
  "a new version is not a thirteenth photo",
);
assert.equal((await full12("bikes/" + crowded)).body.bike.photos.length, 12);

// ── The budget of tries ──────────────────────────────────────────────────
const eager = await member("eager");
let last;
for (let i = 0; i < 30; i++) {
  last = await eager("bikes/previews", "POST", studioPng, "text/plain");
  assert.equal(last.status, 415, "try " + (i + 1));
}
last = await eager("bikes/previews", "POST", studioPng, "image/png");
assert.equal(last.status, 429);
assert.equal(last.body.reason, "busy");
assert.equal(last.headers.get("retry-after"), "60");

await db.end();
console.log("photo background http ok");
