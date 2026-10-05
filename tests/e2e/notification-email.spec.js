import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import pg from "pg";
import { runNotificationEmailBatch } from "../../lib/notification-email.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("notification email settings: opt-in, keyboard, themes, rollback and unsigned visitor unsubscribe", async ({
  page,
  browser,
}, info) => {
  const q = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const other = await browser.newContext({ baseURL: origin });
  const ids = [];
  try {
    for (const request of [page.request, other.request]) {
      expect(
        (
          await registerVerified(request, {
            headers: { origin },
            data: {
              ...testConsents,
              name: "Email settings",
              email: randomUUID() + "@example.test",
              password: "email-ui-secret-123",
            },
          })
        ).status(),
      ).toBe(201);
      ids.push((await (await request.get("/api/me")).json()).user.id);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/account?tab=account");
    const settings = page.getByRole("region", { name: "Уведомления" });
    const enabled = settings.getByLabel("Получать уведомления по почте", {
      exact: true,
    });
    await expect(enabled).not.toBeChecked();
    await enabled.focus();
    await page.keyboard.press("Space");
    await expect(enabled).toBeChecked();
    await settings.getByLabel("Комментарии и ответы").check();
    await settings
      .getByRole("button", { name: "Сохранить уведомления" })
      .click();
    // The first live region is the mail block's; the policy group below has its own.
    await expect(settings.getByRole("status").first()).toContainText(
      "Настройки уведомлений сохранены",
    );
    for (const color of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        color,
      );
      await expect
        .poll(
          async () =>
            (await new AxeBuilder({ page }).include("main").analyze())
              .violations,
        )
        .toEqual([]);
      await page.screenshot({
        path: info.outputPath("notification-settings-" + color + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    // Failure restores the persisted state, rather than claiming an opt-out.
    await page.route("**/api/account/notifications", async (route) => {
      if (route.request().method() === "PATCH")
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Не удалось сохранить настройки" }),
        });
      else await route.continue();
    });
    await enabled.uncheck();
    await settings
      .getByRole("button", { name: "Сохранить уведомления" })
      .click();
    await expect(settings.getByRole("alert")).toContainText(
      "Не удалось сохранить",
    );
    await expect(enabled).toBeChecked();
    await page.unroute("**/api/account/notifications");
    const created = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Mail UI bike",
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
    expect(created.status()).toBe(201);
    const bike = (await created.json()).id;
    expect(
      (
        await other.request.post("/api/community/bikes/" + bike + "/comments", {
          headers: { origin },
          data: { body: "UI test comment" },
        })
      ).status(),
    ).toBe(201);
    const messages = [];
    const counts = await runNotificationEmailBatch(q, {
      send: async (message) => messages.push(message),
    });
    expect(counts.sent).toBe(1);
    const url = messages[0].text.match(
      /https?:\/\/[^\s]+\/unsubscribe#[^\s]+/,
    )?.[0];
    expect(url).toBeTruthy();
    const guest = await browser.newContext({ baseURL: origin });
    try {
      const visitor = await guest.newPage();
      await visitor.goto(url);
      await expect(
        visitor.getByRole("button", { name: "Отключить уведомления" }),
      ).toBeEnabled();
      expect(new URL(visitor.url()).hash).toBe("");
      await visitor
        .getByRole("button", { name: "Отключить уведомления" })
        .click();
      await expect(visitor.getByRole("status")).toContainText(
        "Уведомления отключены",
      );
      await visitor.screenshot({
        path: info.outputPath("notification-unsubscribe.png"),
        fullPage: true,
      });
    } finally {
      await guest.close();
    }
    await page.reload();
    await expect(enabled).not.toBeChecked();
  } finally {
    await other.close();
    await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await q.end();
  }
});
test("notification settings load failure can be retried without losing account controls", async ({
  page,
}) => {
  expect(
    (
      await registerVerified(page.request, {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Email retry",
          email: randomUUID() + "@example.test",
          password: "email-ui-retry-123",
        },
      })
    ).status(),
  ).toBe(201);
  await page.route("**/api/account/notifications", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Настройки временно недоступны" }),
    }),
  );
  await page.goto("/account?tab=account");
  const settings = page.getByRole("region", { name: "Уведомления" });
  await expect(settings.getByRole("alert")).toContainText(
    "временно недоступны",
  );
  await expect(page.getByRole("region", { name: "Пароль" })).toBeVisible();
  await page.unroute("**/api/account/notifications");
  await settings
    .getByRole("button", { name: "Повторить загрузку уведомлений" })
    .click();
  await expect(
    settings.getByLabel("Получать уведомления по почте"),
  ).toBeEnabled();
});
