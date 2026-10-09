import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #382: the photo opened whole is shown in a window of its own, as large as the
// screen allows and larger than the same photo on the page, from the stored
// file and not the card's thumbnail; a small file is not stretched, a portrait
// is limited by the height, a slow file does not collapse the window.
async function member(page, label) {
  const suffix = randomUUID();
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "photo-viewer-secret-123",
    },
  });
  expect(response.status()).toBe(201);
}
// A picture with some structure, so that it is a photograph for the encoder.
const picture = (width, height, { alpha = false } = {}) =>
  sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha
        ? { r: 200, g: 40, b: 40, alpha: 0.4 }
        : { r: 40, g: 90, b: 140 },
    },
  })
    .png()
    .toBuffer();
async function bikeWith(page, files, patch = {}) {
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Просмотр фото",
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
      ...patch,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  for (const data of files) {
    const sent = await page.request.post(`/api/bikes/${id}/photos`, {
      headers: { origin, "Content-Type": "image/png" },
      data,
    });
    expect(sent.status()).toBe(201);
  }
  return (await (await page.request.get("/api/bikes/" + id)).json()).bike;
}
const open = async (page) => {
  await page
    .getByRole("button", { name: /Открыть фото целиком/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Фотография велосипеда" });
  await expect(dialog).toBeVisible();
  return dialog;
};
const loaded = (img) =>
  expect
    .poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0))
    .toBe(true);

test("a large photo opens larger than on the page, whole, from the stored file; Escape returns the page as it was", async ({
  page,
  isMobile,
}, info) => {
  await member(page, "Просмотр");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bike = await bikeWith(page, [await picture(2400, 1600)]);
  await page.goto("/b/" + bike.share_id);
  const card = page.locator(".photo-stage img.hero-photo");
  await loaded(card);
  const before = await card.boundingBox();
  await page.evaluate(() => window.scrollTo(0, 40));
  const scrolled = await page.evaluate(() => window.scrollY);
  const opener = page.getByRole("button", { name: /Открыть фото целиком/ });
  const dialog = await open(page);
  const img = dialog.locator("img.full-photo");
  await loaded(img);
  const frame = page.viewportSize();
  const shown = await img.boundingBox();
  const window_ = await dialog.boundingBox();
  // The stored file, not the thumbnail of the card.
  const source = await img.evaluate((e) => e.currentSrc);
  expect(source).toContain("/api/photos/" + bike.photos[0].id);
  expect(source).not.toContain("width=");
  expect(await img.evaluate((e) => e.hasAttribute("srcset"))).toBe(false);
  info.annotations.push({
    type: "sizes",
    description: `page ${Math.round(before.width)}×${Math.round(before.height)}, viewer ${Math.round(shown.width)}×${Math.round(shown.height)}, window ${Math.round(window_.width)}×${Math.round(window_.height)} in ${frame.width}×${frame.height}`,
  });
  // Larger than the same photo on the page, and inside the screen.
  if (!isMobile) expect(shown.width).toBeGreaterThan(before.width * 1.2);
  else expect(shown.width).toBeGreaterThanOrEqual(before.width * 0.9);
  expect(shown.x).toBeGreaterThanOrEqual(0);
  expect(shown.y).toBeGreaterThanOrEqual(0);
  expect(shown.x + shown.width).toBeLessThanOrEqual(frame.width);
  expect(shown.y + shown.height).toBeLessThanOrEqual(frame.height);
  // Not the width of a form: well past 560 px where the screen has the room.
  if (!isMobile) {
    expect(window_.width).toBeGreaterThan(900);
    expect(window_.width).toBeGreaterThanOrEqual(frame.width * 0.7);
  }
  // The whole picture, in proportion, no big empty frame around it.
  const natural = await img.evaluate((e) => [e.naturalWidth, e.naturalHeight]);
  expect(shown.width / shown.height).toBeCloseTo(natural[0] / natural[1], 1);
  expect(window_.width - shown.width).toBeLessThan(80);
  expect(await img.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
    "contain",
  );
  expect(await pageOverflow(page)).toBeNull();
  await page.screenshot({
    path: info.outputPath("photo-viewer.png"),
    animations: "disabled",
  });
  // Escape closes it, the focus and the place on the page come back.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - scrolled),
  ).toBeLessThan(2);
  // The cover is untouched, nothing was uploaded.
  const after = await (await page.request.get("/api/bikes/" + bike.id)).json();
  expect(after.bike.photos.map((p) => p.id)).toEqual(
    bike.photos.map((p) => p.id),
  );
});

