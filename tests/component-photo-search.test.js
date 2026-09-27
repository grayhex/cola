import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { bikeResolverClient } from "../lib/bike-resolver-client.js";
import {
  componentPhotoSelection,
  searchComponentPhotos,
  loadComponentCandidate,
} from "../lib/component-photo-search.js";
import {
  componentGallery,
  saveComponentPhotos,
  saveComponentPhoto,
} from "../lib/component-photos.js";

test("component search scopes tokens and preserves atomic first-gallery import, provenance, quotas and publication policy", async () => {
  const db = new PGlite(),
    dir = await mkdtemp(path.join(os.tmpdir(), "cola-photo-search-"));
  const oldDir = process.env.UPLOAD_DIR,
    oldRequest = bikeResolverClient.request;
  process.env.UPLOAD_DIR = dir;
  const tx = (fn) => db.transaction(fn);
  const source = {
    provider: "Wikimedia Commons",
    url: "https://commons.wikimedia.org/wiki/File:Test.png",
    imageUrl: "https://upload.wikimedia.org/test.png",
    title: "Test",
    creator: "Photographer",
    credit: "Own work",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };
  const raw = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#aaccdd" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "camera" } } })
    .toBuffer();
  let data = raw.toString("base64");
  bikeResolverClient.request = async (url) =>
    url.endsWith("/search")
      ? { photos: [1, 2].map(() => ({ id: randomUUID(), source })) }
      : { data, source };
  const user = async (role = "user", verified = true) => {
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,role,email_verified_at) VALUES($1,$2,'Photo reader','x',$3,$4)",
      [id, id + "@example.test", role, verified ? new Date() : null],
    );
    return { id, role };
  };
  const model = async (owner, name) => {
    const id = randomUUID(),
      component = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public) VALUES($1,$1,$2,'Bike','Cube','Travel',2024,'road',true)",
      [id, owner.id],
    );
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло',$3)",
      [component, id, name],
    );
    return (
      await db.query("SELECT model_id FROM components WHERE id=$1", [component])
    ).rows[0].model_id;
  };
  const denied = (work, status) =>
    assert.rejects(work, (e) => e.status === status);
  try {
    for (const f of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    const owner = await user(),
      reader = await user(),
      admin = await user("admin"),
      pending = await user("user", false);
    const id = await model(owner, "Brooks Test"),
      other = await model(owner, "Brooks Other");
    assert.equal((await componentGallery(db, id)).canSearch, false);
    assert.equal((await componentGallery(db, id, reader)).canSearch, true);
    await denied(saveComponentPhoto(tx, id, reader, raw), 403);
    const search = await searchComponentPhotos(db, tx, id, reader);
    await denied(
      loadComponentCandidate(db, id, owner, search.photos[0].id),
      404,
    );
    await denied(
      loadComponentCandidate(db, other, reader, search.photos[0].id),
      404,
    );
    assert.throws(() =>
      componentPhotoSelection.parse({
        ids: [search.photos[0].id],
        confirmed: false,
      }),
    );
    assert.throws(() =>
      componentPhotoSelection.parse({
        ids: [search.photos[0].id, search.photos[0].id],
        confirmed: true,
      }),
    );
    data = Buffer.from("<svg onload='alert(1)'/>").toString("base64");
    await denied(
      loadComponentCandidate(db, id, reader, search.photos[0].id),
      400,
    );
    data = raw.toString("base64");
    const photos = [];
    for (const p of search.photos)
      photos.push(await loadComponentCandidate(db, id, reader, p.id));
    assert.equal((await sharp(photos[0].bytes).metadata()).exif, undefined);
    await denied(
      saveComponentPhotos(
        tx,
        id,
        reader,
        [photos[0], { ...photos[1], candidateId: randomUUID() }],
        true,
      ),
      409,
    );
    assert.equal((await componentGallery(db, id)).photos.length, 0);
    assert.equal((await readdir(dir).catch(() => [])).length, 0);
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [reader.id]);
    await denied(saveComponentPhotos(tx, id, reader, photos, true), 403);
    assert.equal((await componentGallery(db, id, reader)).canSearch, false);
    await db.query("UPDATE users SET blocked=false WHERE id=$1", [reader.id]);
    const pendingSearch = await searchComponentPhotos(db, tx, id, pending);
    const pendingPhoto = await loadComponentCandidate(
      db,
      id,
      pending,
      pendingSearch.photos[0].id,
    );
    await denied(
      saveComponentPhotos(tx, id, pending, [pendingPhoto], true),
      403,
    );
    const saved = await saveComponentPhotos(tx, id, reader, photos, true);
    assert.equal(saved.length, 2);
    const gallery = await componentGallery(db, id, reader);
    assert.equal(gallery.canSearch, false);
    assert.equal(gallery.canUpload, false);
    assert.deepEqual(gallery.photos[0].source, source);
    assert.equal((await componentGallery(db, id, admin)).canSearch, true);
    await denied(saveComponentPhotos(tx, id, reader, photos, true), 403);
    const extra = await searchComponentPhotos(db, tx, id, admin);
    await db.query(
      "UPDATE component_photo_candidates SET expires_at=now()-interval '1 second' WHERE id=$1",
      [extra.photos[0].id],
    );
    await denied(
      loadComponentCandidate(db, id, admin, extra.photos[0].id),
      404,
    );
    await db.query(
      "UPDATE component_photos SET hidden=true WHERE model_id=$1",
      [id],
    );
    assert.equal((await componentGallery(db, id, owner)).canSearch, false);
    const before = (await readdir(dir)).length;
    const adminPhoto = await loadComponentCandidate(
      db,
      id,
      admin,
      extra.photos[1].id,
    );
    // Replay after successful import is rejected even for the administrator.
    await saveComponentPhotos(tx, id, admin, [adminPhoto], true);
    await denied(saveComponentPhotos(tx, id, admin, [adminPhoto], true), 409);
    assert.equal((await readdir(dir)).length, before + 1);
  } finally {
    bikeResolverClient.request = oldRequest;
    if (oldDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldDir;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
