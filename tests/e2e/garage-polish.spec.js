import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("grouped icon overrides, local fonts, auth illustrations and public statistics", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  page.setDefaultTimeout(15000);
  await db.connect();
  const nonce = randomUUID();
  let original, asset, visitor;
  const settings = async (value) => {
    const latest = await (await page.request.get("/api/admin/overview")).json();
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: { value, version: latest.settingsVersion },
        })
      ).status(),
    ).toBe(200);
  };
  try {
    expect(
      (
        await page.request.post("/api/auth/register", {
          headers: { origin },
          data: {
            name: "Graphics",
            email: nonce + "@graphics.test",
            password: "graphics-browser-secret",
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get("/api/me")).json()).user;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    original = (await (await page.request.get("/api/admin/overview")).json())
      .settings;
    const bytes = await sharp({
      create: { width: 900, height: 120, channels: 3, background: "#c7d1c9" },
    })
      .png()
      .toBuffer();
    const uploaded = await page.request.post(
      "/api/admin/assets?name=Journal-graphics-fixture",
      { headers: { origin, "Content-Type": "image/png" }, data: bytes },
    );
    expect(uploaded.status()).toBe(201);
    asset = (await uploaded.json()).id;
    await settings({
      ...original,
      font: "onest",
      logoId: asset,
      navNewIconId: asset,
      loginImageId: asset,
      registerImageId: asset,
      uiIcons: { Heart: asset },
      partIconAssets: { saddle: asset },
      showAboutStats: true,
    });
    expect(
      (
        await page.request.delete("/api/admin/assets/" + asset, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Оформление", exact: true }).click();
    await expect(
      page
        .getByRole("combobox", { name: "Шрифт", exact: true })
        .locator("option"),
    ).toHaveCount(14);
    await page
      .locator("summary")
      .filter({ hasText: "Новые и популярные велосипеды" })
      .click();
    await expect(
      page.getByLabel("Новые велосипеды", { exact: true }),
    ).toHaveValue(asset);
    await page.getByLabel("Найти значок", { exact: true }).fill("Heart");
    await expect(page.locator(".all-icons .asset-picker")).toHaveCount(1);
    await expect(page.locator(".all-icons .asset-picker select")).toHaveValue(
      asset,
    );
    await page.goto("/about");
    await expect(
      page.getByRole("region", { name: "ColaBike в цифрах" }),
    ).toBeVisible();
    await expect(page.locator(".site-root")).toHaveAttribute(
      "data-font",
      "onest",
    );
    expect(
      await page.evaluate(async () => {
        await document.fonts.load('16px "Cola Onest"');
        return document.fonts.check('16px "Cola Onest"');
      }),
    ).toBe(true);
    if (isMobile) {
      const brand = await page.locator(".brand-illustrated").boundingBox();
      const logo = await page
        .locator(".brand-illustrated .site-logo")
        .boundingBox();
      expect(logo.height).toBeGreaterThanOrEqual(60);
      expect(Math.abs(brand.width - logo.width)).toBeLessThan(2);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("about-statistics-banner.png"),
      fullPage: true,
      animations: "disabled",
    });
    visitor = await browser.newContext({ baseURL: origin });
    visitor.setDefaultTimeout(15000);
    const auth = await visitor.newPage();
    await auth.goto("/");
    await expect(auth.locator(".global-header")).toBeVisible();
    const menu = auth.getByRole("button", {
      name: "Открыть меню",
      exact: true,
    });
    if (await menu.isVisible()) await menu.click();
    await auth.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(auth.locator(".auth-illustration")).toHaveAttribute(
      "src",
      "/api/assets/" + asset,
    );
    await auth
      .getByRole("button", {
        name: "Нет аккаунта? Зарегистрироваться",
        exact: true,
      })
      .click();
    await expect(auth.locator(".auth-illustration")).toHaveAttribute(
      "src",
      "/api/assets/" + asset,
    );
    await expect(
      auth.getByLabel("Подтвердите пароль", { exact: true }),
    ).toBeVisible();
  } finally {
    test.setTimeout(info.timeout + 15000);
    await visitor?.close();
    if (original) await settings(original);
    if (asset)
      await page.request.delete("/api/admin/assets/" + asset, {
        headers: { origin },
      });
    await db.end();
  }
});
