import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { testConsents } from "../fixtures/legal.js";
import { gpx, loop } from "../ride-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
// React reports a server/client disagreement as a recoverable error: minified
// #418-#425 in production builds, "hydration" in development ones.
const hydrationError = /hydrat|did not match|#41[89]|#42[1-5]/i;
// A section rendered twice repeats its id; React leaves such stale copies
// when sibling keys collide, and updates right after hydration expose it.
const duplicateIds = (page) =>
  page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });

// Public pages arrive rendered on the server (#74). The browser must adopt
// that HTML as is, also far from Moscow, whose time zone the server uses.
test("public pages hydrate their server HTML and stay interactive", async ({
  page,
  browser,
}) => {
  const nonce = randomUUID().slice(0, 8);
  const post = async (path, data) => {
    const r = await page.request.post("/api/" + path, {
      headers: { origin },
      data,
    });
    expect(r.ok(), path + " " + r.status()).toBe(true);
    return r.json();
  };
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Сервер " + nonce,
          email: `server-render-${nonce}@example.test`,
          password: "server-render-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const { username } = (await (await page.request.get("/api/me")).json()).user;
  const created = await post("bikes", {
    name: "Гравел " + nonce,
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "Для длинных выходных " + nonce,
    color: "",
    size: "",
    weight: 9.4,
    is_public: true,
  });
  const { bike } = await (
    await page.request.get("/api/bikes/" + created.id)
  ).json();
  await post(`bikes/${bike.id}/components`, {
    section: "build",
    category: "Групсет",
    name: "Shimano GRX " + nonce,
    notes: "",
    price: null,
  });
  const entry = await post("journal", {
    bikeId: bike.id,
    kind: "service",
    title: "Сервис " + nonce,
    body: "Заменил тормозные колодки " + nonce,
    status: "published",
    isPublic: true,
  });
  const preview = await post("rides/preview", gpx([loop]));
  const ride = await post("rides", {
    previewId: preview.previewId,
    bikeId: bike.id,
    title: "Круг " + nonce,
    description: "Вдоль реки " + nonce,
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
  const listing = await post("market", {
    title: "Колёса " + nonce,
    description: "Пара колёс " + nonce,
    category: "components",
    listingType: "sale",
    condition: "used",
    price: 9000,
    currency: "RUB",
    location: "Казань",
    contact: "",
    status: "active",
  });
  const article = await post("articles", {
    title: "Уход за цепью " + nonce,
    body: "Чистая цепь служит дольше " + nonce,
    topicId: "maintenance",
    status: "published",
  });
  // A planned time differs between Moscow and the viewer's zone at any hour.
  const scheduledAt = new Date(Date.now() + 7 * 86400000);
  scheduledAt.setUTCSeconds(0, 0);
  const plan = await post("rides/plan", {
    bikeId: bike.id,
    title: "Выезд " + nonce,
    description: "Сбор у моста " + nonce,
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
    scheduledAt: scheduledAt.toISOString(),
  });
  const pages = [
    ["/b/" + bike.share_id, "Гравел " + nonce, "Shimano GRX " + nonce],
    ["/j/" + entry.shareId, "Сервис " + nonce, "Заменил тормозные колодки " + nonce],
    ["/r/" + ride.shareId, "Круг " + nonce, "Вдоль реки " + nonce],
    ["/r/" + plan.shareId, "Выезд " + nonce, "Сбор у моста " + nonce],
    ["/market/" + listing.shareId, "Колёса " + nonce, "Пара колёс " + nonce],
    ["/@" + username, "Сервер " + nonce, "Гравел " + nonce],
    ["/articles/" + article.shareId, "Уход за цепью " + nonce, "Чистая цепь служит дольше " + nonce],
  ];

  const context = await browser.newContext({ timezoneId: "Asia/Vladivostok" });
  const guest = await context.newPage();
  const errors = [];
  guest.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  guest.on("pageerror", (e) => errors.push(e.message));
  for (const [path, title, text] of pages) {
    const response = await guest.goto(path);
    expect(response.status(), path).toBe(200);
    // The heading and text come with the HTML, before any API request.
    const html = await response.text();
    expect(html, path).toContain(title);
    expect(html, path).toContain(text);
    await expect(
      guest.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await guest.waitForLoadState("networkidle");
    expect(errors.filter((e) => hydrationError.test(e)), path).toEqual([]);
    expect(await duplicateIds(guest), path).toEqual([]);
  }
  // Hydrated pages still answer clicks: the share menu opens for guests.
  await guest.goto(pages[0][0]);
  await guest.getByRole("button", { name: "Поделиться", exact: true }).click();
  await expect(guest.getByRole("menu")).toBeVisible();
  await expect(
    guest.getByRole("button", { name: "Подписаться на велосипед", exact: true }),
  ).toHaveCount(1);
  // Times and dates switch to the viewer's own zone after hydration.
  await guest.goto("/r/" + plan.shareId);
  await expect(guest.locator(".ride-status time")).toHaveText(
    scheduledAt.toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" }),
  );
  await guest.goto("/market/" + listing.shareId);
  await expect(guest.getByText("Опубликовано сегодня")).toBeVisible();
  expect(errors.filter((e) => hydrationError.test(e))).toEqual([]);
  await context.close();

  // The owner gets the same HTML first, then the editing controls.
  const ownerErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") ownerErrors.push(m.text());
  });
  page.on("pageerror", (e) => ownerErrors.push(e.message));
  await page.goto(pages[0][0]);
  await expect(
    page.getByRole("button", { name: "Доступ", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await duplicateIds(page)).toEqual([]);
  await page.goto(pages[1][0]);
  await expect(
    page.getByRole("button", { name: "Редактировать запись", exact: true }),
  ).toBeVisible();
  expect(ownerErrors.filter((e) => hydrationError.test(e))).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
});

test("a hidden bike is a 404 page for guests", async ({ page, browser }) => {
  const nonce = randomUUID().slice(0, 8);
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Скрытный " + nonce,
          email: `hidden-${nonce}@example.test`,
          password: "server-render-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const created = await (
    await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Тайный " + nonce,
        brand: "Cube",
        model: "Nuroad",
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: false,
      },
    })
  ).json();
  const { bike } = await (
    await page.request.get("/api/bikes/" + created.id)
  ).json();
  const context = await browser.newContext();
  const guest = await context.newPage();
  const response = await guest.goto("/b/" + bike.share_id);
  expect(response.status()).toBe(404);
  await expect(
    guest.getByRole("heading", { name: "Здесь пока ничего нет" }),
  ).toBeVisible();
  await expect(
    guest.getByRole("link", { name: "войдите", exact: true }),
  ).toHaveAttribute(
    "href",
    "/login",
  );
  expect(await guest.content()).not.toContain("Тайный " + nonce);
  await context.close();
  // The owner still opens the private bike.
  await page.goto("/b/" + bike.share_id);
  await expect(
    page.getByRole("heading", { level: 1, name: "Тайный " + nonce }),
  ).toBeVisible();
});

test("a signed-in reader gets the header with the page, without asking /api/me", async ({
  page,
}) => {
  const nonce = randomUUID().slice(0, 8),
    name = "Читатель " + nonce;
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name,
          email: `reader-${nonce}@example.test`,
          password: "server-render-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const me = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/me") me.push(r.url());
  });
  for (const path of ["/", "/bikes", "/journal", "/articles", "/rides", "/market", "/records", "/search?q=cube", "/experience", "/saved", "/account", "/b/unknown-zzzzzzzz"]) {
    await page.goto(path);
    // The account menu is in the first HTML; the guest "Войти" never shows.
    await expect(page.getByLabel("Аккаунт — " + name).first()).toBeAttached();
    await expect(page.locator('a.nav-trigger[href="/account"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");
  }
  expect(me).toEqual([]);
});
