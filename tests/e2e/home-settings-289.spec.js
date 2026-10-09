import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("home settings: source warning, three copy fields and four independent pulse icons survive save", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  const assets = [];
  let user;
  try {
    expect(
      (
        await registerVerified(page.request, {
          headers: { origin },
          data: {
            ...testConsents,
            name: "Home editor",
            email: randomUUID() + "@example.test",
            password: "home-settings-secret-123",
          },
        })
      ).status(),
    ).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user.id;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user]);
    await page.addInitScript(() =>
      localStorage.setItem("cola:theme", "system"),
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Главная", exact: true }).click();
    // Both hero pictures (light and dark theme, #382) recommend the size.
    await expect(
      page
        .getByText("Рекомендуем: минимум 2400×1030 px", { exact: false })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText("Рекомендуем: минимум 2400×1030 px", { exact: false }),
    ).toHaveCount(2);
    const picker = page.locator(".asset-picker").filter({
      has: page.getByRole("combobox", { name: "Hero — тёмная тема" }),
    });
    for (const [width, height] of [
      [640, 275],
      [2400, 1030],
    ]) {
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().includes("/api/admin/assets?") &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("Файл: Hero — тёмная тема", { exact: true })
        .setInputFiles({
          name: `hero-${width}.png`,
          mimeType: "image/png",
          buffer: await sharp({
            create: { width, height, channels: 3, background: "#19304a" },
          })
            .png()
            .toBuffer(),
        });
      const response = await uploaded;
      expect(response.status()).toBe(201);
      const asset = (await response.json()).id;
      assets.push(asset);
      await expect(
        page.getByRole("combobox", { name: "Hero — тёмная тема" }),
      ).toHaveValue(asset);
      // The size is read from the preview once it has loaded, and a preview
      // far down the page (the dark theme's picker is the second one, #382)
      // loads lazily: the administrator has it on the screen, so does the test.
      await picker.locator(".asset-picker-preview").scrollIntoViewIfNeeded();
      if (width === 640) {
        await expect(picker.getByRole("status")).toContainText(
          "640×275 px меньше рекомендуемого",
        );
        // The warning does not prevent publishing a previously valid source.
        await page
          .getByRole("button", { name: "Сохранить", exact: true })
          .click();
        await expect(
          page.getByText("Настройки опубликованы на сайте", { exact: true }),
        ).toBeVisible();
      } else await expect(picker.getByRole("status")).toHaveCount(0);
    }
    // Selecting an existing small image shows the same advisory as uploading.
    await page
      .getByRole("combobox", { name: "Hero — тёмная тема" })
      .selectOption(assets[0]);
    await expect(picker.getByRole("status")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Hero — тёмная тема" })
      .selectOption(assets[1]);
    await expect(picker.getByRole("status")).toHaveCount(0);
    await page
      .getByLabel("Надзаголовок hero", { exact: true })
      .fill("Больше общих историй");
    await page
      .getByRole("textbox", { name: /^Заголовок hero/ })
      .fill("Собираем велосипеды.\nЕдем вместе.");
    await page
      .getByRole("textbox", { name: "Подпись hero", exact: true })
      .fill("Своя сборка и новые маршруты.");
    await page.getByRole("button", { name: "Сохранить", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Сохранить", exact: true }),
    ).toBeDisabled();
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      expect(
        (await new AxeBuilder({ page }).include(".admin-content").analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`home-admin-${mode}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Значки", exact: true }).click();
    await page.getByRole("searchbox", { name: "Найти значок" }).fill("Планы:");
    const slots = [
      ["pulseToday", "Сегодня", "#b45309"],
      ["pulseTomorrow", "Завтра", "#2563eb"],
      ["pulseWeekend", "В выходные", "#0d9488"],
      ["pulseLater", "Позже", "#7c3aed"],
    ];
    for (const [, label, color] of slots) {
      await expect(
        page.getByLabel("Цвет выделения: Планы: " + label, { exact: true }),
      ).toHaveValue(color);
      await page
        .getByLabel("Эмодзи вместо значка: Планы: " + label, { exact: true })
        .fill(label === "Сегодня" ? "✨" : "");
    }
    await page
      .getByLabel("Цвет выделения: Планы: Завтра", { exact: true })
      .fill("#dd3366");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Сохранить", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("pulse-icon-settings.png"),
      fullPage: true,
    });
    await page.goto("/");
    await expect(
      page.getByText("Больше общих историй", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Собираем велосипеды.Едем вместе.",
    );
    await expect(
      page.getByText("Своя сборка и новые маршруты.", { exact: true }),
    ).toBeVisible();
    const pulse = page.locator("[data-ride-pulse]");
    await expect(pulse.locator('[data-icon="pulseToday"]')).toHaveText("✨");
    await expect(pulse.locator("svg.site-icon")).toHaveCount(3);
    for (const [key, , color] of slots) {
      const icon = pulse.locator(`[data-icon="${key}"]`);
      expect(
        await icon.evaluate((e) => e.style.getPropertyValue("--icon-color")),
      ).toBe(key === "pulseTomorrow" ? "#dd3366" : color);
    }
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Главная", exact: true }).click();
    await expect(
      page.getByLabel("Надзаголовок hero", { exact: true }),
    ).toHaveValue("Больше общих историй");
    await expect(
      page.getByRole("textbox", { name: /^Заголовок hero/ }),
    ).toHaveValue("Собираем велосипеды.\nЕдем вместе.");
    await expect(
      page.getByRole("textbox", { name: "Подпись hero", exact: true }),
    ).toHaveValue("Своя сборка и новые маршруты.");
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    for (const id of assets)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
