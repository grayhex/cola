import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Knowledge Rider",
      email: randomUUID() + "@example.test",
      password: "article-browser-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("article without a bike: illustrated Markdown, draft, publication, discussion and editing", async ({
  page,
}, info) => {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page);
  await page.goto("/articles/new");
  const documentMarker = randomUUID();
  await page.evaluate((marker) => {
    window.__articleDocumentMarker = marker;
  }, documentMarker);
  await page.getByLabel("Заголовок статьи").fill("Как выбрать покрышки");
  await page.getByLabel("Рубрика", { exact: true }).selectOption("equipment");
  await page.getByRole("tab", { name: "Исходник", exact: true }).click();
  await page
    .getByLabel("Исходник: Текст статьи")
    .fill(
      "## Диаметр\n\n**Размер** нужно проверять по ободу.\n\n- 700C\n- 29 дюймов",
    );
  const png = await sharp({
    create: { width: 320, height: 160, channels: 3, background: "#d59b44" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Иллюстрация", { exact: true })
    .setInputFiles({ name: "tire.png", mimeType: "image/png", buffer: png });
  await expect(page.getByLabel("Исходник: Текст статьи")).toHaveValue(/photo:/);
  await page.getByRole("tab", { name: "Предпросмотр", exact: true }).click();
  await expect(page.locator('[data-rich-editor] [role="tabpanel"]:visible strong')).toHaveText("Размер");
  await expect(page.locator('[data-rich-editor] [role="tabpanel"]:visible img')).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(page).toHaveURL(/\/articles\/[a-f0-9-]+$/);
  // Saving must use App Router, not tear down the document and its RSC prefetches.
  expect(await page.evaluate(() => window.__articleDocumentMarker)).toBe(documentMarker);
  await expect(page.locator(".article-heading")).toContainText("Черновик");
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.locator(".article-heading")).not.toContainText("Черновик");
  await expect(
    page.getByRole("heading", { name: "Как выбрать покрышки", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".article-prose img")).toBeVisible();
  await page
    .getByLabel("Ваш комментарий", { exact: true })
    .fill("Добавлю таблицу совместимости.");
  await page
    .getByRole("button", { name: "Отправить комментарий", exact: true })
    .click();
  await expect(page.locator(".comment")).toContainText(
    "Добавлю таблицу совместимости.",
  );
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("article.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/articles");
  await expect(
    page.locator(".article-card").filter({ hasText: "Как выбрать покрышки" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Рубрика статей", exact: true })
    .click();
  await page.getByRole("option", { name: /Компоненты и экипировка/ }).click();
  await expect(page.locator(".article-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("left admin navigation, configurable emoji, frame labels and one-tap weekly RSVP", async ({
  page,
  isMobile,
}, info) => {
  const user = await register(page);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let original;
  try {
    original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
      .rows[0].value;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const sidebar = page.getByRole("complementary", {
      name: "Управление сайтом",
    });
    await expect(
      sidebar.getByRole("tab", { name: "Система", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("tab", { name: "Каталог", exact: true }),
    ).toBeVisible();
    const heading = await page.locator(".admin-title h1").boundingBox();
    expect(heading.height).toBeLessThan(100);
    if (!isMobile) {
      const side = await sidebar.boundingBox(),
        content = await page.locator(".admin-content").boundingBox();
      expect(side.x + side.width).toBeLessThan(content.x + 1);
    }
    await sidebar.getByRole("button", { name: "Эмодзи", exact: true }).click();
    await page.getByLabel("Эмодзи: Запланировать", { exact: true }).fill("🌅");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/site")).json()).settings.emojis
            .plan,
      )
      .toBe("🌅");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("admin-sidebar.png"),
      fullPage: true,
      animations: "disabled",
    });
    const response = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "RSVP Bike",
        brand: "Merida",
        model: "Silex",
        year: 2022,
        category: "gravel",
        description: "",
        color: "",
        size: "L",
        weight: 10.4,
        is_public: true,
      },
    });
    expect(response.status()).toBe(201);
    const bike = await response.json();
    const planInput = {
      bikeId: bike.id,
      title: "Субботний круг",
      description: "Спокойный темп",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      recurrence: "weekly",
      recurrenceTimezone: "Europe/Moscow",
    };
    const created = await page.request.post("/api/rides/plan", {
      headers: { origin },
      data: planInput,
    });
    expect(created.status()).toBe(201);
    await page.goto("/account?tab=rides&action=plan");
    await expect(page.locator(".ride-form")).toBeVisible();
    await expect(page.locator(".ride-card")).toHaveCount(0);
    await expect(
      page
        .getByRole("button", { name: "Запланировать", exact: true })
        .locator(".site-emoji"),
    ).toHaveText("🌅");
    await expect(
      page.getByLabel("Повторять каждую неделю", { exact: false }),
    ).toBeVisible();
    await page.goto("/rides");
    const card = page
      .locator(".ride-card")
      .filter({ hasText: "Субботний круг" });
    await expect(card).toContainText("Каждую неделю");
    await card.getByRole("button", { name: /^Иду/ }).click();
    await expect(card.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await card.getByRole("button", { name: /^Может быть/ }).click();
    await expect(
      card.getByRole("button", { name: /^Может быть/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      card.getByRole("button", { name: /^Может быть/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("weekly-rsvp.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/bikes");
    const tile = page.locator(".bike-card").filter({ hasText: "RSVP Bike" });
    await expect(
      tile.getByLabel("Размер рамы: L", { exact: true }),
    ).toBeVisible();
    await expect(
      tile.getByLabel("Вес: 10.4 кг", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Порядок витрины", exact: true })
      .click();
    await page.getByRole("option", { name: "Популярные", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Порядок витрины", exact: true }),
    ).toContainText("Популярные");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("bike-labels.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    if (original)
      await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
        original,
      ]);
    await db.end();
  }
});