test("a portrait is limited by the height, a small file is not stretched, a transparent one stays transparent, and the selected photo is the one shown again", async ({
  page,
}) => {
  await member(page, "Разные");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bike = await bikeWith(page, [
    await picture(1200, 1800),
    await picture(640, 420),
    await picture(900, 600, { alpha: true }),
  ]);
  const ids = bike.photos.map((p) => p.id);
  await page.goto("/b/" + bike.share_id);
  const thumbs = page
    .getByRole("list", { name: "Фотографии" })
    .getByRole("button");
  const frame = page.viewportSize();
  // The portrait photo: the height decides.
  let dialog = await open(page);
  let img = dialog.locator("img.full-photo");
  await loaded(img);
  let shown = await img.boundingBox();
  expect(shown.height).toBeGreaterThan(frame.height * 0.6);
  expect(shown.y + shown.height).toBeLessThanOrEqual(frame.height);
  expect(shown.width).toBeLessThan(shown.height);
  await page.keyboard.press("Escape");
  // The small file: its own size at most.
  await thumbs.nth(1).click();
  dialog = await open(page);
  img = dialog.locator("img.full-photo");
  expect(await img.getAttribute("src")).toContain(ids[1]);
  await loaded(img);
  shown = await img.boundingBox();
  expect(shown.width).toBeLessThanOrEqual(641);
  expect(shown.height).toBeLessThanOrEqual(421);
  await page.keyboard.press("Escape");
  // The transparent one keeps its alpha: the file is not flattened.
  await thumbs.nth(2).click();
  dialog = await open(page);
  img = dialog.locator("img.full-photo");
  expect(await img.getAttribute("src")).toContain(ids[2]);
  await loaded(img);
  const alpha = await img.evaluate((e) => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const context = canvas.getContext("2d");
    context.drawImage(e, 0, 0, 4, 4);
    return context.getImageData(1, 1, 1, 1).data[3];
  });
  expect(alpha).toBeLessThan(255);
  await page.keyboard.press("Escape");
  // Opened again after another choice, the window shows that one.
  await thumbs.nth(0).click();
  dialog = await open(page);
  expect(await dialog.locator("img.full-photo").getAttribute("src")).toContain(
    ids[0],
  );
});

test("a slow file does not collapse the window; a private bike's photo is shown to its owner only", async ({
  page,
  browser,
  isMobile,
}) => {
  await member(page, "Медленный");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bike = await bikeWith(page, [await picture(2400, 1600)], {
    is_public: false,
    name: "Закрытый",
  });
  const url = "/api/photos/" + bike.photos[0].id;
  // The photo is late: the window is already its size.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**" + url, async (route) => {
    if (route.request().url().includes("width=")) return route.continue();
    await held;
    await route.continue();
  });
  await page.goto("/b/" + bike.share_id);
  const dialog = await open(page);
  const early = await dialog.boundingBox();
  expect(early.height).toBeGreaterThan(300);
  if (!isMobile) expect(early.width).toBeGreaterThanOrEqual(520);
  release();
  await loaded(dialog.locator("img.full-photo"));
  expect((await dialog.boundingBox()).width).toBeGreaterThanOrEqual(
    early.width - 1,
  );
  await page.keyboard.press("Escape");
  // Nobody else gets the private file by its address.
  const stranger = await browser.newContext({ baseURL: origin });
  try {
    expect((await stranger.request.get(url)).status()).toBeGreaterThanOrEqual(
      400,
    );
  } finally {
    await stranger.close();
  }
});

test("a file that fails to load keeps the window and says so", async ({
  page,
}) => {
  await member(page, "Отказ");
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A photo of its own, never loaded before: a browser may keep a loaded file
  // and not ask for it again, so the refusal is there from the first request.
  const bike = await bikeWith(page, [await picture(2400, 1600)]);
  await page.route("**/api/photos/" + bike.photos[0].id, (route) =>
    route.request().url().includes("width=") ? route.continue() : route.abort(),
  );
  await page.goto("/b/" + bike.share_id);
  const dialog = await open(page);
  await expect(dialog.locator(".photo-empty")).toBeVisible();
  expect((await dialog.boundingBox()).height).toBeGreaterThan(300);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
