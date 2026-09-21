import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultSettings } from "../../lib/site-defaults.js";
const viewer = {
  id: "viewer",
  name: "Участник",
  username: "viewer",
  preferences: {},
};
const bikes = Array.from({ length: 9 }, (_, i) => ({
  id: `bike-${i}`,
  share_id: `share-${i}`,
  name: ["Canyon Grail CF 8 AXS", "Cube Travel SL", "Conway URB C 601"][i % 3],
  brand: ["Canyon", "Cube", "Conway"][i % 3],
  model: "Club",
  category: ["gravel", "road", "mtb"][i % 3],
  is_public: true,
  is_owner: false,
  photos: [{ id: `photo-${i % 3}` }],
  components: [],
  weight: i === 0 ? 8.2 : null,
  author: { name: "Александр", username: "rider", id: "owner" },
  likes: 2,
  liked: false,
  comments: 1,
}));
let db, original, photo;
const preset = {
  ...defaultSettings,
  showcaseTitle: "Наши велосипеды",
};
test.beforeAll(async () => {
  if (
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(
      process.env.TEST_ORIGIN || "http://localhost:3100",
    )
  )
    throw Error("Local UI tests only");
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
  photo = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#c7d5de" },
  })
    .png()
    .toBuffer();
});
test.afterAll(async () => {
  if (original)
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  await db?.end();
});
async function fixture(page, user = viewer, items = bikes) {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [preset]);
  await page.route("**/api/me", (r) => r.fulfill({ json: { user } }));
  await page.route("**/api/showcase?**", (r) =>
    r.fulfill({ json: { bikes: items, total: items.length } }),
  );
  await page.route("**/api/game/records", (r) =>
    r.fulfill({ json: { records: [] } }),
  );
  await page.route("**/api/community/notifications/count", (r) =>
    r.fulfill({ json: { unread: 0 } }),
  );
  await page.route("**/api/shared/**", (r) =>
    r.fulfill({ json: { bike: items[0] } }),
  );
  await page.route("**/api/photos/photo-*", async (r) => {
    const i = Number(r.request().url().split("photo-")[1]);
    const body = process.env.COMMUNITY_ARTWORK_DIR
      ? await readFile(
          `${process.env.COMMUNITY_ARTWORK_DIR}/bike-${[3, 2, 1][i]}.webp`,
        )
      : photo;
    await r.fulfill({ contentType: "image/webp", body });
  });
}
async function noOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
}

