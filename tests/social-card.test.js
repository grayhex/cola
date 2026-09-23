import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { cardContent, cardText } from "../lib/social-card.js";
import { renderSocialImage } from "../lib/social-preview-image.js";

test("card text keeps only what the bundled font draws", () => {
  const rider = String.fromCodePoint(0x1f6b5, 0x200d, 0x2640, 0xfe0f);
  const han = String.fromCodePoint(0x674e);
  assert.equal(
    cardText(`Мой байк ${rider} ${han} — «лучший» №1, 85 ₽`),
    "Мой байк — «лучший» №1, 85 ₽",
  );
  assert.equal(cardText("  много   пробелов\nи строк "), "много пробелов и строк");
  assert.equal(cardText("a".repeat(100), 10), "a".repeat(9) + "…");
  assert.equal(cardText(null), "");
});

test("cards show public context per kind and respect hidden ride metrics", () => {
  const bike = cardContent("bike", "Гравел", {
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    author: "Иван",
  });
  assert.equal(bike.label, "Велосипед");
  assert.equal(bike.meta, "Cube Nuroad · 2024");
  assert.deepEqual(bike.chips, ["Гравел"]);
  assert.equal(bike.author, "Иван");
  const ride = {
    status: "completed",
    date: "2026-05-12",
    distance: 42512,
    geometry: [
      [
        [37.6, 55.75],
        [37.62, 55.76],
      ],
    ],
  };
  assert.equal(cardContent("ride", "Утро", ride).stat, "42,5 км");
  assert.equal(cardContent("ride", "Утро", ride).route.length, 1);
  assert.match(cardContent("ride", "Утро", ride).chips[0], /^12 мая 2026/);
  // The owner hid the distance on the page, so the card hides it too.
  assert.equal(
    cardContent("ride", "Утро", { ...ride, metrics: ["movingTimeS"] }).stat,
    "",
  );
  assert.deepEqual(cardContent("ride", "План", { status: "planned" }).chips, [
    "Запланирована",
  ]);
  assert.match(
    cardContent("market", "Колёса", {
      price: "85000.00",
      currency: "RUB",
      listingType: "sale",
    }).meta,
    /^85\s?000\s₽$/u,
  );
  assert.deepEqual(
    cardContent("journal", "Запись", { kind: "build", bike: "Cube" }).chips,
    ["Сборка / апгрейд"],
  );
  const generated = cardContent("profile", "Ольга", {
    username: "rider-8f6827b60c56484d9fe02fbe",
    location: "Москва",
    bikes: 3,
  });
  assert.equal(generated.meta, "");
  assert.deepEqual(generated.chips, ["Москва", "3 велосипеда"]);
  assert.equal(
    cardContent("profile", "Ольга", { username: "olga", bikes: 11 }).meta,
    "@olga",
  );
  assert.deepEqual(
    cardContent("profile", "Ольга", { username: "olga", bikes: 11 }).chips,
    ["11 велосипедов"],
  );
});

test("cards are 1200x630 JPEGs cached by content, with a plain fallback", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-card-"));
  const env = { MEDIA_CACHE_DIR: path.join(dir, "cache") };
  const cards = async () =>
    (await readdir(env.MEDIA_CACHE_DIR)).filter((f) =>
      f.startsWith("social-card-"),
    );
  try {
    await writeFile(
      path.join(dir, "photo.jpg"),
      await sharp({
        create: { width: 1600, height: 1000, channels: 3, background: "#5b8a72" },
      })
        .jpeg()
        .toBuffer(),
    );
    const preview = {
      kind: "bike",
      title: "Гравел",
      image: { filename: "photo.jpg" },
      card: { brand: "Cube", model: "Nuroad", year: 2024, category: "gravel" },
    };
    const first = await renderSocialImage(preview, { uploadDir: dir, env });
    const meta = await sharp(first).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 1200, 630]);
    assert.equal((await cards()).length, 1);
    assert.deepEqual(await renderSocialImage(preview, { uploadDir: dir, env }), first);
    // Anything drawn on the card is part of the key: a rename draws a new one.
    await renderSocialImage(
      { ...preview, title: "Новое имя" },
      { uploadDir: dir, env },
    );
    assert.equal((await cards()).length, 2);
    // An unreadable upload still yields an image instead of an error page.
    await writeFile(path.join(dir, "broken.jpg"), "not an image");
    const broken = await renderSocialImage(
      { ...preview, image: { filename: "broken.jpg" } },
      { uploadDir: dir, env },
    );
    assert.equal((await sharp(broken).metadata()).format, "jpeg");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
