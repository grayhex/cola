import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #370: taking the backdrop off a photo. The window says what the method is
// for, shows the picture before and after at one scale, and leaves the choice
// to the owner; closing, cancelling and every failure leave the photo alone; a
// version taken has a new ID everywhere; the original comes back.
async function member(page, label) {
  const suffix = randomUUID();
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "background-secret-123",
    },
  });
  expect(response.status()).toBe(201);
}
// A bike on a white studio backdrop: a dark wheel, a red body.
async function studio(width = 1000, height = 700) {
  const data = Buffer.alloc(width * height * 3, 255);
  const paint = (x, y, r, g, b) => {
    const i = (y * width + x) * 3;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  const cx = width / 2,
    cy = height / 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 150) paint(x, y, 190, 30, 30);
      else if (d <= 250 && d >= 220) paint(x, y, 40, 40, 44);
    }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
const gradient = () =>
  sharp({
    create: { width: 1000, height: 700, channels: 3, background: "#6f7768" },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><defs><linearGradient id="g"><stop offset="0" stop-color="#101820"/><stop offset="1" stop-color="#f0e0c0"/></linearGradient></defs><rect width="1000" height="700" fill="url(#g)"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
async function bikeWith(page, pictures) {
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Без фона",
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
  for (const data of pictures) {
    const sent = await page.request.post(`/api/bikes/${id}/photos`, {
      headers: { origin, "Content-Type": "image/png" },
      data,
    });
    expect(sent.status()).toBe(201);
  }
  return read(page, id);
}
const read = async (page, id) =>
  (await (await page.request.get("/api/bikes/" + id)).json()).bike;
const controlOf = (scope) =>
  scope.getByRole("group", { name: "Фотографии велосипеда" });
const menuOf = (scope) =>
  controlOf(scope).getByRole("button", { name: /: действия/ });
const windowOf = (page) => page.getByRole("dialog", { name: "Удалить фон" });
async function openRemoval(page, scope = page) {
  await menuOf(scope).click();
  await scope.getByRole("button", { name: "Удалить фон", exact: true }).click();
  const dialog = windowOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}
const startOf = (dialog) =>
  dialog.getByRole("button", { name: "Удалить фон", exact: true });
const decoded = async (response) => {
  const { data, info } = await sharp(await response.body())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    alpha: (x, y) => data[(y * info.width + x) * 4 + 3],
    width: info.width,
  };
};

test("bike page: the window explains, compares at one scale, and the owner takes or keeps; the new version is new everywhere and goes back", async ({
  page,
}, info) => {
  await member(page, "Page");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bike = await bikeWith(page, [await studio(), await gradient()]);
  const first = bike.photos.find((photo) => photo.is_cover);
  const originalBytes = await (
    await page.request.get("/api/photos/" + first.id)
  ).body();
  await page.goto("/b/" + bike.share_id);

  // Before anything: what the method is for, in the words of the task.
  const dialog = await openRemoval(page);
  await expect(dialog).toContainText(
    "Лучше подходит для каталожных и студийных фото на однотонном фоне. Проверьте, что детали велосипеда сохранились.",
  );
  await expect(startOf(dialog)).toBeFocused();
  // A window, not a strip of the page: centred, inside the screen.
  const frame = await dialog.boundingBox();
  const screen = page.viewportSize();
  expect(Math.abs(frame.x + frame.width / 2 - screen.width / 2)).toBeLessThan(
    2,
  );
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(screen.width);
  await page.screenshot({
    path: info.outputPath("background-intro.png"),
    animations: "disabled",
  });

  // The try, and its result: two pictures of one size, the cut one on a
  // backdrop that shows transparency.
  await startOf(dialog).click();
  const before = dialog.getByRole("img", { name: "Фото до обработки" });
  const after = dialog.getByRole("img", { name: "Фото без фона" });
  await expect(after).toBeVisible();
  await expect
    .poll(() => after.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect
    .poll(() => before.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Применить", exact: true }),
  ).toBeFocused();
  const boxes = [await before.boundingBox(), await after.boundingBox()];
  expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(1.5);
  expect(Math.abs(boxes[0].height - boxes[1].height)).toBeLessThan(1.5);
  await expect(dialog).toContainText(/Фон убран с \d+ % кадра/);
  const previewUrl = await after.getAttribute("src");
  expect(previewUrl).toMatch(/^\/api\/bikes\/previews\/[0-9a-f-]{36}$/);
  const cut = await decoded(await page.request.get(previewUrl));
  expect(cut.alpha(4, 4)).toBe(0);
  expect(cut.alpha(cut.width >> 1, 350)).toBe(255);

  // Backdrops: checkerboard, light, dark; the choice shows on the picture.
  const stage = (kind) => dialog.locator(`[data-backdrop="${kind}"]`);
  await expect(stage("checker")).toBeVisible();
  await dialog.getByRole("radio", { name: "Тёмная" }).check();
  await expect(stage("dark")).toBeVisible();
  const dark = await stage("dark").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await dialog.getByRole("radio", { name: "Светлая" }).check();
  const light = await stage("light").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(light).not.toBe(dark);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`background-result-${theme}.png`),
      animations: "disabled",
    });
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
  }
  expect(await pageOverflow(page)).toBeNull();

  // «Оставить исходное»: nothing changes, and the preview is let go.
  await dialog.getByRole("button", { name: "Оставить исходное" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(page, bike.id)).photos.map((p) => p.id)).toEqual(
    bike.photos.map((p) => p.id),
  );
  await expect
    .poll(async () => (await page.request.get(previewUrl)).status())
    .toBe(404);
  await expect(menuOf(page)).toBeFocused();

  // Escape is the same: the photo stays as it was.
  const again = await openRemoval(page);
  await startOf(again).click();
  await expect(
    again.getByRole("button", { name: "Применить", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(again).toHaveCount(0);
  expect((await read(page, bike.id)).photos[0].id).toBe(first.id);

  // Take it. A second press while it is applied does not make a second version.
  const puts = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/background"))
      puts.push(request.url());
  });
  const taking = await openRemoval(page);
  await startOf(taking).click();
  const apply = taking.getByRole("button", { name: "Применить", exact: true });
  await expect(apply).toBeEnabled();
  await apply.dblclick();
  await expect(taking).toHaveCount(0);
  expect(puts).toHaveLength(1);
  const now = await read(page, bike.id);
  expect(now.photos).toHaveLength(2);
  const version = now.photos.find((photo) => photo.is_cover);
  expect(version.id).not.toBe(first.id);
  expect(version.has_original).toBe(true);
  expect(now.photos.find((photo) => !photo.is_cover).has_original).toBe(false);

  // Every view shows the new version: the big picture, the thumbnails, the
  // control; the old ID is gone from the media route.
  await expect(page.locator(".photo-stage img")).toHaveAttribute(
    "src",
    new RegExp(version.id),
  );
  await expect(page.locator(".gallery .thumb img").first()).toHaveAttribute(
    "src",
    new RegExp(version.id),
  );
  await expect(
    page.getByText("Фон удалён. Исходное фото сохранено.").first(),
  ).toBeVisible();
  expect((await page.request.get("/api/photos/" + first.id)).status()).toBe(
    404,
  );
  const bigger = await page.request.get(`/api/photos/${version.id}`);
  expect((await sharp(await bigger.body()).metadata()).hasAlpha).toBe(true);
  const small = await page.request.get(`/api/photos/${version.id}?width=320`);
  expect((await sharp(await small.body()).metadata()).hasAlpha).toBe(true);
  // Transparent: the frame shows its own surface, no backdrop is baked in.
  expect(
    await page
      .locator(".photo-stage")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");

  // A photo that is a cut-out offers the way back, not the removal again.
  await menuOf(page).click();
  await expect(
    page.getByRole("button", { name: "Удалить фон", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Вернуть исходное фото", exact: true })
    .click();
  await expect(
    page.getByText("Исходное фото возвращено").first(),
  ).toBeVisible();
  const back = await read(page, bike.id);
  const returned = back.photos.find((photo) => photo.is_cover);
  expect(returned.id).not.toBe(version.id);
  expect(returned.id).not.toBe(first.id);
  expect(returned.has_original).toBe(false);
  const restored = await (
    await page.request.get("/api/photos/" + returned.id)
  ).body();
  expect(restored.equals(originalBytes)).toBe(true);
  expect((await page.request.get("/api/photos/" + version.id)).status()).toBe(
    404,
  );
  await menuOf(page).click();
  await expect(
    page.getByRole("button", { name: "Удалить фон", exact: true }),
  ).toBeVisible();
});

test("bike page: a refusal, a timeout, a lost connection, a stale photo and a cancel leave the photo alone, and a retry works", async ({
  page,
}) => {
  await member(page, "Refusals");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bike = await bikeWith(page, [await studio(), await gradient()]);
  const [lead] = bike.photos;
  await page.goto("/b/" + bike.share_id);
  const unchanged = async () =>
    expect((await read(page, bike.id)).photos.map((p) => p.id)).toEqual(
      bike.photos.map((p) => p.id),
    );

  // A picture that is no plain backdrop: the reason, no retry that would not help.
  await page.locator(".gallery .thumb").nth(1).click();
  await expect(menuOf(page)).toHaveAccessibleName(/^Фото 2 из 2/);
  let dialog = await openRemoval(page);
  await startOf(dialog).click();
  await expect(dialog.getByRole("alert")).toContainText("Фон не однотонный");
  await expect(dialog.getByRole("button", { name: "Повторить" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await unchanged();

  // The server's own time limit, then a retry that goes through.
  await page.locator(".gallery .thumb").nth(0).click();
  let attempts = 0;
  await page.route("**/photos/*/background", async (route) => {
    if (route.request().method() === "POST" && attempts++ === 0)
      return route.fulfill({
        status: 504,
        json: {
          error: "Обработка заняла слишком много времени. Фото не изменилось.",
          reason: "timeout",
        },
      });
    return route.fallback();
  });
  dialog = await openRemoval(page);
  await startOf(dialog).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Обработка заняла слишком много времени",
  );
  await unchanged();
  await dialog.getByRole("button", { name: "Повторить" }).click();
  await expect(
    dialog.getByRole("button", { name: "Применить", exact: true }),
  ).toBeVisible();
  await unchanged();
  await dialog.getByRole("button", { name: "Оставить исходное" }).click();
  await page.unroute("**/photos/*/background");

  // The connection is lost.
  await page.route("**/photos/*/background", (route) => route.abort());
  dialog = await openRemoval(page);
  await startOf(dialog).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Не удалось связаться с сайтом",
  );
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.unroute("**/photos/*/background");
  await unchanged();

  // A cancel while it works: the window is gone, the photo is as it was, and
  // asking again starts from the beginning.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/photos/*/background", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    await route.fallback().catch(() => {});
  });
  dialog = await openRemoval(page);
  await startOf(dialog).click();
  await expect(dialog.getByRole("status")).toContainText("Убираем фон");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  release();
  await page.unroute("**/photos/*/background");
  await unchanged();
  dialog = await openRemoval(page);
  await expect(startOf(dialog)).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();

  // The photo changed while the preview waited: the apply is refused, the
  // window stays with the reason, and the photo is untouched.
  dialog = await openRemoval(page);
  await startOf(dialog).click();
  await expect(
    dialog.getByRole("button", { name: "Применить", exact: true }),
  ).toBeVisible();
  await page.route("**/photos/*/background", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          json: {
            error:
              "Фотография изменилась или удалена, пока шла обработка. Удалите фон ещё раз.",
            reason: "stale",
          },
        })
      : route.fallback(),
  );
  await dialog.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Фотография изменилась или удалена",
  );
  await expect(
    dialog.getByRole("button", { name: "Применить", exact: true }),
  ).toBeEnabled();
  await unchanged();
  await page.unroute("**/photos/*/background");
  await dialog.getByRole("button", { name: "Оставить исходное" }).click();
  await expect(dialog).toHaveCount(0);
  await unchanged();
  expect((await read(page, bike.id)).photos[0].id).toBe(lead.id);
});