test("responsive gallery, touch targets, long names and reduced motion", async ({
  page,
}, info) => {
  await fixture(page, null, [
    ...bikes.slice(0, 3),
    {
      ...bikes[3],
      name: "Велосипед с очень длинным названием — индивидуальная сборка для путешествий",
      photos: [],
    },
  ]);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/bikes");
    await expect(page.locator(".bike-card")).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page);
    const first = page.locator(".bike-card").first(),
      box = await first.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(279);
    if (width === 390) expect(box.y).toBeLessThanOrEqual(315);
    if (width === 1440) expect(box.y).toBeLessThanOrEqual(350);
    const like = await first
      .getByRole("button", { name: "Нравится: 2" })
      .boundingBox();
    expect(like.width).toBeGreaterThanOrEqual(44);
    expect(like.height).toBeGreaterThanOrEqual(44);
    expect(
      await first
        .locator("img")
        .first()
        .evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe("contain");
    if ([390, 1440].includes(width))
      await page.screenshot({
        path: info.outputPath(`after-${width}.png`),
        fullPage: false,
      });
    if (width === 1440) {
      const contrast = await page.evaluate(() => {
        const luminance = (color) => {
          const rgb = color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((n) => {
              const c = n / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const ratio = (a, b) =>
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const card = document.querySelector(".bike-card"),
          bg = luminance(getComputedStyle(card).backgroundColor);
        return ["h2", ".author-link", ".card-facts"].map((selector) =>
          ratio(
            luminance(getComputedStyle(card.querySelector(selector)).color),
            bg,
          ),
        );
      });
      for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await noOverflow(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("combobox", { name: "Порядок витрины" })
    .selectOption("popular");
  await expect(page).toHaveURL(/sort=popular/);
  expect(
    await page
      .locator(".bike-grid")
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration),
  ).toBe("0s");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    // Read every original size first: mutating a heading before its nested
    // link would otherwise compound inherited sizes to 400% in WebKit.
    const sizes = [...document.querySelectorAll("h1,h2,button,a,select,p")].map(
      (el) => [el, parseFloat(getComputedStyle(el).fontSize)],
    );
    for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`;
  });
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("text-zoom-200.png"),
    fullPage: true,
  });
});

test("direct links, disclosure keyboard, return context and no document reload", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?sort=popular&category=gravel&q=Cube");
  await expect(page.locator(".bike-card")).toHaveCount(9);
  const menu = page.getByRole("button", { name: "Подразделы: Велосипеды" });
  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".nav-popover").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Журнал", exact: true }),
  ).toHaveAttribute("href", "/journal");
  const clock = await page.evaluate(() => performance.timeOrigin);
  await page.locator(".bike-card").nth(6).scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await page
    .locator(".bike-card")
    .nth(6)
    .getByRole("link", { name: "Открыть Canyon Grail CF 8 AXS" })
    .click();
  await expect(page).toHaveURL(/\/b\/share-6/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
  await page.goBack();
  await expect(
    page.getByRole("combobox", { name: "Порядок витрины" }),
  ).toHaveValue("popular");
  await expect(
    page.getByRole("button", { name: "Убрать фильтр Гравел" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=Cube/);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scroll - 80);
});

test("optimistic like, fast unlike, independent cards and rollback", async ({
  page,
}) => {
  await fixture(page);
  let release;
  await page.route("**/api/bikes/*/like", async (r) => {
    if (r.request().url().includes("bike-0")) {
      await new Promise((resolve) => {
        release = resolve;
      });
      await r.fulfill({
        json: {
          liked: r.request().method() === "PUT",
          likes: r.request().method() === "PUT" ? 3 : 2,
        },
      });
    } else await r.fulfill({ status: 500, json: { error: "test failure" } });
  });
  await page.goto("/bikes");
  const card = page.locator(".bike-card").first(),
    other = page.locator(".bike-card").nth(1);
  await card.getByRole("button", { name: "Нравится: 2" }).click();
  await expect(
    card.getByRole("button", { name: "Нравится: 3" }),
  ).toHaveAttribute("aria-pressed", "true");
  await other.getByRole("button", { name: "Нравится: 2" }).click();
  await expect(other.getByRole("alert")).toContainText("Лайк не сохранился");
  await expect(
    other.getByRole("button", { name: "Нравится: 2" }),
  ).toHaveAttribute("aria-pressed", "false");
  await card.getByRole("button", { name: "Нравится: 3" }).click();
  await expect.poll(() => !!release).toBe(true);
  const first = release;
  release = null;
  first();
  await expect.poll(() => !!release).toBe(true);
  release();
  await expect(
    card.getByRole("button", { name: "Нравится: 2" }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(
    card.getByRole("button", { name: "Нравится: 2" }),
  ).toHaveAttribute("aria-pressed", "false");
});

for (const status of [200, 500])
  test(`late filter ${status} cannot replace a newer result or clear the old grid`, async ({
    page,
  }) => {
    await fixture(page);
    await page.goto("/bikes");
    await expect(page.locator(".bike-card")).toHaveCount(9);
    let release;
    await page.route("**/api/showcase?**", async (r) => {
      if (new URL(r.request().url()).searchParams.get("sort") === "popular") {
        await new Promise((resolve) => {
          release = resolve;
        });
        await r.fulfill({
          status,
          json: {
            bikes: [{ ...bikes[0], name: "Устаревший ответ" }],
            total: 1,
          },
        });
      } else
        await r.fulfill({
          json: {
            bikes: [{ ...bikes[1], name: "Актуальная подборка" }],
            total: 1,
          },
        });
    });
    const sort = page.getByRole("combobox", { name: "Порядок витрины" });
    await sort.focus();
    await sort.selectOption("popular");
    await expect(page.locator(".bike-card")).toHaveCount(9);
    await expect(sort).toHaveValue("popular");
    await expect.poll(() => !!release).toBe(true);
    await sort.selectOption("records");
    await expect(
      page.getByRole("heading", { name: "Актуальная подборка" }),
    ).toBeVisible();
    const staleResponse = page.waitForResponse((r) =>
      r.url().includes("sort=popular"),
    );
    release();
    await staleResponse;
    await expect(
      page.getByRole("heading", { name: "Актуальная подборка" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Устаревший ответ" }),
    ).toHaveCount(0);
    await expect(sort).toBeFocused();
  });

test("persisted theme uses a single typeface, site accent and responsive columns", async ({
  page,
}) => {
  await fixture(page, {
    ...viewer,
    preferences: {
      theme: "dark",
      font: "onest",
      accent: "#FFFF00",
      desktopColumns: 5,
    },
  });
  await page.addInitScript(() => localStorage.setItem("cola:theme", "dark"));
  for (const width of [768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/bikes");
    await expect(page.locator(".bike-card")).toHaveCount(9);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Cola Source Sans 3");
    await noOverflow(page);
    expect(
      (await page.locator(".bike-card").first().boundingBox()).width,
    ).toBeGreaterThanOrEqual(279);
    expect(
      await page
        .locator(".site-root")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--accent")),
    ).toBe("#F3B51B");
  }
});

test("broken artwork and photos keep stable space and accessible fallbacks", async ({
  page,
}) => {
  await fixture(page, null);
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
    {
      ...preset,
      siteName: "Велоклуб участников",
      photoRatio: "1/1",
    },
  ]);
  await page.route("**/api/assets/fixture-*", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await page.route("**/api/photos/photo-*", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/bikes");
  await expect(page.locator(".brand")).toContainText("ColaBike");
  await expect(page.locator(".bike-card .photo-empty")).toHaveCount(9);
  await noOverflow(page);
  const photoBox = await page.locator(".card-photo").first().boundingBox();
  expect(Math.abs(photoBox.width - photoBox.height)).toBeLessThan(1);
  await expect(page.locator(".garage-banner-shell")).toHaveCount(0);
  // Reuse the same card with a replacement image: an old failure must not stick.
  await page.route("**/api/photos/recovered-photo", (r) =>
    r.fulfill({ contentType: "image/png", body: photo }),
  );
  await page.route("**/api/showcase?**", (r) =>
    r.fulfill({
      json: {
        bikes: [{ ...bikes[0], photos: [{ id: "recovered-photo" }] }],
        total: 1,
      },
    }),
  );
  await page
    .getByRole("combobox", { name: "Порядок витрины" })
    .selectOption("popular");
  const recovered = page.locator(".card-open-photo > img");
  await expect(recovered).toBeVisible();
  await expect
    .poll(() => recovered.evaluate((el) => el.naturalWidth))
    .toBe(900);
  await expect(page.locator(".bike-card .photo-empty")).toHaveCount(0);
  expect((await page.locator(".card-photo").boundingBox()).height).toBe(
    photoBox.height,
  );
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await expect(
    page.getByRole("dialog", { name: "Меню ColaBike" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Открыть меню" }),
  ).toBeFocused();
});

test("guest sign-in continues the requested add-bike action", async ({
  page,
  isMobile,
}) => {
  await fixture(page, null);
  await page.unroute("**/api/me");
  await page.goto("/bikes");
  await page.locator(".showcase-actions .add-bike").click();
  await expect(page).toHaveURL(/account\?tab=bikes&action=add/);
  // Guest account uses the same complete form as /login and /register.
  const dialog = page.locator(".auth-form");
  await dialog
    .getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" })
    .click();
  await dialog.getByLabel("Ваше имя").fill("Новый участник");
  await dialog
    .getByLabel("Электронная почта")
    .fill(randomUUID() + "@club.test");
  await dialog
    .getByLabel("Пароль", { exact: true })
    .fill("club-browser-password");
  await dialog.getByLabel("Подтвердите пароль").fill("club-browser-password");
  await dialog.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Тип велосипеда"),
  ).toBeVisible();
  await expect(page).toHaveURL(/action=add/);
  await expect(page.locator(".garage-banner")).toHaveCount(0);
});
