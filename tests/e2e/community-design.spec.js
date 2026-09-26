import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultSettings } from "../../lib/site-defaults.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const bikes = Array.from({ length: 9 }, (_, i) => ({
  id: `community-${i}`,
  share_id: `community-share-${i}`,
  name: ["Canyon Grail CF 8 AXS", "Cube Travel SL", "Conway URB C 601"][i % 3],
  category: ["gravel", "road", "mtb"][i % 3],
  photos: i === 7 ? [] : [{ id: `community-photo-${i % 3}` }],
  author: {
    name: ["Александр", "Мария", "Михаил"][i % 3],
    username: `rider-${i}`,
  },
  weight: i === 0 ? 8.2 : null,
  likes: 12 - i,
  liked: false,
  comments: i % 3,
  is_owner: false,
  is_public: true,
}));
const events = [
  {
    id: "bike:1",
    type: "bike",
    author: "Александр",
    title: "Canyon Grail CF 8 AXS",
    href: "/b/community-share-0",
  },
  {
    id: "ride:1",
    type: "ride",
    author: "Мария",
    title: "Утро вдоль реки",
    distanceM: 42500,
    href: "/r/river",
  },
  {
    id: "journal:1",
    type: "journal",
    author: "Михаил",
    title: "Один велосипед для всего",
    href: "/journal/one",
  },
  {
    id: "achievement:1",
    type: "achievement",
    author: "Ольга",
    title: "Первая сотня",
    href: "/u/olga",
  },
];
const home = {
  popular: bikes,
  totalBikes: 34,
  events,
  content: events.slice(0, 3).map((e) => ({
    ...e,
    createdAt: "2026-09-21T08:00:00Z",
    excerpt:
      "Новые маршруты, любимые детали и истории, которые хочется сохранить.",
  })),
  records: [
    {
      key: "light",
      name: "Самый лёгкий",
      metric: "weight",
      holder: {
        shareId: "community-share-0",
        name: "Canyon Grail",
        value: 8.2,
      },
    },
  ],
};
const groups = [
  {
    type: "bikes",
    label: "Велосипеды",
    total: 1,
    items: [
      {
        type: "bike",
        id: "bike",
        title: "Cube Travel SL",
        href: "/b/community-share-1",
        subtitle: "Мария",
        metadata: { category: "road" },
      },
    ],
  },
  {
    type: "components",
    label: "Компоненты",
    total: 1,
    items: [
      {
        type: "component",
        id: "grx",
        title: "Shimano GRX",
        href: "/search?type=bikes&component=Shimano+GRX",
        subtitle: "На 3 велосипедах",
        metadata: {},
      },
    ],
  },
  {
    type: "rides",
    label: "Покатушки",
    total: 1,
    items: [
      {
        type: "ride",
        id: "river",
        title: "Утро вдоль реки",
        href: "/r/river",
        subtitle: "Мария",
        metadata: { distanceM: 42500 },
      },
    ],
  },
];
let db, original, photo;
test.beforeAll(async () => {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(origin))
    throw Error("Local tests only");
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
  photo = await sharp({
    create: { width: 320, height: 220, channels: 3, background: "#c7d5de" },
  })
    .webp()
    .toBuffer();
});
test.afterAll(async () => {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  await db.end();
});
async function fixture(page, data = home) {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
    { ...original, ...defaultSettings },
  ]);
  await page.route("**/api/discovery/home", (r) => r.fulfill({ json: data }));
  await page.route("**/api/community/notifications/count", (r) =>
    r.fulfill({ json: { unread: 0 } }),
  );
  await page.route("**/api/discovery/search?**", (r) =>
    r.fulfill({ json: { groups, total: 3, page: 1, pageSize: 24 } }),
  );
  await page.route("**/api/photos/community-photo-*", async (r) => {
    const n = new URL(r.request().url()).pathname.slice(-1);
    const body = process.env.COMMUNITY_ARTWORK_DIR
      ? await readFile(
          `${process.env.COMMUNITY_ARTWORK_DIR}/bike-${Number(n) + 1}.webp`,
        )
      : photo;
    await r.fulfill({ body, contentType: "image/webp" });
  });
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function theme(page, label) {
  if (label === "Как на устройстве") {
    // This fixture is a guest. Simulate another tab choosing System; the real
    // account combobox is exercised by backlog.spec.js.
    await page.evaluate(() => {
      localStorage.setItem("cola:theme", "system");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "cola:theme", newValue: "system" }),
      );
    });
    return;
  }
  const toggle = page.getByRole("switch", { name: "Тёмная тема", exact: true });
  const dark = label === "Тёмная";
  await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-checked")) !== String(dark))
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(dark));
}

