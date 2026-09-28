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
    await page.getByLabel("Скорость Live, пикселей в секунду").fill("36");
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
    await page
      .getByLabel("Логотип вместо надписи ColaBike", { exact: true })
      .selectOption(assets[1]);
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
    await nav.getByRole("button", { name: "Тексты", exact: true }).click();
    await page
      .getByLabel("Подпись ссылки авторов графики")
      .fill("Художники сообщества");
    await page.getByLabel("Ссылка авторов графики").fill("/about");
    await expect(page.getByLabel("Отмена", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await page.goto("/");
    await expect(page.locator(".brand > img")).toHaveAttribute(
      "src",
      "/api/assets/" + assets[1],
    );
    await expect(
      page
        .locator("footer")
        .getByRole("link", { name: "Художники сообщества" }),
    ).toHaveAttribute("href", "/about");
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

test("popular carousel stays on one row and scrolls with buttons, keyboard, a single native scrollbar and mouse drag", async ({
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
  // No hover/focus pause: watch the visible rail with the pointer elsewhere.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(0, 0);
  const idle = await rail.evaluate(async (node) => {
    const start = node.scrollLeft;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return Math.abs(node.scrollLeft - start);
  });
  expect(idle).toBeLessThan(1);
  await region.getByRole("button", { name: "Следующие велосипеды" }).click();
  await expect
    .poll(() => rail.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(100);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(region.getByRole("slider")).toHaveCount(0);
  await rail.focus();
  await rail.press("End");
  await expect
    .poll(() =>
      rail.evaluate((e) => e.scrollWidth - e.clientWidth - e.scrollLeft),
    )
    .toBeLessThan(2);
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      rides
        .locator(".nav-popover")
        .evaluate((e) => getComputedStyle(e).opacity),
    )
    .toBe("1");
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

test("Live and popular bikes share speed and pause, with reduced motion respected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 1800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/discovery/home", (route) =>
    route.fulfill({
      json: {
        popular: Array.from({ length: 8 }, (_, i) => ({
          id: "auto-" + i,
          share_id: "auto-" + i,
          name: "Automatic bike " + i,
          category: "road",
          photos: [],
          author: { name: "Rider", username: "auto-rider" },
          likes: 0,
          is_public: true,
        })),
        events: Array.from({ length: 12 }, (_, i) => ({
          id: "event-" + i,
          type: "bike",
          title: "Длинная история велосипеда " + i,
          author: "Rider",
          href: "/b/auto-" + i,
        })),
        content: [],
        records: [],
      },
    }),
  );
  await page.goto("/");
  const bikes = page.getByLabel(
    "Велосипеды; используйте стрелки для прокрутки",
    { exact: true },
  );
  const events = page.getByLabel("События; прокрутите, чтобы прочитать все", {
    exact: true,
  });
  await expect
    .poll(() => bikes.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(5);
  await expect
    .poll(() => events.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(5);
  const offsets = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[aria-label="Велосипеды; используйте стрелки для прокрутки"], [aria-label="События; прокрутите, чтобы прочитать все"]',
        ),
      ].map((e) => e.scrollLeft),
    );
  const before = await offsets();
  await expect
    .poll(async () => (await offsets())[0] - before[0])
    .toBeGreaterThan(20);
  const after = await offsets();
  expect(Math.abs(after[0] - before[0] - (after[1] - before[1]))).toBeLessThan(
    5,
  );
  await page
    .getByRole("button", { name: "Приостановить движение событий" })
    .click();
  const pause = await offsets();
  await page.waitForTimeout(350);
  expect(await offsets()).toEqual(pause);
  await page
    .getByRole("button", { name: "Продолжить движение событий" })
    .click();
  await expect
    .poll(() => bikes.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(pause[1] + 5);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reduced = await offsets();
  await page.waitForTimeout(350);
  expect(await offsets()).toEqual(reduced);
});

test("hover preference inherits the site default and a member can override and reset it", async ({
  page,
  isMobile,
}) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  let user;
  try {
    await db.query(
      "UPDATE site_settings SET value=value || '{\"menuOpenOnHover\":false}'::jsonb WHERE id=1",
    );
    const r = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Menu member",
        email: randomUUID() + "@menu.test",
        password: "menu-preference-secret",
      },
    });
    expect(r.status()).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user;
    await page.goto("/");
    const bikes = page.locator('.primary-navigation [data-section="bikes"]');
    if (!isMobile) {
      await bikes.hover();
      await expect(bikes.locator(".nav-popover")).toBeHidden();
      await bikes.getByRole("button").click();
      await expect(bikes.locator(".nav-popover")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.goto("/account?tab=appearance");
    const preference = page.getByRole("combobox", {
      name: "Открывать меню при наведении",
      exact: true,
    });
    await expect(preference).toHaveValue("");
    await preference.selectOption("true");
    await page
      .getByRole("button", { name: "Сохранить оформление", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/me")).json()).user.preferences
            .menuOpenOnHover,
      )
      .toBe(true);
    await page.reload();
    await expect(preference).toHaveValue("true");
    if (!isMobile) {
      await bikes.hover();
      await expect(bikes.locator(".nav-popover")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await preference.selectOption("");
    await page
      .getByRole("button", { name: "Сохранить оформление", exact: true })
      .click();
    await expect
      .poll(async () =>
        Object.hasOwn(
          (await (await page.request.get("/api/me")).json()).user.preferences,
          "menuOpenOnHover",
        ),
      )
      .toBe(false);
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
