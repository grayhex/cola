import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { gpx, loop } from "../ride-fixtures.js";
test("ride upload, SVG, privacy, profile and bike; works without tiles", async ({
  page,
}, info) => {
  await page.route("**/test-map-style.json", (route) => route.abort());
  const nonce = randomUUID().slice(0, 8),
    base = process.env.TEST_ORIGIN || "http://localhost:3100";
  await page.request.post(base + "/api/auth/register", {
    headers: { origin: base },
    data: {
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
  await page.getByRole("button", { name: "Покатушки", exact: true }).click();
  await expect(page.locator(".ride-card")).toHaveCount(1);
  await page.goto("/b/" + data.rides[0].bike.shareId);
  await expect(page.locator(".ride-list .ride-card")).toHaveCount(1);
});

test("MapLibre initializes with local style, with no external tiles", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "WebGL support differs in headless WebKit; mobile fallback is covered",
  );
  const base = process.env.TEST_ORIGIN || "http://localhost:3100",
    nonce = randomUUID().slice(0, 8);
  await page.route("**/test-map-style.json", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#eeeeee" },
          },
        ],
      },
    }),
  );
  await page.request.post(base + "/api/auth/register", {
    headers: { origin: base },
    data: {
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
  await page.goto("/r/" + ride.shareId);
  await expect(page.locator(".ride-map.ready")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("ride-map.png"),
    fullPage: true,
  });
});