test("homepage rhythm, photo-first popular bikes and stable Light/Dark at every breakpoint", async ({
  page,
}, info) => {
  await fixture(page);
  for (const [width, height] of [
    [320, 900],
    [390, 844],
    [768, 900],
    [1024, 900],
    [1440, 900],
    [1920, 1080],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("article[data-bike-id]")).toHaveCount(9);
    await page.evaluate(() => document.fonts.ready);
    for (const [label, mode] of [
      ["Светлая", "light"],
      ["Тёмная", "dark"],
    ]) {
      await theme(page, label);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await noOverflow(page);
      const header = await page.locator(".global-header").boundingBox();
      expect(header.height).toBeLessThanOrEqual(68);
      expect(await page.locator(".brand svg").getAttribute("fill")).toBe(
        "none",
      );
      if (width === 1440) {
        const ratios = await page.evaluate(() => {
          // rgb(0-255) or, for color-mix() backgrounds, color(srgb 0-1).
          const luminance = (value) => {
            const numbers = value
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number);
            const c = (
              value.startsWith("color(") ? numbers : numbers.map((n) => n / 255)
            ).map((n) =>
              n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
            );
            return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
          };
          return [
            document.querySelector("h1"),
            document.querySelector("[data-home-search]").previousElementSibling,
            ...document
              .querySelector("article[data-bike-id]")
              .querySelectorAll("h3, p, button"),
          ].map((el) => {
            let parent = el,
              background;
            do {
              background = getComputedStyle(parent).backgroundColor;
              parent = parent.parentElement;
            } while (parent && background === "rgba(0, 0, 0, 0)");
            const a = luminance(getComputedStyle(el).color),
              b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
        });
        for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
      const h = await page.locator("h1").evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(h.height / h.line).toBeLessThanOrEqual(width <= 390 ? 4.1 : 2.1);
      // #83: the photo spans the card, the text below it stays short and
      // tablets and phones show two builds per row.
      const first = page.locator("article[data-bike-id]").first();
      const card = await first.boundingBox();
      const photo = await first.locator("a").first().boundingBox();
      expect(photo.width).toBeGreaterThanOrEqual(card.width - 2);
      expect(card.height - photo.height).toBeLessThan(200);
      if (width <= 1050) expect(card.width).toBeLessThan(width * 0.55);
      // Portrait phones see the first build on the first screen.
      if (width <= 390 && height > width)
        expect(card.y + 120).toBeLessThanOrEqual(height);
      await expect(
        page.locator(".global-header img, .garage-banner"),
      ).toHaveCount(0);
      if (width <= 390) {
        const target = await first.getByRole("button").boundingBox();
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: info.outputPath(`home-${width}x${height}-${mode}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});

test("theme toggle waits for hydration and its first click inverts the actual system theme", async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  await page.emulateMedia({ colorScheme: "dark" });
  let release;
  const hydration = new Promise((resolve) => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await hydration;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const toggle = page.getByRole("switch", { name: "Тёмная тема", exact: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    release();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    if (isMobile) await toggle.tap();
    else await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("cola:theme"))).toBe("light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  } finally {
    release();
  }
});

test("theme persists before hydration and follows system changes; dialogs use the same palette", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme(page, "Светлая");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("cola:theme"))).toBe(
    "light",
  );
  await theme(page, "Как на устройстве");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme(page, "Тёмная");
  await page
    .getByRole("button", { name: "Поиск ColaBike", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Поиск ColaBike" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox");
  await input.fill("Cube");
  await expect(dialog.getByRole("option")).toHaveCount(3);
  const options = await dialog.getByRole("listbox").boundingBox();
  const bounds = await dialog.boundingBox();
  expect(options.y + options.height).toBeLessThanOrEqual(
    bounds.y + bounds.height,
  );
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("search keyboard, groups, cancellation and real results navigation", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator("article[data-bike-id]")).toHaveCount(9);
  await page.keyboard.press("/");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("Cube");
  await expect(page.getByRole("option")).toHaveCount(3);
  await input.press("ArrowUp");
  await expect(page.getByRole("option").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.fill("Shimano");
  await expect(page.getByRole("option")).toHaveCount(3);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/component=Shimano/);
  await expect(page.getByText("Велосипеды с компонентом:")).toBeVisible();
  await page.goto("/");
  let release;
  await page.route("**/api/discovery/search?**", async (r) => {
    if (new URL(r.request().url()).searchParams.get("q") === "old")
      await new Promise((resolve) => {
        release = resolve;
      });
    await r
      .fulfill({
        json: {
          groups: groups.map((g) => ({
            ...g,
            items: g.items.map((item) => ({
              ...item,
              title: new URL(r.request().url()).searchParams.get("q"),
            })),
          })),
          total: 3,
        },
      })
      .catch(() => {});
  });
  await input.fill("old");
  await expect.poll(() => !!release).toBe(true);
  await input.fill("new");
  await expect(page.getByRole("option").first()).toContainText("new");
  release();
  await expect(page.getByRole("option").first()).not.toContainText("old");
  await input.press("Escape");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=new/);
  await expect(
    page.getByRole("region", { name: "Велосипеды", exact: true }),
  ).toBeVisible();
});

test("Live is readable with reduced motion; empty, missing images and long titles stay usable", async ({
  page,
}) => {
  await fixture(
    page,
    {
      ...home,
      popular: [
        {
          ...bikes[0],
          name: "Очень длинное название велосипеда — сборка для многодневных путешествий через весь континент",
          photos: [{ id: "community-photo-missing" }],
        },
      ],
    },
    { id: "viewer", name: "Участник", username: "viewer", preferences: {} },
  );
  await page.route("**/api/photos/community-photo-missing*", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await expect(page.locator("article[data-bike-id] img")).toHaveCount(0);
  await noOverflow(page);
  const ticker = page.getByRole("region", {
    name: "Последние события сообщества",
  });
  await expect(ticker.locator('[aria-hidden="true"][inert]')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await ticker
      .locator("[data-paused]")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await expect(ticker.getByRole("link")).toHaveCount(4);
  await page.setViewportSize({ width: 720, height: 450 }); // 1440 viewport at 200% browser zoom equivalent.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await noOverflow(page);
  await page.route("**/api/discovery/home", (r) =>
    r.fulfill({
      json: {
        popular: [],
        events: [],
        content: [],
        records: [],
        totalBikes: 0,
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("Первые истории ещё впереди.")).toBeVisible();
  await noOverflow(page);
  await page.route("**/api/discovery/home", (r) =>
    r.fulfill({ status: 500, json: { error: "unavailable" } }),
  );
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Не удалось",
  );
  await page.route("**/api/discovery/home", (r) => r.fulfill({ json: home }));
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.locator("article[data-bike-id]")).toHaveCount(9);
});

test("admin appearance is explicit; hero upload, replacement and removal protect assigned content artwork", async ({
  page,
}, info) => {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  const register = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Community admin",
      email: randomUUID() + "@community.test",
      password: "community-browser-secret",
    },
  });
  expect(register.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  let assets = [];
  try {
    const png = await sharp({
      create: {
        width: 320,
        height: 320,
        channels: 4,
        background: { r: 243, g: 181, b: 27, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    for (const name of ["Content artwork", "Replacement"]) {
      const result = await page.request.post(
        "/api/admin/assets?name=" + encodeURIComponent(name),
        { headers: { origin, "Content-Type": "image/png" }, data: png },
      );
      expect(result.status()).toBe(201);
      assets.push((await result.json()).id);
    }
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
      { ...original, aboutGuideImageId: assets[0] },
    ]);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "Разделы админки" });
    await nav.getByRole("button", { name: "Внешний вид", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Тема по умолчанию" })
      .selectOption("dark");
    expect(
      (await (await page.request.get("/api/admin/overview")).json()).settings
        .appearance.theme,
    ).toBe("system");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.appearance.theme,
      )
      .toBe("dark");
    await nav.getByRole("button", { name: "Главная", exact: true }).click();
    await page.getByLabel("Файл: Hero image", { exact: true }).setInputFiles({
      name: "hero-test.png",
      mimeType: "image/png",
      buffer: png,
    });
    const picker = page.getByRole("combobox", {
      name: "Hero image",
      exact: true,
    });
    await expect(picker).not.toHaveValue("");
    const heroId = await picker.inputValue();
    assets.push(heroId);
    await expect(page.locator(".asset-picker-preview img")).toHaveAttribute(
      "src",
      "/api/assets/" + heroId,
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.heroImageId,
      )
      .toBe(heroId);
    const preview = await page.context().newPage();
    await preview.goto("/");
    await expect(
      preview.locator('section[aria-labelledby="hero-title"] img'),
    ).toHaveAttribute("src", "/api/assets/" + heroId);
    await preview.close();
    expect(
      (
        await page.request.delete("/api/admin/assets/" + heroId, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    await picker.selectOption(assets[1]);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.heroImageId,
      )
      .toBe(assets[1]);
    await page.screenshot({
      path: info.outputPath("admin-homepage.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Сбросить: Hero image", exact: true })
      .click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.heroImageId,
      )
      .toBe(null);
    expect(
      (await (await page.request.get("/api/admin/overview")).json()).settings
        .aboutGuideImageId,
    ).toBe(assets[0]);
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    for (const id of assets)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    await db.query("DELETE FROM users WHERE id=$1", [user.id]);
  }
});
