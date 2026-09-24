import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("content artwork remains editable and protected; retired interface graphics cannot be saved", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const register = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Graphics",
      email: randomUUID() + "@graphics.test",
      password: "graphics-browser-secret",
    },
  });
  expect(register.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  const original = (
    await (await page.request.get("/api/admin/overview")).json()
  ).settings;
  let asset;
  try {
    const bytes = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#c7d1c9" },
    })
      .png()
      .toBuffer();
    asset = (
      await (
        await page.request.post("/api/admin/assets?name=Content-artwork", {
          headers: { origin, "Content-Type": "image/png" },
          data: bytes,
        })
      ).json()
    ).id;
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Разделы админки" })
      .getByRole("button", { name: "Графика", exact: true })
      .click();
    await expect(page.getByText(/Legacy|Pixel Club/)).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "О проекте · руководство", exact: true })
      .selectOption(asset);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Настройки опубликованы на сайте",
    );
    expect(
      (
        await page.request.delete("/api/admin/assets/" + asset, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    const state = await (await page.request.get("/api/admin/overview")).json();
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: {
            value: { ...state.settings, uiIcons: { Heart: asset } },
            version: state.settingsVersion,
          },
        })
      ).status(),
    ).toBe(400);
    await page.goto("/about");
    await expect(
      page.getByRole("region", { name: "ColaBike в цифрах" }),
    ).toBeVisible();
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Cola Manrope");
    await expect(page.locator(".brand img")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("about-content.png"),
      fullPage: true,
    });
  } finally {
    const state = await (await page.request.get("/api/admin/overview")).json();
    await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: { value: original, version: state.settingsVersion },
    });
    if (asset)
      await page.request.delete("/api/admin/assets/" + asset, {
        headers: { origin },
      });
    await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
