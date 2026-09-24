import { testConsents } from "../fixtures/legal.js";
import sharp from "sharp";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { gpx, fit, loop } from "../ride-fixtures.js";
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
});
test("ride upload, SVG, privacy, profile and bike; works without tiles", async ({
  page,
}, info) => {
  await page.route("**/test-map-style.json", (route) => route.abort());
  const nonce = randomUUID().slice(0, 8),
    base = process.env.TEST_ORIGIN || "http://localhost:3100";
  await page.request.post(base + "/api/auth/register", {
    headers: { origin: base },
    data: {
      ...testConsents,
      name: "Ride E2E",
      email: `ride-e2e-${nonce}@example.test`,
      password: "ride-e2e-secret-123",
    },
  });
  const bike = await (
    await page.request.post(base + "/api/bikes", {
      headers: { origin: base },
      data: {
        name: "Giant Tourer GTS",
        brand: "Giant",
        model: "Tourer GTS",
        year: 2024,
        category: "road",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
    })
  ).json();
  await page.goto("/account?tab=rides");
  await page
    .getByRole("button", { name: "Добавить покатушку", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "ride.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx([loop]),
  });
  await expect(page.getByLabel("Название", { exact: true })).toBeVisible();
  await page.getByLabel("Название", { exact: true }).fill("Вечерняя покатушка");
  await page.getByLabel("Опубликовать", { exact: true }).check();
  await page.getByLabel("Скрыть начало и конец маршрута").check();
  await page.getByRole("button", { name: "Сохранить покатушку" }).click();
  await expect(page.locator(".ride-card")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Вечерняя покатушка", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Вечерняя покатушка" }),
  ).toBeVisible();
  await expect(page.locator(".ride-route path").first()).toBeVisible();
  const data = await (await page.request.get(base + "/api/rides?own=1")).json();
  expect(data.rides[0].privacyEnabled).toBe(true);
  expect(data.rides[0].bike.id).toBe(bike.id);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("ride-page.png"),
    fullPage: true,
  });
  await page.goto("/u/" + data.rides[0].author.username);
  await page
    .locator("main")
    .getByRole("button", { name: "Покатушки", exact: true })
    .click();
  await expect(page.locator(".ride-card")).toHaveCount(1);
  await page.goto("/b/" + data.rides[0].bike.shareId);
  await expect(page.locator(".ride-list .ride-card")).toHaveCount(1);
});

test("MapLibre initializes with intercepted OSM tiles, no external traffic", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "WebGL support differs in headless WebKit; mobile fallback is covered",
  );
  const base = process.env.TEST_ORIGIN || "http://localhost:3100",
    nonce = randomUUID().slice(0, 8);
  let releaseTiles;
  let requestedTiles = false;
  const tileGate = new Promise((resolve) => {
    releaseTiles = resolve;
  });
  await page.request.post(base + "/api/auth/register", {
    headers: { origin: base },
    data: {
      ...testConsents,
      name: "Map Test",
      email: "map-" + nonce + "@example.test",
      password: "map-test-secret-123",
    },
  });
  const bike = await (
    await page.request.post(base + "/api/bikes", {
      headers: { origin: base },
      data: {
        name: "Map bike",
        brand: "Giant",
        model: "Tourer",
        year: 2024,
        category: "road",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
    })
  ).json();
  const preview = await (
    await page.request.post(base + "/api/rides/preview", {
      headers: { origin: base },
      data: gpx([loop]),
    })
  ).json();
  const ride = await (
    await page.request.post(base + "/api/rides", {
      headers: { origin: base },
      data: {
        previewId: preview.previewId,
        bikeId: bike.id,
        title: "Local map",
        description: "",
        isPublic: true,
        privacyEnabled: false,
        privacyRadiusM: 500,
      },
    })
  ).json();
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#dae1d4" },
  })
    .png()
    .toBuffer();
  await page.route("https://tile.openstreetmap.org/**", async (route) => {
    requestedTiles = true;
    await tileGate;
    await route.fulfill({ contentType: "image/png", body: tile });
  });
  await page.goto("/r/" + ride.shareId);
  const frame = page.locator(".ride-map-wrap");
  let previewHeight;
  try {
    await expect.poll(() => requestedTiles).toBe(true);
    previewHeight = (await frame.boundingBox()).height;
  } finally {
    releaseTiles();
  }
  await expect(page.locator(".ride-map.ready")).toBeVisible({ timeout: 15000 });
  expect((await frame.boundingBox()).height).toBe(previewHeight);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const canvas = await page.locator(".maplibregl-canvas").elementHandle();
  const chart = page.getByRole("img", {
    name: "График скорости по расстоянию",
  });
  await chart.hover();
  await expect(page.getByRole("region", { name: "Скорость" })).toContainText(
    /на \d+[,.]?\d* км/,
  );
  await page.locator("#discussion").scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await canvas.evaluate((el) => el.isConnected)).toBe(true);
  expect((await frame.boundingBox()).height).toBe(previewHeight);
  await frame.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("ride-map.png"),
    fullPage: true,
  });
});

test("FIT upload: export hint, heart rate hidden until the owner shows it", async ({
  page,
  browser,
}) => {
  const nonce = randomUUID().slice(0, 8),
    base = process.env.TEST_ORIGIN || "http://localhost:3100";
  await page.request.post(base + "/api/auth/register", {
    headers: { origin: base },
    data: {
      ...testConsents,
      name: "FIT E2E",
      email: `fit-e2e-${nonce}@example.test`,
      password: "fit-e2e-secret-123",
    },
  });
  await page.request.post(base + "/api/bikes", {
    headers: { origin: base },
    data: {
      name: "Cube Nuroad",
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
  await page.goto("/account?tab=rides");
  await page
    .getByRole("button", { name: "Загрузить FIT", exact: true })
    .click();
  await page.getByText("Как выгрузить FIT с велокомпьютера").click();
  await expect(page.getByText("Экспорт оригинала").first()).toBeVisible();
  await page.getByLabel("Файл трека", { exact: false }).setInputFiles({
    name: "morning.fit",
    mimeType: "application/octet-stream",
    buffer: fit(loop),
  });
  const picker = page.getByRole("group", { name: "Показывать показатели" });
  await expect(picker.getByLabel("Дистанция", { exact: true })).toBeChecked();
  await expect(
    picker.getByLabel("Средний пульс", { exact: true }),
  ).not.toBeChecked();
  await picker.getByLabel("Средний пульс", { exact: true }).check();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Утро с пульсометром");
  await page.getByLabel("Опубликовать", { exact: true }).check();
  await page.getByRole("button", { name: "Сохранить покатушку" }).click();
  await expect(page.locator(".ride-card")).toHaveCount(1);
  const { rides } = await (
    await page.request.get(base + "/api/rides?own=1")
  ).json();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await guest.goto("/r/" + rides[0].shareId);
  await expect(
    guest.getByRole("heading", { name: "Утро с пульсометром" }),
  ).toBeVisible();
  await expect(guest.getByText("110 уд/мин")).toBeVisible();
  await expect(guest.getByText("Максимальная мощность")).toHaveCount(0);
  await context.close();
});
