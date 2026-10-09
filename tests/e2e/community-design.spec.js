import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defaultSettings } from "../../lib/site-defaults.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
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
  events,
  pulse: {
    total: 5,
    ready: 3,
    considering: 2,
    timeZone: "Europe/Moscow",
    asOf: "2026-10-01T09:00:00Z",
    buckets: [
      { key: "today", label: "Сегодня", count: 2 },
      { key: "tomorrow", label: "Завтра", count: 1 },
      { key: "weekend", label: "В выходные", count: 1 },
      { key: "later", label: "Позже", count: 1 },
    ],
  },
  bikeOfWeek: {
    bike: {
      id: "week",
      shareId: "community-share-0",
      name: "Canyon Grail CF 8 AXS",
    },
    cover: { id: "community-photo-0" },
    owner: { name: "Александр", username: "rider-0" },
    text: "Этот велосипед собран для долгих дорог. Лёгкая рама и надёжные компоненты помогают открывать новые маршруты.",
    textSource: "owner",
    components: [
      "Рама",
      "Вилка",
      "Колёса",
      "Тормоза",
      "Трансмиссия",
      "Седло",
    ].map((category, i) => ({
      category,
      name: [
        "Canyon Grail CF",
        "Canyon Carbon",
        "DT Swiss G1800",
        "Shimano GRX",
        "Shimano GRX 2×11",
        "Selle Italia",
      ][i],
    })),
  },
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
  await page.route("**/api/discovery/home*", (r) => r.fulfill({ json: data }));
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

