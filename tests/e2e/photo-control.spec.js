import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #370: the photos of a bike have one control — add, make the cover, delete —
// under the picture of the bike page and in the wizard. Nothing sits on the
// photograph but the passive mark of the cover; adding works with an empty
// gallery, the rest acts on the photo that is selected and says which one.
async function member(page, label) {
  const suffix = randomUUID();
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "photo-control-secret-123",
    },
  });
  expect(response.status()).toBe(201);
}
const picture = (width, height, color) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
async function bikeWithPhotos(page, sizes) {
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Фото-контрол",
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  for (const [width, height, color] of sizes) {
    const sent = await page.request.post(`/api/bikes/${id}/photos`, {
      headers: { origin, "Content-Type": "image/png" },
      data: await picture(width, height, color),
    });
    expect(sent.status()).toBe(201);
  }
  const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
  return bike;
}
const controlOf = (scope) =>
  scope.getByRole("group", { name: "Фотографии велосипеда" });
const addOf = (scope) =>
  controlOf(scope).getByRole("button", { name: "Добавить фото", exact: true });
const menuOf = (scope) =>
  controlOf(scope).getByRole("button", { name: /: действия$/ });

test("bike page: one control under the picture; add works on an empty gallery; cover and delete act on the selected photo", async ({
  page,
  browser,
}, info) => {
  await member(page, "Control");
  await page.emulateMedia({ reducedMotion: "reduce" });
  let bike = await bikeWithPhotos(page, []);
  const path = "/b/" + bike.share_id;

  // An empty gallery: adding is there, the actions of a photo are not.
  await page.goto(path);
  await expect(controlOf(page)).toBeVisible();
  await expect(addOf(page)).toBeEnabled();
  await expect(
    controlOf(page).getByRole("button", {
      name: "Действия с фото недоступны: нет фотографии",
    }),
  ).toBeDisabled();
  await expect(menuOf(page)).toHaveCount(0);
  // The old place of «add photo», the owner's bar, does not repeat it.
  await expect(
    page
      .getByRole("group", { name: "Управление велосипедом" })
      .getByRole("button", { name: "Добавить фото", exact: true }),
  ).toHaveCount(0);

  // Three photos of different sizes: the first one is the cover.
  bike = await bikeWithPhotos(page, [
    [1000, 700, "#6f7768"],
    [1100, 700, "#8a6f68"],
    [1200, 700, "#68728a"],
  ]);
  await page.goto("/b/" + bike.share_id);
  const ids = bike.photos.map((photo) => photo.id);
  const coverId = bike.photos.find((photo) => photo.is_cover).id;
  await expect(menuOf(page)).toHaveAccessibleName(
    `Фото 1 из 3, обложка: действия`,
  );
  // Nothing on the photograph but the passive mark: no cover or delete buttons.
  const stage = page.locator(".photo-stage");
  await expect(stage.getByRole("button")).toHaveCount(1);
  await expect(stage.locator(".photo-cover-mark")).toHaveText("Обложка");
  await menuOf(page).click();
  await expect(
    page.getByRole("button", { name: "Это обложка", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Удалить фото", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menuOf(page)).toBeFocused();

  // The second thumbnail is selected: the control follows it, and it is no
  // cover yet, so the mark in the frame is gone.
  await page.locator(".gallery .thumb").nth(1).click();
  await expect(menuOf(page)).toHaveAccessibleName("Фото 2 из 3: действия");
  await expect(stage.locator(".photo-cover-mark")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("photo-control-bike-page.png"),
    animations: "disabled",
  });
  await menuOf(page).click();
  await page.getByRole("button", { name: "Сделать обложкой" }).click();
  await expect
    .poll(async () => {
      const { bike: now } = await (
        await page.request.get("/api/bikes/" + bike.id)
      ).json();
      return now.photos.find((photo) => photo.is_cover).id;
    })
    .not.toBe(coverId);
  const { bike: covered } = await (
    await page.request.get("/api/bikes/" + bike.id)
  ).json();
  expect(covered.photos.find((photo) => photo.is_cover).id).toBe(ids[1]);
  // The cover leads the gallery, so the same photo is now the first of three.
  await expect(stage.locator(".photo-cover-mark")).toHaveText("Обложка");
  await expect(menuOf(page)).toHaveAccessibleName(
    "Фото 1 из 3, обложка: действия",
  );

  // Delete asks first; cancel keeps the photo, confirm removes this one.
  await menuOf(page).click();
  await page.getByRole("button", { name: "Удалить фото", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Удалить фотографию?" });
  await ask.getByRole("button", { name: "Отмена" }).click();
  await expect(ask).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/bikes/" + bike.id)).json()).bike
      .photos,
  ).toHaveLength(3);
  await menuOf(page).click();
  await page.getByRole("button", { name: "Удалить фото", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Удалить фотографию?" })
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/bikes/" + bike.id)).json()).bike
          .photos.length,
    )
    .toBe(2);
  await expect(menuOf(page)).toHaveAccessibleName(/^Фото 1 из 2/);

  // Both themes and the narrow screen: accessible, nothing overflows.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect(
      (await new AxeBuilder({ page }).include("[data-photo-control]").analyze())
        .violations,
    ).toEqual([]);
  }
  expect(await pageOverflow(page)).toBeNull();

  // A reader sees the photographs, not the control.
  const reader = await browser.newContext({ baseURL: origin });
  try {
    const guest = await reader.newPage();
    await guest.goto(path);
    await expect(guest.locator(".photo-stage")).toBeVisible();
    await expect(controlOf(guest)).toHaveCount(0);
  } finally {
    await reader.close();
  }
});

test("wizard: the control acts on the draft; the cover chosen there is the cover of the saved bike, whatever the order of the files", async ({
  page,
}, info) => {
  await member(page, "Draft");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await wizard.getByLabel("Марка", { exact: true }).fill("Cube");
  await wizard.getByLabel("Модель", { exact: true }).fill("Aim");
  await wizard.getByLabel("Год", { exact: true }).fill("2020");
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("mtb");

  // No photo yet: adding is there, the actions are not.
  await expect(addOf(wizard)).toBeEnabled();
  await expect(menuOf(wizard)).toHaveCount(0);
  const thumbs = wizard.locator(".wizard-draft-photos button.thumb");
  await expect(thumbs).toHaveCount(0);

  // Three files, each of its own width; the button opens the file input.
  const chooser = page.waitForEvent("filechooser");
  await addOf(wizard).click();
  await (
    await chooser
  ).setFiles([
    {
      name: "first.png",
      mimeType: "image/png",
      buffer: await picture(1000, 700, "#6f7768"),
    },
    {
      name: "second.png",
      mimeType: "image/png",
      buffer: await picture(1100, 700, "#8a6f68"),
    },
    {
      name: "third.png",
      mimeType: "image/png",
      buffer: await picture(1200, 700, "#68728a"),
    },
  ]);
  await expect(thumbs).toHaveCount(3);
  // Without a choice the first one leads; the control says which is selected.
  await expect(menuOf(wizard)).toHaveAccessibleName(
    "Фото 1 из 3, обложка: действия",
  );
  await expect(thumbs.nth(0)).toHaveAccessibleName(/first\.png, обложка/);

  // The third one is selected and made the cover; the mark moves to it.
  await thumbs.nth(2).click();
  await expect(menuOf(wizard)).toHaveAccessibleName("Фото 3 из 3: действия");
  await menuOf(wizard).click();
  await wizard.getByRole("button", { name: "Сделать обложкой" }).click();
  await expect(thumbs.nth(2)).toHaveAccessibleName(/third\.png, обложка/);
  await expect(thumbs.nth(0)).not.toHaveAccessibleName(/обложка/);
  await expect(menuOf(wizard)).toHaveAccessibleName(
    "Фото 3 из 3, обложка: действия",
  );
  await page.screenshot({
    path: info.outputPath("photo-control-wizard.png"),
    animations: "disabled",
  });

  // Deleting another photo of the draft keeps the cover; the draft only.
  await thumbs.nth(1).click();
  await menuOf(wizard).click();
  await wizard.getByRole("button", { name: "Удалить фото" }).click();
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.nth(1)).toHaveAccessibleName(/third\.png, обложка/);

  // Going back and forward keeps the draft, its selection and the cover.
  await wizard.getByRole("button", { name: "Назад", exact: true }).click();
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.nth(1)).toHaveAccessibleName(/third\.png, обложка/);

  // Save: the bike has two photos, and the cover is the third file (1200 px).
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).toHaveCount(0, { timeout: 30_000 });
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  const saved = bikes.find((item) => item.model === "Aim");
  const { bike } = await (
    await page.request.get("/api/bikes/" + saved.id)
  ).json();
  expect(bike.photos).toHaveLength(2);
  const cover = bike.photos.find((photo) => photo.is_cover);
  const bytes = await (
    await page.request.get("/api/photos/" + cover.id)
  ).body();
  expect((await sharp(bytes).metadata()).width).toBe(1200);
});

