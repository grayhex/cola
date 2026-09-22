import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(request, name) {
  const response = await request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: name + "@example.test",
      password: "colabike-social-e2e-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
test("account profile/avatar editing, public garage, author links and mutual mobile subscriptions", async ({
  page,
  browser,
  isMobile,
}, testInfo) => {
  const nonce = randomUUID().slice(0, 8),
    username = "social-" + nonce;
  await register(page.request, "owner-" + nonce);
  const bike = {
    name: "Social bicycle " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "Red",
    size: "M",
    weight: 14,
    is_public: true,
  };
  const result = await page.request.post("/api/bikes", {
    headers: { origin },
    data: bike,
  });
  expect(result.status()).toBe(201);
  await page.request.post("/api/bikes", {
    headers: { origin },
    data: { ...bike, name: "Private " + nonce, is_public: false },
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  const header = page.locator(".global-header");
  await expect(header).toBeVisible();
  await expect(
    header.getByRole("link", { name: /Уведомления:/ }),
  ).toBeVisible();
  await header
    .getByRole("button", {
      name: isMobile ? "Открыть меню" : /Аккаунт — owner-/,
    })
    .click();
  await expect(
    header.getByRole("link", { name: "Мой профиль", exact: true }),
  ).toBeVisible();
  await expect(
    header.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Отображаемое имя").fill("Велосипедист Сергей");
  await page
    .getByLabel("О себе", { exact: true })
    .fill("Собираю велосипеды для дальних поездок.");
  await page.getByLabel("Местоположение").fill("Москва");
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Профиль сохранён");
  const buffer = await sharp({
    create: { width: 80, height: 120, channels: 3, background: "#ee6744" },
  })
    .png()
    .toBuffer();
  await page
    .locator(".avatar-editor input[type=file]")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("status")).toHaveText("Аватар обновлён");
  await expect(page.locator(".avatar-editor img")).toBeVisible();
  await page.getByRole("button", { name: "Оформление", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Тема", exact: true })
    .selectOption("dark");
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await expect(page.getByRole("status")).toHaveText("Оформление сохранено");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("combobox", { name: "Тема", exact: true })
    .selectOption("light");
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Аккаунт", exact: true }).click();
  await expect(
    page.getByText("owner-" + nonce + "@example.test", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Мой публичный профиль", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Велосипедист Сергей", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("owner-" + nonce + "@example.test")).toHaveCount(
    0,
  );
  await expect(page.locator(".bike-card")).toHaveCount(1);
  await expect(page.getByText("Private " + nonce)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Изменить профиль" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  // A profile header must leave the collection within the first mobile screen.
  const collection = await page.locator(".profile-collection").boundingBox();
  expect(collection.y).toBeLessThan(
    testInfo.project.name === "webkit-mobile" ? 650 : 700,
  );
  await page.screenshot({
    path: testInfo.outputPath("public-profile.png"),
    fullPage: true,
  });
  const context = await browser.newContext({
    baseURL: process.env.TEST_ORIGIN || "http://localhost:3100",
  });
  try {
    const visitor = await context.newPage(),
      other = await register(visitor.request, "friend-" + nonce);
    await visitor.goto("/u/" + username);
    await visitor
      .getByRole("button", { name: "Подписаться", exact: true })
      .click();
    await expect(
      visitor.getByRole("button", { name: "Отписаться", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "1 Подписчики", exact: true })
      .click();
    await expect(page.locator(".people-list")).toContainText(
      "@" + other.username,
    );
    await page
      .locator(".people-list")
      .getByRole("button", { name: "Подписаться", exact: true })
      .click();
    await expect(page.locator(".people-list .friend-status")).toHaveText(
      "Друзья",
    );
    await visitor.reload();
    await expect(visitor.locator(".profile-hero .friend-status")).toHaveText(
      "Друзья",
    );
    await visitor.goto("/bikes");
    const card = visitor.locator(".bike-card").filter({ hasText: bike.name });
    await card.locator(".author-link").click();
    await expect(visitor).toHaveURL("/u/" + username);
    await visitor
      .locator(".bike-card")
      .getByRole("link", { name: bike.name, exact: true })
      .click();
    await expect(
      visitor.getByRole("heading", { name: bike.name, exact: true }),
    ).toBeVisible();
    await visitor.locator(".detail-actions .author-link").click();
    await expect(visitor).toHaveURL("/u/" + username);
    await visitor
      .getByRole("button", { name: "Отписаться", exact: true })
      .click();
    await expect(visitor.locator(".profile-hero .friend-status")).toHaveText(
      "Подписан на вас",
    );
    await page.goto("/account?tab=social");
    await page.getByRole("button", { name: /Друзья · 0/ }).click();
    await expect(page.locator(".people-list li")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
