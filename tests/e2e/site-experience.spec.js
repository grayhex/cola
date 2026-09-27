import { test, expect } from "@playwright/test";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("admin publishes a shared animation switch, uploaded Rive, brand/favicon and icon highlight", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  const assets = [];
  let user;
  try {
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Site admin",
        email: randomUUID() + "@site.test",
        password: "site-experience-secret",
      },
    });
    expect(registered.status()).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "Разделы админки" });
    await expect(
      nav.getByRole("button", { name: "Главная", exact: true }),
    ).toHaveCount(0);
    await nav.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await expect(
      page.getByLabel("Тема по умолчанию", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Графика главного блока", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Анимации главной для всех посетителей").check();
    await page
      .getByLabel("Файл: Анимация · слева от заголовка", { exact: true })
      .setInputFiles({
        name: "uploaded-bike.riv",
        mimeType: "application/octet-stream",
        buffer: await readFile(
          new URL(
            "../../assets/rive/transparent-bike.source.riv",
            import.meta.url,
          ),
        ),
      });
    const animation = page.getByLabel("Анимация · слева от заголовка", {
      exact: true,
    });
    await expect(animation).toHaveValue(/^[0-9a-f-]{36}$/);
    assets.push(await animation.inputValue());
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await nav.getByRole("button", { name: "Графика", exact: true }).click();
    const logoBytes = await sharp({
      create: { width: 80, height: 80, channels: 4, background: "#aa55dd" },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel("Файл: Знак ColaBike и favicon", { exact: true })
      .setInputFiles({
        name: "brand.png",
        mimeType: "image/png",
        buffer: logoBytes,
      });
    const logo = page.getByLabel("Знак ColaBike и favicon", { exact: true });
    await expect(logo).toHaveValue(/^[0-9a-f-]{36}$/);
    assets.push(await logo.inputValue());
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await nav.getByRole("button", { name: "Значки", exact: true }).click();
    const color = page.getByLabel("Цвет выделения: Велосипеды", {
      exact: true,
    });
    await color.fill("#aa55dd");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await page.screenshot({
      path: info.outputPath("icon-colors.png"),
      fullPage: true,
    });
    await page.goto("/");
    await expect(page.locator(".brand-mark img")).toHaveAttribute(
      "src",
      "/api/assets/" + assets[1],
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/api/assets/" + assets[1],
    );
    await expect(
      page.locator('[data-rive-art="custom"] [data-rive-ready]'),
    ).toBeVisible({ timeout: 20000 });
    expect(
      await page
        .locator('.global-header [data-icon="bike"]')
        .first()
        .evaluate((e) => e.style.getPropertyValue("--icon-color")),
    ).toBe("#aa55dd");
    await expect(
      page.getByRole("button", { name: "Оживить велосипеды" }),
    ).toHaveCount(0);
    await page.locator("footer summary").click();
    await expect(
      page
        .locator("footer")
        .getByRole("link", { name: "Riding Bike — rahiqueo" }),
    ).toBeVisible();
    // A public visitor also receives the same switch; disabling does not delete assignments.
    const current = await (
      await page.request.get("/api/admin/overview")
    ).json();
    const saved = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: {
        version: current.settingsVersion,
        value: { ...current.settings, heroAnimationsEnabled: false },
      },
    });
    expect(saved.status()).toBe(200);
    const visitor = await page.context().browser().newContext();
    try {
      const guest = await visitor.newPage();
      const runtimeRequests = [];
      guest.on("request", (r) => {
        if (/\.wasm$/.test(r.url()) || r.url().endsWith(assets[0]))
          runtimeRequests.push(r.url());
      });
      await guest.goto(origin, { waitUntil: "networkidle" });
      await expect(guest.locator("[data-rive-art] canvas")).toHaveCount(0);
      expect(runtimeRequests).toEqual([]);
    } finally {
      await visitor.close();
    }
    expect(
      (
        await page.request.delete("/api/admin/assets/" + assets[0], {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    for (const id of assets)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});

test("popular carousel stays on one row and scrolls with buttons, keyboard, scrubber and mouse drag", async ({
  page,
  isMobile,
}, info) => {
  await page.route("**/api/discovery/home", (route) =>
    route.fulfill({
      json: {
        popular: Array.from({ length: 8 }, (_, i) => ({
          id: "carousel-" + i,
          share_id: "carousel-" + i,
          name: "Carousel bike " + i,
          category: "road",
          photos: [],
          author: { name: "Rider", username: "carousel-rider" },
          likes: 0,
          is_public: true,
        })),
        events: [],
        content: [],
        records: [],
      },
    }),
  );
  await page.goto("/");
  const region = page.getByRole("region", {
    name: "Карусель популярных велосипедов",
  });
  const rail = region.getByLabel(
    "Велосипеды; используйте стрелки для прокрутки",
    { exact: true },
  );
  await expect(region.locator("article")).toHaveCount(8);
  const boxes = await region
    .locator("article")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(2);
  await region.scrollIntoViewIfNeeded();
  await region.getByRole("button", { name: "Следующие велосипеды" }).click();
  await expect
    .poll(() => rail.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(100);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slider = region.getByRole("slider", {
    name: "Позиция в популярных велосипедах",
  });
  await slider.focus();
  await slider.press("End");
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(99);
  await rail.focus();
  await rail.press("Home");
  await expect.poll(() => rail.evaluate((e) => e.scrollLeft)).toBeLessThan(1);
  if (!isMobile) {
    const box = await rail.boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 50, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => rail.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(100);
    await expect(page).toHaveURL(/\/$/);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("popular-carousel.png") });
  await rail.focus();
  await rail.press("Home");
  await region
    .getByRole("link", { name: "Carousel bike 0", exact: true })
    .click();
  await expect(page).toHaveURL(/\/b\/carousel-0$/);
});

test("primary menu opens on hover, crosses panels and preserves keyboard and touch navigation", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    const dialog = page.getByRole("dialog", { name: "Меню ColaBike" });
    await expect(
      dialog.getByRole("navigation", { name: "Разделы сайта" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    return;
  }
  const bikes = page.locator('.primary-navigation [data-section="bikes"]');
  const rides = page.locator('.primary-navigation [data-section="rides"]');
  await bikes.hover();
  await expect(bikes.locator(".nav-popover")).toBeVisible();
  await rides.hover();
  await expect(bikes.locator(".nav-popover")).toBeHidden();
  await expect(rides.locator(".nav-popover")).toBeVisible();
  await rides.locator(".nav-popover a").first().hover();
  await expect(rides.locator(".nav-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rides.locator(".nav-popover")).toBeHidden();
  await expect(rides.getByRole("button")).toBeFocused();
  await rides.getByRole("button").press("ArrowDown");
  await expect(rides.locator(".nav-popover a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await bikes.hover();
  await expect(bikes.locator(".nav-popover")).toBeVisible();
  await bikes.locator(".nav-popover a").first().click();
  await expect(page).toHaveURL(/\/bikes/);
});
