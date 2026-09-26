import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "../fixtures/legal.js";
import { gpx, loop } from "../ride-fixtures.js";

// Visual fixes after the redesign (#131).
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

async function account(request, name, { admin = false } = {}) {
  // Addresses are stored in lower case.
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`;
  const r = await request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email,
      password: "visual-fixes-secret-123",
    },
  });
  expect(r.status()).toBe(201);
  if (admin) {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
    } finally {
      await db.end();
    }
  }
  return (await (await request.get("/api/me")).json()).user;
}
async function post(request, path, data) {
  const r = await request.post("/api/" + path, { headers: { origin }, data });
  expect(r.ok(), path + " " + (await r.text())).toBe(true);
  return r.json();
}
async function bike(request, extra = {}) {
  const { id } = await post(request, "bikes", {
    name: "Canyon Grail CF SL 2023",
    brand: "Canyon",
    model: "Grail",
    year: 2023,
    category: "gravel",
    description: "",
    color: "",
    size: "M",
    weight: 9.2,
    is_public: true,
    ...extra,
  });
  return (await (await request.get("/api/bikes/" + id)).json()).bike;
}
// The site settings as the administrator saves them.
async function saveSettings(request, change) {
  const site = await (await request.get("/api/admin/overview")).json();
  const r = await request.put("/api/admin/settings", {
    headers: { origin },
    data: {
      value: { ...site.settings, ...change(site.settings) },
      version: site.settingsVersion,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  return site.settings;
}
async function image(request, name, background) {
  const r = await request.post("/api/admin/assets?name=" + name, {
    headers: { origin, "Content-Type": "image/png" },
    data: await sharp({
      create: { width: 600, height: 400, channels: 3, background },
    })
      .png()
      .toBuffer(),
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id;
}
const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("the home hero takes the site's accent, and its search button carries it", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const colors = await page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const paint = (value) => {
      probe.style.background = value;
      return getComputedStyle(probe).backgroundColor;
    };
    const result = {
      tint: paint("color-mix(in srgb, var(--accent) 14%, var(--bg))"),
      accent: paint("var(--accent)"),
      hero: getComputedStyle(
        document.querySelector(
          'section[aria-labelledby="hero-title"] .frame-inner',
        ),
      ).backgroundColor,
      button: getComputedStyle(
        document.querySelector("[data-home-search] button"),
      ).backgroundColor,
    };
    probe.remove();
    return result;
  });
  expect(colors.hero).toBe(colors.tint);
  expect(colors.button).toBe(colors.accent);
  await page.screenshot({ path: info.outputPath("home-hero.png") });
});

test("the bike page: the year is a label next to size and weight; owner's actions take two rows on a phone", async ({
  page,
  browser,
  isMobile,
}, info) => {
  await account(page.request, "Owner");
  const b = await bike(page.request);
  await page.goto("/b/" + b.share_id);
  await expect(page.locator(".bike-subtitle")).toHaveCount(0);
  await expect(page.locator(".bike-heading")).not.toContainText(
    "Модельный год",
  );
  const labels = page.locator(".bike-heading .bike-labels");
  await expect(labels.locator('[data-bike-label="year"]')).toHaveText("2023");
  await expect(labels.locator('[data-bike-label="year"]')).toHaveAttribute(
    "aria-label",
    "Модельный год: 2023",
  );
  await expect(labels.locator('[data-bike-label="size"]')).toBeVisible();
  await expect(labels.locator('[data-bike-label="weight"]')).toBeVisible();
  const actions = page.locator("[data-bike-actions]");
  await expect(
    actions.getByRole("button", { name: "Редактировать" }),
  ).toBeVisible();
  // Rows: buttons whose middles are within a few pixels of each other.
  const rows = await actions.evaluate((bar) => {
    const middles = [...bar.querySelectorAll("button, a")]
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.width && box.height)
      .map((box) => box.top + box.height / 2)
      .sort((a, b) => a - b);
    return middles.filter((y, i) => i === 0 || y - middles[i - 1] > 8).length;
  });
  expect(rows).toBeLessThanOrEqual(2);
  if (isMobile) {
    // Tools keep their icons; their names stay for screen readers.
    const edit = actions.getByRole("button", { name: "Редактировать" });
    expect((await edit.boundingBox()).width).toBeLessThanOrEqual(34);
    await expect(edit).toHaveAttribute("title", "Редактировать");
  }
  expect(await noOverflow(page)).toBe(true);
  await actions.screenshot({ path: info.outputPath("bike-actions.png") });
  // A like turns red on hover (desktop pointer).
  if (!isMobile) {
    const context = await browser.newContext({ baseURL: origin });
    try {
      const reader = await context.newPage();
      await account(reader.request, "Reader");
      await reader.goto("/b/" + b.share_id);
      const like = reader.locator("[data-bike-actions] .hf-like");
      const heart = like.locator("svg").first();
      const rest = await heart.evaluate((el) => getComputedStyle(el).color);
      await like.hover();
      await expect
        .poll(() => heart.evaluate((el) => getComputedStyle(el).color))
        .not.toBe(rest);
      const red = await reader.evaluate(() => {
        const probe = document.createElement("i");
        probe.style.color = "var(--like)";
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      await expect
        .poll(() => heart.evaluate((el) => getComputedStyle(el).color))
        .toBe(red);
    } finally {
      await context.close();
    }
  }
});

test("admin: the design system opens next to the admin menu; on a phone the save bar ends the page", async ({
  page,
  isMobile,
}, info) => {
  await account(page.request, "Admin", { admin: true });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Дизайн" }).click();
  await page
    .getByRole("button", { name: "Дизайн-система", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Дизайн-система", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Токены" })).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  // Nothing to save on this section.
  await expect(page.locator(".admin-save")).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  // «Главная»: the block takes the accent unless the administrator picks
  // their own colours.
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  const background = page.getByLabel("Фон блока", { exact: true });
  await expect(background).toHaveValue("accent");
  await expect(page.getByLabel("Фон блока · светлая тема")).toHaveCount(0);
  const bar = page.locator(".admin-save");
  const position = () => bar.evaluate((el) => getComputedStyle(el).position);
  if (isMobile) {
    expect(await position()).toBe("static");
    await expect(bar).toContainText("Изменения сохранены");
  } else expect(await position()).toBe("sticky");
  await background.selectOption("custom");
  await expect(page.getByLabel("Фон блока · светлая тема")).toBeVisible();
  await expect(bar).toContainText("Есть несохранённые изменения");
  if (isMobile) {
    expect(await position()).toBe("fixed");
    const box = await bar.boundingBox();
    const height = page.viewportSize().height;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(box.y).toBeGreaterThan(height / 2);
  }
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("admin-save.png") });
});

test("market: one look for «Найти» and «Добавить объявление», the site's field height, labelled facts", async ({
  page,
}, info) => {
  await account(page.request, "Seller");
  const listing = await post(page.request, "market", {
    title: "Колёса " + randomUUID().slice(0, 6),
    description: "Пара колёс",
    category: "components",
    listingType: "sale",
    condition: "used",
    price: 9000,
    currency: "RUB",
    location: "Казань",
    contact: "@seller_telegram",
    status: "active",
  });
  await page.goto("/market");
  const search = page.getByRole("search", { name: "Поиск объявлений" });
  const find = search.getByRole("button", { name: "Найти", exact: true });
  const add = page.getByRole("link", { name: "Добавить объявление" });
  const look = (locator) =>
    locator.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.color, s.height];
    });
  expect(await look(find)).toEqual(await look(add));
  expect((await search.boundingBox()).height).toBeLessThanOrEqual(56);
  const panel = page.getByRole("region", { name: "Фильтры объявлений" });
  const select = panel.getByLabel("Тип объявления");
  const price = panel.getByLabel("Цена от, ₽");
  expect((await select.boundingBox()).height).toBe(
    (await price.boundingBox()).height,
  );
  expect((await select.boundingBox()).height).toBeLessThanOrEqual(44);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("market.png") });
  await page.goto("/market/" + listing.shareId);
  const facts = page.locator("aside dl");
  await expect(facts.locator("dt")).toHaveText([
    "Продавец",
    "Город",
    "Связаться с автором",
  ]);
  await expect(facts.locator("dd").nth(0)).toContainText("Seller");
  await expect(facts.locator("dd").nth(1)).toHaveText("Казань");
  await expect(facts.locator("dd").nth(2)).toHaveText("@seller_telegram");
  await expect(page.locator("aside strong")).toHaveText(/^9\s000\s₽$/);
  await page
    .locator("aside")
    .screenshot({ path: info.outputPath("facts.png") });
});

test("sign-in and registration: separate pictures, shown whole", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "Phones show a short banner instead of the picture");
  await account(page.request, "Admin", { admin: true });
  const login = await image(page.request, "login.png", "#2f6f4f"),
    register = await image(page.request, "register.png", "#8a3b12");
  const old = await saveSettings(page.request, () => ({
    authImageId: login,
    authRegisterImageId: register,
  }));
  const context = await browser.newContext({ baseURL: origin });
  try {
    const guest = await context.newPage();
    await guest.goto("/login");
    const art = guest.locator("section[aria-labelledby='auth-title'] img");
    await expect(art).toHaveAttribute("src", "/api/assets/" + login);
    expect(await art.evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      "contain",
    );
    await guest
      .getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" })
      .click();
    await expect(art).toHaveAttribute("src", "/api/assets/" + register);
    // The longer form makes the column taller than the picture; the picture
    // is shown whole in its own proportions, not cropped or stretched.
    expect(await art.evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      "contain",
    );
  } finally {
    await context.close();
    await saveSettings(page.request, () => ({
      authImageId: old.authImageId,
      authRegisterImageId: old.authRegisterImageId,
    }));
  }
});

test("a ride's route keeps a dark casing in previews", async ({ page }) => {
  await account(page.request, "Rider");
  const b = await bike(page.request);
  const preview = await post(page.request, "rides/preview", gpx([loop]));
  await post(page.request, "rides", {
    previewId: preview.previewId,
    bikeId: b.id,
    title: "Круг с каймой",
    description: "",
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
  // No tiles: the card's preview draws the route line over an empty field.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/rides");
  const card = page.locator(".ride-card", { hasText: "Круг с каймой" });
  const route = card.locator(".ride-route");
  await expect(route.locator("path.route-casing")).not.toHaveCount(0);
  const casing = await route
    .locator("path.route-casing")
    .first()
    .evaluate((el) => getComputedStyle(el).stroke);
  expect(casing).not.toBe("none");
  // The casing is drawn first, the accent line over it.
  expect(
    await route.evaluate((svg) => {
      const paths = [...svg.querySelectorAll("path")];
      return paths.findIndex((p) => !p.classList.contains("route-casing"));
    }),
  ).toBeGreaterThan(0);
});
