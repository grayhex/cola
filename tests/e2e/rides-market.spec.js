import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { garminCsv } from "../garmin-fixtures.js";
import { gpx, loop } from "../ride-fixtures.js";
import { parseGpx } from "../../lib/ride-gpx.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const password = "feature-browser-secret-123";
async function register(page) {
  const r = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Feature Rider",
      email: randomUUID() + "@example.test",
      password,
    },
  });
  expect(r.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
async function bike(page) {
  const r = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Test Gravel",
      brand: "Giant",
      model: "Contend",
      year: 2026,
      category: "gravel",
      description: "Test bicycle",
      color: "",
      size: "M",
      weight: 9,
      is_public: true,
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id;
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("Garmin import without track, chosen fields, GPX mismatch and future planning", async ({
  page,
}, info) => {
  await register(page);
  await bike(page);
  await page.goto("/account?tab=rides&action=import");
  const form = page.getByRole("region", { name: "Импорт Garmin CSV" });
  await expect(form).toBeVisible();
  await form.getByLabel("Часовой пояс дат в CSV").selectOption("180");
  const m = parseGpx(gpx([loop])).metrics,
    clock = (s) =>
      [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
        .map((v) => String(v).padStart(2, "0"))
        .join(":");
  await form.getByLabel("CSV Garmin", { exact: false }).setInputFiles({
    name: "Activities.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      garminCsv({
        Distance: (m.distanceM / 1000).toFixed(3),
        Time: clock(m.elapsedTimeS),
        "Elapsed Time": clock(m.elapsedTimeS),
      }),
    ),
  });
  await expect(form.getByText("Поездки · 1 из 1")).toBeVisible();
  await form.getByLabel("Максимальная мощность", { exact: true }).check();
  await form.getByLabel("Опубликовать поездки").check();
  await form.getByRole("button", { name: "Импортировать · 1" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Импортировано: 1" }),
  ).toBeVisible();
  const card = page.locator(".ride-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Garmin · без трека");
  await expect(card).toContainText("Максимальная мощность");
  await expect(card.locator(".ride-basemap")).toHaveCount(0);
  await card.getByRole("button", { name: "Изменить" }).click();
  await page.getByLabel("Добавить GPX к поездке").setInputFiles({
    name: "wrong.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx([loop.map((p) => [p[0], p[1], p[2] + 86400, p[3]])]),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Дата или время GPX" }),
  ).toBeVisible();
  await page.getByLabel("Добавить GPX к поездке").setInputFiles({
    name: "matching.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx([loop]),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "GPX проверен" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить покатушку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Запланировать", exact: true })
    .click();
  await page.getByLabel("GPX-файл", { exact: false }).setInputFiles({
    name: "weekend-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: gpx([loop]),
  });
  await expect(
    page.locator(".ride-form .ride-route path").first(),
  ).toBeVisible();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Weekend gravel plan");
  await page
    .getByLabel("Описание — необязательно")
    .fill("Coffee and quiet roads");
  const future = new Date(Date.now() + 172800000).toISOString().slice(0, 16);
  await page.getByLabel("Дата и время старта").fill(future);
  await page.getByLabel("Место встречи").fill("Парк");
  await page.getByLabel("Особенности маршрута").fill("Гравий, Кофе");
  await page.getByLabel("Опубликовать", { exact: true }).check();
  await page
    .getByRole("button", { name: "Сохранить покатушку", exact: true })
    .click();
  await expect(page.locator(".ride-card")).toHaveCount(2);
  await expect(
    page.locator(".ride-card").filter({ hasText: "Weekend gravel plan" }),
  ).toContainText("Планируемая покатушка");
  const saved = await (await page.request.get("/api/rides?own=1")).json();
  const planned = saved.rides.find((r) => r.title === "Weekend gravel plan");
  expect(planned.hasTrack).toBe(true);
  expect(planned.metrics.avgSpeedMps).toBeNull();
  expect(planned.scheduledAt.slice(0, 10)).toBe(future.slice(0, 10));
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("rides-import-planned.png"),
    fullPage: true,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Weekend gravel plan" }),
  ).toBeVisible();
});

