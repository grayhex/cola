import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("component artwork: admin upload, persistence, protected deletion, themes and fallback; shared messages icon", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  let user, asset;
  try {
    const registration = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Graphics admin",
        email: randomUUID() + "@example.test",
        password: "graphics-test-secret",
      },
    });
    expect(registration.status()).toBe(201);
    user = (await registration.json()).user.id;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user]);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "Разделы админки" });
    await nav.getByRole("button", { name: "Значки", exact: true }).click();
    await page
      .getByLabel("Эмодзи вместо значка: Сообщения", { exact: true })
      .fill("✉️");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await nav.getByRole("button", { name: "Графика", exact: true }).click();
    const graphics = page.getByRole("region", { name: "Графика сайта" });
    await graphics
      .getByRole("button", { name: "Компоненты", exact: true })
      .click();
    await graphics
      .getByLabel("Группа", { exact: true })
      .selectOption("Управление и посадка");
    const bytes = await sharp({
      create: { width: 80, height: 80, channels: 4, background: "#d8a86e" },
    })
      .png()
      .toBuffer();
    await graphics
      .getByLabel("Файл: Группа · Управление и посадка", { exact: true })
      .setInputFiles({
        name: "cockpit.png",
        mimeType: "image/png",
        buffer: bytes,
      });
    const group = graphics.getByLabel("Группа · Управление и посадка", {
      exact: true,
    });
    await expect(group).toHaveValue(/^[0-9a-f-]{36}$/);
    asset = await group.inputValue();
    await graphics
      .getByLabel("Тип · Седло", { exact: true })
      .selectOption(asset);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await page.screenshot({
      path: info.outputPath("component-graphics-admin.png"),
      fullPage: true,
    });
    expect(
      (
        await page.request.delete("/api/admin/assets/" + asset, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    const library = await (
      await page.request.get("/api/admin/assets/library")
    ).json();
    expect(library.assets.find((a) => a.id === asset).usage).toContain(
      "Категории компонентов",
    );
    await page.reload();
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await nav.getByRole("button", { name: "Графика", exact: true }).click();
    await graphics
      .getByRole("button", { name: "Компоненты", exact: true })
      .click();
    await expect(
      graphics.getByLabel("Тип · Седло", { exact: true }),
    ).toHaveValue(asset);
    await page.goto("/components");
    // Header, desktop profile menu and mobile drawer share the icon slot.
    const icons = page.locator('.global-header [data-icon="messages"]');
    await expect(icons).toHaveCount(3);
    await expect(icons).toHaveText(["✉️", "✉️", "✉️"]);
    const trigger = page.getByRole("button", { name: /Управление и посадка/ });
    const image = trigger.locator("img");
    const assetUrl = new URL("/api/assets/" + asset, origin).href;
    await expect(image).toHaveJSProperty("src", assetUrl);
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await trigger.focus();
    await trigger.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const category = page
      .locator("#component-group-types")
      .getByRole("link", { name: "Седло", exact: true });
    await expect(category.locator("img")).toHaveJSProperty("src", assetUrl);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("component-art-" + theme + ".png"),
        fullPage: true,
      });
    }
    await page.route("**/api/assets/" + asset, (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.reload();
    await expect(trigger.locator("img")).toHaveCount(0);
    await expect(trigger.locator(".part-icon")).toBeVisible();
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    if (asset)
      await page.request.delete("/api/admin/assets/" + asset, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
