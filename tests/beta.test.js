import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { limits, checkPhotoQuota } from "../lib/limits.js";
import { insertBike } from "../lib/repository.js";
import { savePhotos } from "../lib/photo-storage.js";
import { importPhotos } from "../lib/photo-import.js";
import { bikeResolverClient } from "../lib/bike-resolver-client.js";
import {
  publicBike,
  publicBikeKeys,
  publicComponentKeys,
  publicPhotoKeys,
} from "../lib/public-dto.js";
import { showcase } from "../lib/showcase.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import { validateRuntime } from "../lib/runtime-config.js";
import { trustedIp, allowAuth } from "../lib/auth-limits.js";
import sharp from "sharp";
const base = {
  name: "Test",
  brand: "CUBE",
  model: "Travel",
  year: 2020,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: 14,
  is_public: true,
};
async function setup() {
  const db = new PGlite();
  for (const m of [
    "001_initial",
    "002_admin",
    "003_factory_spec",
    "004_garage_layout",
    "005_bike_wizard",
    "007_showcase",
    "008_beta_limits",
    "009_social_core",
    "010_community",
    "011_gamification",
    "012_rides",
    "014_journal",
    "015_discovery",
    "016_product_ui",
    "017_rides_market",
    "018_articles_rsvp",
    "020_bike_classification",
  ])
    await db.exec(
      await readFile(new URL("../db/" + m + ".sql", import.meta.url), "utf8"),
    );
  await db.query("INSERT INTO site_settings VALUES(1,$1,1,now())", [
    JSON.stringify(defaultSettings),
  ]);
  await db.query("INSERT INTO site_catalog VALUES(1,$1,1,now())", [
    JSON.stringify(defaultCatalog),
  ]);
  return db;
}
async function user(db) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Test','hash')",
    [id, id + "@test.example"],
  );
  return id;
}
test("public DTO is an allowlist even if future columns and nested operational data appear", () => {
  const populated = Object.fromEntries(publicBikeKeys.map((k) => [k, "value"]));
  const part = Object.fromEntries(publicComponentKeys.map((k) => [k, "value"]));
  const photo = Object.fromEntries(publicPhotoKeys.map((k) => [k, "value"]));
  const dto = publicBike({
    ...populated,
    show_bike_price: false,
    show_component_prices: false,
    show_accessory_prices: false,
    owner_id: "SECRET",
    email: "SECRET",
    future_column: "SECRET",
    factory_spec: { raw: "SECRET" },
    price: 123,
    components: [{ ...part, price: 456, bike_id: "SECRET", future: "SECRET" }],
    photos: [{ ...photo, filename: "SECRET", size_bytes: 123 }],
  });
  assert.deepEqual(
    Object.keys(dto).sort(),
    [...publicBikeKeys, "components", "photos"].sort(),
  );
  assert.deepEqual(
    Object.keys(dto.components[0]).sort(),
    publicComponentKeys.toSorted(),
  );
  assert.deepEqual(
    Object.keys(dto.photos[0]).sort(),
    publicPhotoKeys.toSorted(),
  );
  assert(!JSON.stringify(dto).includes("SECRET"));
  assert(!("price" in dto));
  assert.equal(
    publicBike({ ...dto, price: 9, show_bike_price: true }).price,
    9,
  );
});
test("quota isolates owners, releases deleted storage and blocks bike creation", async () => {
  const db = await setup();
  try {
    const a = await user(db),
      b = await user(db),
      bike = await insertBike(db, a, base),
      other = await insertBike(db, b, base);
    for (let i = 1; i < limits.bikes; i++) await insertBike(db, a, base);
    await assert.rejects(insertBike(db, a, base), /велосипедов/);
    const config = { ...limits, photos: 2, storageBytes: 100 };
    await db.query(
      "INSERT INTO photos(id,bike_id,filename,size_bytes) VALUES($1,$2,$3,80)",
      [randomUUID(), bike, "test.webp"],
    );
    await assert.rejects(checkPhotoQuota(db, a, bike, [21], config), /места/);
    await checkPhotoQuota(db, b, other, [90], config);
    await assert.rejects(
      checkPhotoQuota(db, a, bike, [1, 1], config),
      /фотографий/,
    );
    await db.query("DELETE FROM photos WHERE bike_id=$1", [bike]);
    await checkPhotoQuota(db, a, bike, [100], config);
    await db.query(
      "INSERT INTO photos(id,bike_id,filename,size_bytes) VALUES($1,$2,$3,100)",
      [randomUUID(), bike, "test.webp"],
    );
    await db.query("DELETE FROM bikes WHERE id=$1", [bike]);
    await insertBike(db, a, base);
    const any = (
      await db.query("SELECT id FROM bikes WHERE owner_id=$1 LIMIT 1", [a])
    ).rows[0].id;
    await checkPhotoQuota(db, a, any, [100], config);
  } finally {
    await db.close();
  }
});
test("photo import uses same quota and rollback leaves neither rows nor files", async () => {
  const db = await setup(),
    dir = await mkdtemp(path.join(tmpdir(), "cola-quota-"));
  const original = bikeResolverClient.request;
  try {
    const owner = await user(db),
      bike = await insertBike(db, owner, base);
    for (let i = 0; i < 12; i++)
      await db.query(
        "INSERT INTO photos(id,bike_id,filename,size_bytes) VALUES($1,$2,$3,1)",
        [randomUUID(), bike, i + ".webp"],
      );
    const id = randomUUID();
    await db.query(
      "INSERT INTO photo_search_candidates(id,owner_id) VALUES($1,$2)",
      [id, owner],
    );
    const bytes = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    bikeResolverClient.request = async () => ({
      data: bytes.toString("base64"),
      sourceUrl: "https://example.test/a.png",
      sourcePageUrl: "https://example.test/bike",
    });
    const transaction = (fn) => db.transaction(fn);
    await assert.rejects(
      importPhotos(db, transaction, bike, owner, [id], dir),
      /12/,
    );
    assert.deepEqual(await readdir(dir), []);
    await db.query("DELETE FROM photos WHERE bike_id=$1", [bike]);
    await importPhotos(db, transaction, bike, owner, [id], dir);
    const stored = (
      await db.query("SELECT size_bytes FROM photos WHERE bike_id=$1", [bike])
    ).rows[0];
    assert(Number(stored.size_bytes) > 0);
    const duplicate = randomUUID();
    await assert.rejects(
      savePhotos(
        transaction,
        owner,
        bike,
        [
          { id: duplicate, filename: "rollback-a.webp", bytes },
          { id: duplicate, filename: "rollback-b.webp", bytes },
        ],
        dir,
      ),
    );
    assert.equal((await readdir(dir)).length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM photos WHERE bike_id=$1",
          [bike],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    bikeResolverClient.request = original;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("showcase SQL query count stays at seven for a full page", async () => {
  const db = await setup();
  try {
    const a = await user(db),
      b = await user(db);
    for (let i = 0; i < 24; i++) await insertBike(db, i < 12 ? a : b, base);
    let count = 0;
    const q = {
      query: (...args) => {
        count++;
        return db.query(...args);
      },
    };
    const result = await showcase(q, a);
    assert.equal(result.bikes.length, 24);
    assert.equal(count, 7);
  } finally {
    await db.close();
  }
});
test("production config fails closed; forwarded headers are trusted only with shared key", async () => {
  assert.deepEqual(validateRuntime({}), { mode: "local" });
  const env = {
    DEPLOYMENT_MODE: "production",
    POSTGRES_PASSWORD: "a".repeat(32),
    TRUSTED_PROXY_KEY: "b".repeat(32),
    BIKE_RESOLVER_TOKEN: "c".repeat(32),
    APP_ORIGIN: "https://colabike.ru",
    COOKIE_SECURE: "true",
    DATABASE_URL: "postgres://test",
    BIKE_RESOLVER_URL: "http://bike-resolver:8080",
  };
  assert.equal(validateRuntime(env).mode, "production");
  for (const bad of [
    { POSTGRES_PASSWORD: "" },
    { POSTGRES_PASSWORD: "colabike-local-only" },
    { APP_ORIGIN: "http://localhost:3000" },
    { COOKIE_SECURE: "false" },
    { TRUSTED_PROXY_KEY: "" },
  ])
    assert.throws(() => validateRuntime({ ...env, ...bad }));
  assert.equal(
    trustedIp(
      new Request("https://x", {
        headers: {
          "x-forwarded-for": "1.2.3.4",
          "x-cola-client-ip": "1.2.3.4",
        },
      }),
      env,
    ),
    null,
  );
  assert.equal(
    trustedIp(
      new Request("https://x", {
        headers: {
          "x-cola-client-ip": "1.2.3.4",
          "x-cola-proxy-key": env.TRUSTED_PROXY_KEY,
        },
      }),
      env,
    ),
    "1.2.3.4",
  );
  const calls = [];
  await allowAuth(new Request("https://x"), "a@test.example", async (key) => {
    calls.push(key);
    return false;
  });
  assert.equal(calls.length, 1);
  assert(!calls.includes("auth:global"));
});