test("home v2 stays readable in Light/Dark at every breakpoint", async ({
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
    await expect(page.locator("[data-ride-pulse]")).toContainText("5");
    for (const [label, mode] of [
      ["Светлая", "light"],
      ["Тёмная", "dark"],
    ]) {
      await theme(page, label);
      await noOverflow(page);
      await expect(
        page.locator(
          "[data-home-search], [data-hero-animation], article[data-bike-id]",
        ),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("navigation", { name: "Популярное на ColaBike" })
          .getByRole("link"),
      ).toHaveCount(4);
      const title = await page.locator("h1").boundingBox();
      expect(title.height).toBeLessThan(width <= 390 ? 160 : 140);
      const weekly = page.locator('[data-home-band="bike-week"]');
      const image = await weekly.locator("img").boundingBox(),
        parts = await weekly.locator("dl").boundingBox();
      if (width <= 720) expect(parts.y).toBeGreaterThan(image.y + image.height);
      else expect(parts.x).toBeGreaterThan(image.x);
      await page.screenshot({
        path: info.outputPath(`home-${width}x${height}-${mode}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});

test("home v2 is one ruled column with weekly bike, four destinations, record art and About", async ({
  page,
  isMobile,
}, info) => {
  const art = randomUUID(),
    missing = randomUUID();
  const png = await sharp({
    create: { width: 160, height: 160, channels: 4, background: "#f3b51b" },
  })
    .png()
    .toBuffer();
  const assets = [];
  await page.route("**/api/assets/**", (r) => {
    const url = new URL(r.request().url());
    assets.push(url.pathname + url.search);
    return url.pathname.endsWith(art)
      ? r.fulfill({ body: png, contentType: "image/png" })
      : r.fulfill({ status: 404, body: "missing" });
  });
  await fixture(page, {
    ...home,
    records: [
      { ...home.records[0], imageId: art },
      {
        key: "heavy",
        name: "Самый тяжёлый",
        metric: "weight",
        imageId: missing,
        holder: {
          shareId: "community-share-1",
          name: "Cube Travel",
          value: 16,
        },
      },
      {
        key: "plain",
        name: "Без иллюстрации",
        metric: "weight",
        holder: { shareId: "community-share-2", name: "Conway", value: 12 },
      },
    ],
  });
  const widths = isMobile
    ? [[390, 844]]
    : [
        [1280, 900],
        [1440, 900],
        [1600, 900],
        [1920, 1080],
        [2560, 1200],
      ];
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("[data-ride-pulse]")).toContainText("5");
    // Six bands in order, each a band of the ruled column; nothing between.
    const bands = page.locator("main > section.frame");
    expect(
      await bands.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("aria-labelledby")),
      ),
    ).toEqual([
      "hero-title",
      "together-heading",
      "bike-week-heading",
      "popular-heading",
      "records-heading",
      "about-heading",
    ]);
    await expect(page.locator("main .section-head")).toHaveCount(0);
    await expect(page.locator("main > :not(section.frame)")).toHaveCount(0);
    // The inner column and its side rails line up in every band.
    const columns = await page
      .locator("main > section.frame > .frame-inner")
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.width)];
        }),
      );
    for (const column of columns) expect(column).toEqual(columns[0]);
    // Blocks 3–6 carry their title in a rail inside the band.
    for (const id of ["bike-week", "popular", "records", "about"]) {
      const band = page.locator(`[data-home-band="${id}"]`);
      const heading = band.getByRole("heading", { level: 2 });
      await expect(heading).toHaveCount(1);
      const [rail, box] = await Promise.all([
        heading.evaluate((h) => h.parentElement.getBoundingClientRect().height),
        band.boundingBox(),
      ]);
      expect(rail).toBeLessThanOrEqual(isMobile ? 104 : 56);
      expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(box.y);
    }
    const band = (id) => page.locator(`[data-home-band="${id}"]`).boundingBox();
    const [weekly, popular, records, about] = await Promise.all(
      ["bike-week", "popular", "records", "about"].map(band),
    );
    expect(records.height).toBeLessThan(weekly.height);
    expect(popular.height).toBeGreaterThan(80);
    // The footer follows the closing band directly.
    const footer = await page.locator("footer").last().boundingBox();
    expect(Math.abs(footer.y - (about.y + about.height))).toBeLessThan(2);
    const cells = page
      .getByRole("navigation", { name: "Популярное на ColaBike" })
      .getByRole("link");
    await expect(cells).toHaveCount(4);
    expect(
      await cells.evaluateAll((nodes) =>
        nodes.map((n) => new URL(n.href).pathname),
      ),
    ).toEqual(["/rides", "/components", "/articles", "/market"]);
    // Records: the rule's art, a fallback for a broken or missing one.
    const recordsBand = page.locator('[data-home-band="records"]');
    await recordsBand.scrollIntoViewIfNeeded();
    const arts = recordsBand.locator(".game-art");
    await expect(arts).toHaveCount(3);
    await expect
      .poll(() =>
        arts
          .nth(0)
          .locator("img")
          .evaluate((e) => e.complete && e.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(arts.nth(0)).toHaveAttribute("data-image-state", "loaded");
    await expect(arts.nth(1)).toHaveAttribute("data-image-state", "error");
    await expect(arts.nth(1).locator("img")).toHaveCount(0);
    await expect(arts.nth(1).locator("svg")).toBeVisible();
    await expect(arts.nth(2)).toHaveAttribute("data-image-state", "empty");
    await expect(
      recordsBand.getByRole("link", { name: "Canyon Grail", exact: true }),
    ).toHaveAttribute("href", "/b/community-share-0");
    // «О проекте»: one thought and one link to the page.
    const closing = page.locator('[data-home-band="about"]');
    await expect(closing.getByRole("link")).toHaveCount(1);
    await expect(closing.getByRole("link")).toHaveAttribute("href", "/about");
    for (const [label, mode] of [
      ["Светлая", "light"],
      ["Тёмная", "dark"],
    ]) {
      await theme(page, label);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await noOverflow(page);
      // Card backgrounds fade on a theme switch: measure contrast after it.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      if (width === widths[0][0])
        expect(
          (
            await new AxeBuilder({ page })
              .include("main")
              .disableRules(["region"])
              .analyze()
          ).violations,
        ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`home-254-${width}-${mode}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  // Presentation-size art only, never the original file.
  expect(assets.every((path) => /\?width=160$/.test(path))).toBe(true);
});

test("theme toggle waits for hydration and its first click inverts the actual system theme", async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  await page.emulateMedia({ colorScheme: "dark" });
  let release;
  const hydration = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await hydration;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const toggle = page.getByRole("switch", {
      name: "Тёмная тема",
      exact: true,
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    release();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    if (isMobile) await toggle.tap();
    else await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("cola:theme"))).toBe(
      "light",
    );
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
  await expect(page.locator("[data-ride-pulse]")).toContainText("5");
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
  // Wait for the client-rendered gallery before typing after the hard navigation.
  await expect(page.locator("[data-ride-pulse]")).toContainText("5");
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
  await page.keyboard.press("/");
  await expect(input).toBeFocused();
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
  await fixture(page, {
    ...home,
    bikeOfWeek: {
      ...home.bikeOfWeek,
      bike: {
        ...home.bikeOfWeek.bike,
        name: "Очень длинное название велосипеда — сборка для многодневных путешествий через весь континент",
      },
      cover: { id: "community-photo-missing" },
    },
  });
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
  await page.route("**/api/discovery/home*", (r) =>
    r.fulfill({
      json: {
        events: [],
        records: [],
        bikeOfWeek: null,
        pulse: {
          ...home.pulse,
          total: 0,
          ready: 0,
          considering: 0,
          buckets: home.pulse.buckets.map((b) => ({ ...b, count: 0 })),
        },
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("Первые истории ещё впереди.")).toBeVisible();
  await noOverflow(page);
  await page.route("**/api/discovery/home*", (r) =>
    r.fulfill({ status: 500, json: { error: "unavailable" } }),
  );
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Не удалось",
  );
  await page.route("**/api/discovery/home*", (r) => r.fulfill({ json: home }));
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.locator("[data-ride-pulse]")).toContainText("5");
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
    await page
      .getByLabel("Файл: Hero — тёмная тема", { exact: true })
      .setInputFiles({
        name: "hero-test.png",
        mimeType: "image/png",
        buffer: png,
      });
    const picker = page.getByRole("combobox", {
      name: "Hero — тёмная тема",
      exact: true,
    });
    await expect(picker).not.toHaveValue("");
    const heroId = await picker.inputValue();
    assets.push(heroId);
    await expect(
      page
        .locator(".asset-picker")
        .filter({ has: picker })
        .locator(".asset-picker-preview img"),
    ).toHaveAttribute("src", "/api/assets/" + heroId);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.heroBackgroundImageId,
      )
      .toBe(heroId);
    const preview = await page.context().newPage();
    await preview.goto("/");
    await expect(
      preview.locator(
        `section[aria-labelledby="hero-title"] img[data-hero-background]`,
      ),
    ).toHaveAttribute("src", "/api/assets/" + heroId + "?width=2400");
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
            .settings.heroBackgroundImageId,
      )
      .toBe(assets[1]);
    await page.screenshot({
      path: info.outputPath("admin-homepage.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Сбросить: Hero — тёмная тема",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.heroBackgroundImageId,
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
