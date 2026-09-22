import { testConsents } from "../fixtures/legal.js";
import { test, expect, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(request, name) {
  const r = await request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: name + "@example.test",
      password: "community-browser-123",
    },
  });
  expect(r.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function bike(request, name) {
  const r = await request.post("/api/bikes", {
    headers: { origin },
    data: {
      name,
      brand: "Cube",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      is_public: true,
    },
  });
  expect(r.status()).toBe(201);
  return (await (await request.get("/api/bikes/" + (await r.json()).id)).json())
    .bike;
}
test("two riders discuss a bike, receive notifications, reply and discover new publications in subscriptions", async ({
  page,
  browser,
  isMobile,
}) => {
  const nonce = randomUUID().slice(0, 8),
    a = await register(page.request, "owner-" + nonce),
    first = await bike(page.request, "First " + nonce);
  const context = await browser.newContext({
    ...(isMobile ? devices["iPhone 13"] : {}),
    baseURL: origin,
  });
  try {
    const visitor = await context.newPage(),
      b = await register(visitor.request, "visitor-" + nonce);
    await visitor.goto("/b/" + first.share_id);
    await visitor.locator(".detail-actions .author-link").click();
    await visitor
      .getByRole("button", { name: "Подписаться", exact: true })
      .click();
    await expect(
      visitor.getByRole("button", { name: "Отписаться", exact: true }),
    ).toBeVisible();
    await visitor.goto("/b/" + first.share_id);
    await visitor
      .getByRole("button", { name: "Нравится: 0", exact: true })
      .click();
    await expect(
      visitor.getByRole("button", { name: "Нравится: 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const text = 'Как едет эта сборка? <img src=x onerror="window.xss=1">';
    await visitor
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill(text);
    await visitor
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(visitor.locator(".comment-body")).toHaveText(text);
    await expect(visitor.locator(".comment-body img")).toHaveCount(0);
    expect(await visitor.evaluate(() => window.xss)).toBeUndefined();
    await page.goto("/notifications");
    await expect(page.locator(".notification-list li")).toHaveCount(3);
    await expect(page.locator(".notification-list")).toContainText(
      "@" + b.username,
    );
    await expect(page.locator(".notification-list")).toContainText(
      "прокомментировал",
    );
    await page
      .locator(".notification-list li")
      .filter({ hasText: "прокомментировал" })
      .getByRole("link", { name: first.name, exact: true })
      .click();
    await expect(page.locator(".discussion .comment-body")).toHaveText(text);
    await page
      .locator(".discussion")
      .getByRole("button", { name: "Ответить", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Ваш ответ", exact: true })
      .fill("Отлично, особенно на городских маршрутах!");
    await page
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    await expect(page.locator(".comment-reply .comment-body")).toHaveText(
      "Отлично, особенно на городских маршрутах!",
    );
    await visitor.goto("/notifications");
    await expect(visitor.locator(".notification-list")).toContainText(
      "ответил вам",
    );
    await expect(visitor.locator(".global-nav .notification-badge")).toHaveText(
      "1",
    );
    await visitor
      .getByRole("button", { name: "Прочитать все", exact: true })
      .click();
    await expect(visitor.locator(".notification-list li.unread")).toHaveCount(
      0,
    );
    await expect(
      visitor.locator(".global-nav .notification-badge"),
    ).toHaveCount(0);
    const second = await bike(page.request, "New publication " + nonce);
    await visitor
      .getByRole("button", {
        name: (await visitor
          .getByRole("button", { name: "Открыть меню" })
          .isVisible())
          ? "Открыть меню"
          : /Аккаунт —/,
      })
      .click();
    // Account's mixed feed, not the journal-only subscriptions destination.
    await visitor.locator('.nav-menu-link[href="/feed"]:visible').click();
    await expect(visitor.locator(".bike-card").first()).toContainText(
      second.name,
    );
    await expect(visitor.locator(".bike-card")).toHaveCount(2);
    await expect
      .poll(() =>
        visitor.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.goto("/b/" + first.share_id);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
