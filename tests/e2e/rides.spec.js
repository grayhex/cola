import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import sharp from "sharp";
import pg from "pg";
import { mapDefaults } from "../../lib/map-settings.js";
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
  await registerVerified(page.request, {
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
  // The profile comes as server HTML, and a click that lands before
  // hydration does nothing (seen in WebKit in CI): click until the tab is on.
  // A hydration error loses clicks too, so it fails the test by name.
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/u/" + data.rides[0].author.username);
  const ridesTab = page
    .locator("main")
    .getByRole("button", { name: "Покатушки", exact: true });
  await expect(async () => {
    await ridesTab.click();
    await expect(ridesTab).toHaveAttribute("aria-pressed", "true", {
      timeout: 1000,
    });
  }).toPass({ timeout: 15000 });
  await expect(page.locator(".ride-card")).toHaveCount(1);
  expect(
    errors.filter((e) => /hydrat|did not match|#41[89]|#42[1-5]/i.test(e)),
  ).toEqual([]);
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
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  try {
    // Exercise the object-valued raster style, regardless of settings left by
    // other UI fixtures or the harness MAP_STYLE_URL fallback.
    await db.query(
      "UPDATE site_settings SET value=jsonb_set(value,'{map}',$1::jsonb) WHERE id=1",
      [JSON.stringify(mapDefaults)],
    );
    const base = process.env.TEST_ORIGIN || "http://localhost:3100",
      nonce = randomUUID().slice(0, 8);
    let releaseTiles;
    let requestedTiles = false;
    const tileGate = new Promise((resolve) => {
      releaseTiles = resolve;
    });
    await registerVerified(page.request, {
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
    await expect(page.locator(".ride-map.ready")).toBeVisible({
      timeout: 15000,
    });
    expect((await frame.boundingBox()).height).toBe(previewHeight);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    const canvas = await page.locator(".maplibregl-canvas").elementHandle();
    // Readiness itself re-renders the map. A fresh raster style object must not
    // tear it down, even before any user interaction or scroll (#140).
    await page.waitForTimeout(300);
    await expect(page.locator(".ride-map.ready")).toBeVisible();
    expect(await canvas.evaluate((el) => el.isConnected)).toBe(true);
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
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    await db.end();
  }
});

test("FIT upload: export hint, heart rate hidden until the owner shows it", async ({
  page,
  browser,
}) => {
  const nonce = randomUUID().slice(0, 8),
    base = process.env.TEST_ORIGIN || "http://localhost:3100";
  await registerVerified(page.request, {
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