test("wizard: a chosen file and a found photo are cleared in the draft, go back to the original, and reach the bike with their transparency", async ({
  page,
}, info) => {
  await member(page, "Wizard");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const offered = randomUUID();
  await page.route("**/api/bikes/photo-candidates/*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ contentType: "image/png", body: dot })
      : route.fallback(),
  );
  await page.route("**/api/bikes/photo-search", (route) =>
    route.fulfill({
      json: {
        photos: [{ id: offered, sourceUrl: "https://shop.example/" + offered }],
      },
    }),
  );
  // The offer is not the resolver's here: the try is made of a real picture
  // by the site's own preview of a file, and the answer says it is the offer's.
  await page.route(
    "**/api/bikes/photo-candidates/*/background",
    async (route) => {
      const made = await page.request.post("/api/bikes/previews", {
        headers: { origin, "Content-Type": "image/png" },
        data: await studio(),
      });
      const { preview } = await made.json();
      await route.fulfill({
        status: 201,
        json: {
          preview: {
            ...preview,
            beforeUrl: "/api/bikes/photo-candidates/" + offered,
          },
        },
      });
    },
  );
  const imports = [];
  await page.route("**/api/bikes/*/photos/import", async (route) => {
    const id = route.request().url().split("/").at(-3);
    imports.push(route.request().postDataJSON());
    const sent = await page.request.post(`/api/bikes/${id}/photos`, {
      headers: { origin, "Content-Type": "image/png" },
      data: await studio(1000, 700),
    });
    await route.fulfill({
      status: 201,
      json: { count: 1, ids: [(await sent.json()).id] },
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
  await wizard.locator(".photo-candidates input").check();
  const chooser = page.waitForEvent("filechooser");
  await controlOf(wizard)
    .getByRole("button", { name: "Добавить фото", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "studio.png",
    mimeType: "image/png",
    buffer: await studio(),
  });
  const thumbs = wizard.locator(".wizard-draft-photos button.thumb");
  await expect(thumbs).toHaveCount(2);

  // The file (the second of the draft): cleared, then back, then cleared again.
  await thumbs.nth(1).click();
  const own = await openRemoval(page, wizard);
  await startOf(own).click();
  await expect(
    own.getByRole("button", { name: "Применить", exact: true }),
  ).toBeVisible();
  // The window lies inside the wizard's form: Enter on its radio submits nothing.
  const submitted = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/bikes/wizard")) submitted.push(request);
  });
  await own.getByRole("radio", { name: "Тёмная" }).focus();
  await page.keyboard.press("Enter");
  await expect(own.getByRole("radio", { name: "Тёмная" })).toBeFocused();
  expect(submitted).toHaveLength(0);
  await expect(wizard).toBeVisible();
  await own.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(own).toHaveCount(0);
  await expect(thumbs).toHaveCount(2);
  await expect(menuOf(wizard)).toHaveAccessibleName(/^Фото 2 из 2/);
  const ownThumb = thumbs.nth(1).locator("img");
  const chosenSrc = await ownThumb.getAttribute("src");
  await menuOf(wizard).click();
  await expect(
    wizard.getByRole("button", { name: "Удалить фон", exact: true }),
  ).toHaveCount(0);
  await wizard
    .getByRole("button", { name: "Вернуть исходное фото", exact: true })
    .click();
  await expect(ownThumb).not.toHaveAttribute("src", chosenSrc);
  await menuOf(wizard).click();
  await expect(
    wizard.getByRole("button", { name: "Вернуть исходное фото", exact: true }),
  ).toHaveCount(0);
  await wizard
    .getByRole("button", { name: "Удалить фон", exact: true })
    .click();
  const again = windowOf(page);
  await startOf(again).click();
  await again.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(again).toHaveCount(0);

  // The found photo (the first): cleared, with the source kept for the import.
  await thumbs.nth(0).click();
  const found = await openRemoval(page, wizard);
  await startOf(found).click();
  await expect(
    found.getByRole("img", { name: "Фото до обработки" }),
  ).toHaveAttribute("src", "/api/bikes/photo-candidates/" + offered);
  await page.screenshot({
    path: info.outputPath("background-wizard.png"),
    animations: "disabled",
  });
  await found.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(found).toHaveCount(0);
  await expect(thumbs.nth(0).locator("img")).toHaveAttribute(
    "src",
    /^\/api\/bikes\/previews\//,
  );
  // Back to the found original, and cleared once more.
  await menuOf(wizard).click();
  const forgotten = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      request.url().includes("/api/bikes/previews/"),
  );
  await wizard
    .getByRole("button", { name: "Вернуть исходное фото", exact: true })
    .click();
  await forgotten;
  await expect(thumbs.nth(0).locator("img")).toHaveAttribute(
    "src",
    "/api/bikes/photo-candidates/" + offered,
  );
  await menuOf(wizard).click();
  await wizard
    .getByRole("button", { name: "Удалить фон", exact: true })
    .click();
  const second = windowOf(page);
  await startOf(second).click();
  await second.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(second).toHaveCount(0);
  const planted = (await thumbs.nth(0).locator("img").getAttribute("src"))
    .split("/")
    .at(-1);

  // Save: the bike is created only now; the found photo is imported as its
  // cut-out, and the file is sent as the cut-out.
  await wizard
    .getByRole("button", { name: /^(Далее|Продолжить вручную)$/ })
    .click();
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).toHaveCount(0, { timeout: 30_000 });
  expect(imports).toEqual([
    { ids: [offered], cutouts: { [offered]: planted } },
  ]);
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  const saved = bikes.find((item) => item.model === "Domane");
  const { bike } = await (
    await page.request.get("/api/bikes/" + saved.id)
  ).json();
  expect(bike.photos).toHaveLength(2);
  // The file went as the picture without its backdrop (transparent), and no
  // original of a draft is kept; the found photo's import is the server's own
  // (tests/photo-background-http.js), here it is a stand-in.
  const transparent = [];
  for (const photo of bike.photos) {
    expect(photo.has_original).toBe(false);
    const bytes = await (
      await page.request.get("/api/photos/" + photo.id)
    ).body();
    transparent.push((await sharp(bytes).metadata()).hasAlpha === true);
  }
  expect(transparent.filter(Boolean)).toHaveLength(1);
});