test("market publishes images and price, enters home feed, and closes a listing", async ({
  page,
}, info) => {
  await register(page);
  await page.goto("/market/new");
  await page.getByLabel("Название", { exact: true }).fill("Gravel wheelset");
  await page
    .getByLabel("Описание", { exact: true })
    .fill("Tubeless wheels, ready for a new bicycle.");
  await page
    .getByRole("combobox", { name: "Категория", exact: true })
    .selectOption("components");
  await expect(page.getByRole("combobox", { name: "Тип объявления", exact: true })).toHaveValue("sale");
  await expect(page.getByLabel("Валюта", { exact: true })).toHaveCount(0);
  await page.getByLabel("Цена, ₽", { exact: true }).fill("12500");
  await page.getByLabel("Город", { exact: true }).fill("Тестовый город");
  await page.getByLabel("Как с вами связаться").fill("@rider");
  const photo = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#a8b6be" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Добавить фото", { exact: false })
    .setInputFiles({ name: "wheel.png", mimeType: "image/png", buffer: photo });
  await expect(
    page.getByRole("img", { name: "Фото объявления" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Gravel wheelset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Gravel wheelset · фото 1" }),
  ).toBeVisible();
  const url = page.url();
  const share = new URL(url).pathname.split("/").pop();
  const response = await page.request.get("/api/market/public/" + share);
  expect(response.status()).toBe(200);
  expect((await response.json()).listing).toMatchObject({
    listingType: "sale", price: 12500, currency: "RUB", status: "active",
  });
  await expect(page.locator("aside strong")).toHaveText(/^12\s500\s₽$/);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("market-detail.png"),
    fullPage: true,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Gravel wheelset" }),
  ).toBeVisible();
  await page.goto(url);
  await page.getByRole("button", { name: "Отметить проданным" }).click();
  await expect(page.getByText("Объявление закрыто · продано")).toBeVisible();
  await page.goto("/market");
  await expect(
    page.getByRole("heading", { name: "Gravel wheelset" }),
  ).toHaveCount(0);
});

test("OSM thumbnails with Yandex setting, bounded design headings, SVG themes and footer versions", async ({
  page,
  isMobile,
}, info) => {
  const user = await register(page),
    bikeId = await bike(page);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let old;
  try {
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    const site = await (await page.request.get("/api/admin/overview")).json();
    old = site.settings;
    const ids = [];
    for (const color of ["#aabbcc", "#ddeeff"]) {
      const r = await page.request.post("/api/admin/assets?name=animated.svg", {
        headers: { origin, "Content-Type": "image/svg+xml" },
        data: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="${color}"><animate attributeName="opacity" values=".5;1;.5" dur="2s" repeatCount="indefinite"/></circle></svg>`,
        ),
      });
      expect(r.status()).toBe(201);
      ids.push((await r.json()).id);
    }
    const updated = {
      ...old,
      map: { ...old.map, provider: "yandex", publicKey: "test-browser-key" },
      heroAnimationLightId: ids[0],
      heroAnimationDarkId: ids[1],
      heroBackgroundLight: "#f1f7ee",
      heroBackgroundDark: "#202830",
      appVersionLabel: "1.2.test",
      parserVersionLabel: "3.4.test",
    };
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: { value: updated, version: site.settingsVersion },
        })
      ).status(),
    ).toBe(200);
    const preview = await (
      await page.request.post("/api/rides/preview", {
        headers: { origin, "Content-Type": "application/gpx+xml" },
        data: gpx([loop]),
      })
    ).json();
    const saved = await page.request.post("/api/rides", {
      headers: { origin },
      data: {
        previewId: preview.previewId,
        bikeId,
        title: "OSM preview",
        description: "",
        isPublic: true,
        privacyEnabled: false,
        privacyRadiusM: 500,
      },
    });
    expect(saved.status()).toBe(201);
    let tiles = 0,
      sdk = 0;
    const tile = await sharp({
      create: { width: 256, height: 256, channels: 3, background: "#dfe7da" },
    })
      .png()
      .toBuffer();
    await page.route("https://tile.openstreetmap.org/**", (route) => {
      tiles++;
      return route.fulfill({ contentType: "image/png", body: tile });
    });
    page.on("request", (r) => {
      if (r.url().includes("api-maps.yandex.ru")) sdk++;
    });
    await page.goto("/rides");
    await expect(
      page.locator(".ride-card").filter({ hasText: "OSM preview" }),
    ).toBeVisible();
    await expect.poll(() => tiles).toBeGreaterThan(0);
    expect(sdk).toBe(0);
    await page.goto("/admin");
    await expect(
      page.getByRole("tab", { name: "Дизайн", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await expect(page.locator(".admin-title h1")).toBeVisible();
    expect(
      await page
        .locator(".admin-title h1")
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeLessThanOrEqual(34);
    await noOverflow(page);
    await page.goto("/");
    await expect(page.locator("footer")).toContainText(
      "ColaBike 1.2.test · Парсер 3.4.test",
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate((v) => {
        document.documentElement.dataset.theme = v;
        localStorage.setItem("cola:theme", v);
      }, theme);
      if (!isMobile) {
        const visible = page.locator("[data-hero-animation] img:visible");
        await expect(visible).toHaveCount(1);
        await expect(visible).toHaveAttribute(
          "src",
          "/api/assets/" + ids[theme === "light" ? 0 : 1],
        );
      }
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath("home-" + theme + ".png"),
        fullPage: true,
      });
    }
  } finally {
    if (old)
      await db.query(
        "UPDATE site_settings SET value=$1,version=version+1 WHERE id=1",
        [JSON.stringify(old)],
      );
    await db.end();
  }
});

test("component groups follow the screen width until a personal preference is saved", async ({
  page,
}) => {
  await register(page);
  const id = await bike(page);
  expect(
    (
      await page.request.post("/api/bikes/" + id + "/components", {
        headers: { origin },
        data: {
          section: "build",
          category: "Седло",
          name: "Test saddle",
          notes: "",
          price: null,
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/account?tab=bikes&bike=" + id);
  const toggle = page
    .locator(".component-group")
    .filter({ hasText: "Test saddle" })
    .locator(".component-group-toggle");
  // Open on desktop, closed on phones; the toggle still works either way.
  const wide = page.viewportSize().width > 700;
  await expect(toggle).toHaveAttribute("aria-expanded", String(wide));
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(!wide));
  // A saved personal choice wins over the screen width.
  expect(
    (
      await page.request.patch("/api/social/preferences", {
        headers: { origin },
        data: { preferences: { componentsExpanded: !wide } },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", String(!wide));
  await expect(
    page.locator(".compact-part").filter({ hasText: "Test saddle" }),
  ).toBeVisible({ visible: !wide });
});
