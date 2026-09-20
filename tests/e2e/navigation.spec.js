import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("navigation: real destinations, account, keyboard, configurable About and assets", async ({
  page,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const suffix = randomUUID().slice(0, 8),
    name = "Nav " + suffix;
  let original, asset;
  async function noOverflow() {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  async function openAccount() {
    await page
      .getByRole("button", {
        name: isMobile ? "Открыть меню" : "Аккаунт — " + name,
      })
      .click();
    return isMobile
      ? page.getByRole("dialog", { name: "Меню ColaBike" })
      : page.locator(".account-disclosure .nav-popover");
  }
  async function save(value) {
    const latest = await (await page.request.get("/api/admin/overview")).json();
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: { value, version: latest.settingsVersion },
        })
      ).status(),
    ).toBe(200);
  }
  try {
    await page.goto("/about");
    await expect(
      page.getByRole("heading", { name: "О проекте", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#history")).toHaveCount(0);
    await expect(page.locator(".about-actions")).toHaveCount(0);
    await expect(page.locator(".about-section")).toHaveCount(2);
    if (isMobile) {
      await page.getByRole("button", { name: "Открыть меню" }).click();
      const drawer = page.getByRole("dialog", { name: "Меню ColaBike" });
      await expect(
        drawer.getByRole("link", { name: "Добавить велосипед", exact: true }),
      ).toHaveCount(0);
      await expect(
        drawer.getByRole("link", { name: "Войти", exact: true }),
      ).toBeVisible();
      // Native modal focus containment, including reverse Tab from its first control.
      await drawer.getByRole("button", { name: "Закрыть панель" }).focus();
      await page.keyboard.press("Shift+Tab");
      expect(
        await drawer.evaluate((d) => d.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Открыть меню" }),
      ).toBeFocused();
    } else {
      const bikes = page.getByRole("button", {
        name: "Велосипеды",
        exact: true,
      });
      await bikes.focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("link", { name: "Витрина", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("End");
      await expect(
        page.getByRole("link", { name: "Рекорды", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("link", { name: "Витрина", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(bikes).toBeFocused();
      await bikes.click();
      await page.locator("h1").click();
      await expect(bikes).toHaveAttribute("aria-expanded", "false");
      await bikes.click();
      await page.getByRole("link", { name: "Популярные", exact: true }).click();
      await expect(
        page.getByRole("combobox", { name: "Порядок витрины" }),
      ).toHaveValue("popular");
      await page.goto("/about");
    }
    const registered = await page.request.post("/api/auth/register", {
      headers: { origin },
      data: {
        name,
        email: suffix + "@nav.example.test",
        password: "navigation-e2e-secret-123",
      },
    });
    expect(registered.status()).toBe(201);
    const user = (await (await page.request.get("/api/me")).json()).user;
    expect(
      (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name: "Navigation bike",
            brand: "Cube",
            model: "Travel",
            year: 2020,
            category: "road",
            description: "",
            color: "",
            size: "",
            weight: null,
            is_public: true,
          },
        })
      ).status(),
    ).toBe(201);
    await page.reload();
    let account = await openAccount();
    await expect(account).toContainText("@" + user.username);
    await expect(
      account.getByRole("link", { name: "Админка", exact: true }),
    ).toHaveCount(0);
    await expect(account.locator(".nav-account-stats")).toContainText(
      "Велосипеды",
    );
    await expect(account.locator(".nav-account-stats dd")).toHaveText([
      "1",
      "0",
      "0",
    ]);
    await page.screenshot({
      path: info.outputPath("account-menu.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    if (isMobile)
      await page.getByRole("button", { name: "Открыть меню" }).click();
    else
      await page
        .getByRole("button", { name: "Покатушки", exact: true })
        .click();
    await page
      .getByRole("link", { name: "Добавить покатушку", exact: true })
      .click();
    await expect(page.getByLabel("GPX-файл")).toBeVisible();
    await page.goto("/about");
    if (isMobile)
      await page.getByRole("button", { name: "Открыть меню" }).click();
    else
      await page
        .getByRole("button", { name: "Велосипеды", exact: true })
        .click();
    await page
      .getByRole("link", { name: "Добавить велосипед", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Тип велосипеда"),
    ).toBeVisible();
    await page.goto("/about");
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    original = (await (await page.request.get("/api/admin/overview")).json())
      .settings;
    const image = await sharp({
      create: { width: 400, height: 120, channels: 3, background: "#ddd2bf" },
    })
      .png()
      .toBuffer();
    const upload = await page.request.post(
      "/api/admin/assets?name=Navigation-fixture",
      { headers: { origin, "Content-Type": "image/png" }, data: image },
    );
    expect(upload.status()).toBe(201);
    asset = (await upload.json()).id;
    await save({
      ...original,
      logoId: asset,
      navAboutIconId: asset,
      aboutGuideImageId: asset,
    });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Оформление", exact: true }).click();
    const navAbout = page
      .locator(".navigation-settings")
      .getByRole("group", { name: "О проекте", exact: true });
    await navAbout.getByLabel("Название в меню").fill("Знакомство");
    await navAbout.getByRole("button", { name: "Выше: about" }).click();
    await navAbout.getByRole("button", { name: "Выше: about" }).click();
    await navAbout.getByRole("button", { name: "Выше: about" }).click();
    await page.getByRole("button", { name: /^О проекте(?: |$)/ }).click();
    const tech = page.getByRole("group", { name: "Под капотом", exact: true });
    await tech.getByLabel("Показывать раздел", { exact: true }).uncheck();
    const guide = page.getByRole("group", {
      name: "Как устроен ColaBike",
      exact: true,
    });
    await guide.getByLabel("Заголовок раздела").fill("Быстрый старт");
    await guide.getByLabel("02 · Меньше переписывания").uncheck();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/admin/overview")).json())
            .settings.navigation?.[0]?.id,
      )
      .toBe("about");
    await page.goto("/about");
    await expect(
      page.getByRole("heading", { name: "Быстрый старт", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#technology")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "02 · Меньше переписывания",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator("#guide .about-illustration img"),
    ).toHaveAttribute("src", "/api/assets/" + asset);
    expect(
      (
        await page.request.delete("/api/admin/assets/" + asset, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    if (isMobile) {
      await page.getByRole("button", { name: "Открыть меню" }).click();
      await expect(page.locator(".mobile-nav-section").first()).toContainText(
        "Знакомство",
      );
      await noOverflow();
      await page.keyboard.press("Escape");
    } else {
      await expect(
        page.locator(".primary-navigation > :first-child"),
      ).toHaveText("Знакомство");
      await expect(
        page.locator(".primary-navigation > :first-child"),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.locator(".primary-navigation > :first-child img"),
      ).toHaveAttribute("src", "/api/assets/" + asset);
    }
    await noOverflow();
    await page.screenshot({
      path: info.outputPath("configured-about.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    account = await openAccount();
    await expect(
      account.getByRole("link", { name: "Админка", exact: true }),
    ).toBeVisible();
    expect(
      await account.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 740 });
    await noOverflow();
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await noOverflow();
    await page.screenshot({
      path: info.outputPath("narrow-menu.png"),
      fullPage: true,
      animations: "disabled",
    });
    const drawerAccount = page.locator(".navigation-drawer .mobile-account");
    await drawerAccount
      .getByRole("button", { name: "Выйти", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("mobile-account.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await save(original);
    original = null;
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get("/api/me")).json()).user)
      .toBe(null);
  } finally {
    test.setTimeout(info.timeout + 15000);
    if (original) await save(original);
    await db.end();
  }
});