test("wizard: found and own photos share one draft; a found photo that is not the first can be the cover", async ({
  page,
}) => {
  await member(page, "Found");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const offered = [randomUUID(), randomUUID()];
  const widths = { [offered[0]]: 1000, [offered[1]]: 1100 };
  await page.route("**/api/bikes/photo-candidates/**", (route) =>
    route.fulfill({ contentType: "image/png", body: dot }),
  );
  await page.route("**/api/bikes/photo-search", (route) =>
    route.fulfill({
      json: {
        photos: offered.map((id) => ({
          id,
          sourceUrl: "https://shop.example/" + id,
        })),
      },
    }),
  );
  // The import itself is the site's own: here the pictures are taken from the
  // stand-in answer and stored as the real upload would, in the order asked.
  await page.route("**/api/bikes/*/photos/import", async (route) => {
    const id = route.request().url().split("/").at(-3);
    const { ids } = route.request().postDataJSON();
    const made = [];
    for (const candidate of ids) {
      const sent = await page.request.post(`/api/bikes/${id}/photos`, {
        headers: { origin, "Content-Type": "image/png" },
        data: await picture(widths[candidate], 700, "#6f7768"),
      });
      made.push((await sent.json()).id);
    }
    await route.fulfill({
      status: 201,
      json: { count: made.length, ids: made },
    });
  });
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await wizard
    .getByLabel("Модель, год и комплектация", { exact: true })
    .fill("Trek Domane 2023");
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");
  const offers = wizard.locator(".photo-candidates input");
  await expect(offers).toHaveCount(2);
  await offers.nth(0).check();
  await offers.nth(1).check();
  const chooser = page.waitForEvent("filechooser");
  await addOf(wizard).click();
  await (
    await chooser
  ).setFiles({
    name: "own.png",
    mimeType: "image/png",
    buffer: await picture(1200, 700, "#68728a"),
  });
  const thumbs = wizard.locator(".wizard-draft-photos button.thumb");
  await expect(thumbs).toHaveCount(3);
  await expect(menuOf(wizard)).toHaveAccessibleName(
    "Фото 1 из 3, обложка: действия",
  );
  // The second found photo is made the cover.
  await thumbs.nth(1).click();
  await menuOf(wizard).click();
  await wizard.getByRole("button", { name: "Сделать обложкой" }).click();
  await expect(menuOf(wizard)).toHaveAccessibleName(
    "Фото 2 из 3, обложка: действия",
  );
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).toHaveCount(0, { timeout: 30_000 });
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  const saved = bikes.find((item) => item.model === "Domane");
  const { bike } = await (
    await page.request.get("/api/bikes/" + saved.id)
  ).json();
  expect(bike.photos).toHaveLength(3);
  const cover = bike.photos.find((photo) => photo.is_cover);
  const bytes = await (
    await page.request.get("/api/photos/" + cover.id)
  ).body();
  expect((await sharp(bytes).metadata()).width).toBe(1100);
});
