import { testConsents } from "../fixtures/legal.js";
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
  // Fail on the missing control, with time left to restore shared settings.
  page.setDefaultTimeout(15000);
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
    // The reference page of the marketing mode (#127): value first, no AI
    // history and no separate "add a bike" / "see rides" buttons.
    await expect(
      page.getByRole("heading", { level: 1, name: /есть история/ }),
    ).toBeVisible();
    await expect(page.locator("#history")).toHaveCount(0);
    await expect(page.locator(".about-actions")).toHaveCount(0);
    await expect(page.locator("#guide, #technology")).toHaveCount(2);
    await expect(
      page.locator("main").getByRole("link", { name: "Добавить велосипед" }),
    ).toHaveCount(0);
    await expect(
      page.locator("main").getByRole("link", { name: /покатушки/i }),
    ).toHaveCount(0);
    // Demonstrations are pictures: nothing inside them takes focus.
    await expect(
      page.locator(".mk-demo").locator("a, button, input, [tabindex]"),
    ).toHaveCount(0);
    // The legal documents moved here from the footer (#124).
    for (const name of [
      "Пользовательское соглашение",
      "Политика обработки персональных данных",
    ])
      await expect(
        page.locator("main").getByRole("link", { name, exact: true }),
      ).toBeVisible();
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Журнал" })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "GitHub" })).toHaveCount(0);
    await expect(footer).toContainText("Люди. Велосипеды. Истории.");
    await expect(footer.locator(".build-versions")).toBeVisible();
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
        name: "Подразделы: Велосипеды",
        exact: true,
      });
      await bikes.focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("link", { name: "Все велосипеды", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("End");
      await expect(
        page.getByRole("link", { name: "Рекорды", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("link", { name: "Все велосипеды", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(bikes).toBeFocused();
      await bikes.click();
      // Click the actual heading text outside the menu, not its full-width box
      // centre, which can legitimately sit beneath a desktop dropdown.
      await page.locator("h1").click({ position: { x: 10, y: 10 } });
      await expect(bikes).toHaveAttribute("aria-expanded", "false");
      await bikes.click();
      await page.getByRole("link", { name: "Популярные", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Порядок витрины" }),
      ).toContainText("Популярные");
      await page.goto("/about");
    }
    const registered = await page.request.post("/api/auth/register", {
      headers: { origin },
      data: {
        ...testConsents,
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
        .getByRole("button", { name: "Подразделы: Покатушки", exact: true })
        .click();
    await page
      .getByRole("link", { name: "Добавить покатушку", exact: true })
      .click();
    await expect(page.getByLabel("Файл трека", { exact: false })).toBeVisible();
    await page.goto("/about");
    if (isMobile)
      await page.getByRole("button", { name: "Открыть меню" }).click();
    else
      await page
        .getByRole("button", { name: "Подразделы: Велосипеды", exact: true })
        .click();
    await page
      .getByRole("link", { name: "Добавить велосипед", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByLabel("Модель, год и комплектация", { exact: true }),
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

      aboutGuideImageId: asset,
      footerImage1Id: asset,
      footerImage2Id: asset,
      footerImage4Id: asset,
      footerLink1: "/about",
      footerLink4: "https://example.com/partner",
    });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const adminNav = page.getByRole("navigation", { name: "Разделы админки" });
    await adminNav.getByRole("button", { name: "Меню", exact: true }).click();
    const menu = page.getByRole("list", {
      name: "Порядок разделов меню",
      exact: true,
    });
    await menu
      .getByRole("textbox", { name: "Название в меню: О проекте", exact: true })
      .fill("Знакомство");
    const moveAboutUp = menu.getByRole("button", {
      name: "Выше: О проекте",
      exact: true,
    });
    for (let i = 1; i < (await menu.getByRole("listitem").count()); i++)
      await moveAboutUp.click();
    await expect(moveAboutUp).toBeDisabled();
    await expect(
      menu.getByRole("listitem").first().getByRole("textbox"),
    ).toHaveValue("Знакомство");
    await noOverflow();
    await adminNav
      .getByRole("button", {
        name: /^О проекте(?:\s*Есть несохранённые изменения)?$/,
      })
      .click();
    const tech = page.getByRole("group", { name: "Под капотом", exact: true });
    await tech.getByLabel("Показывать раздел", { exact: true }).uncheck();
    const guide = page.getByRole("group", {
      name: "Как устроен ColaBike",
      exact: true,
    });
    await guide.getByLabel("Заголовок раздела").fill("Быстрый старт");
    await guide.getByLabel("Журнал изменений и обслуживания").uncheck();
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
        name: "Журнал изменений и обслуживания",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("#guide img")).toHaveAttribute(
      "src",
      "/api/assets/" + asset,
    );
    // Footer logos from Графика → Подвал on the left of the brand (#107),
    // up to four in one line, each with its own link (#124).
    const footerImages = page.locator("footer [data-footer-images] img");
    await expect(footerImages).toHaveCount(3);
    const logoLinks = page.locator("footer [data-footer-images] a");
    await expect(logoLinks).toHaveCount(2);
    await expect(logoLinks.first()).toHaveAttribute("href", "/about");
    await expect(logoLinks.last()).toHaveAttribute(
      "href",
      "https://example.com/partner",
    );
    await expect(logoLinks.last()).toHaveAttribute("target", "_blank");
    await expect(logoLinks.last()).toHaveAccessibleName(/example\.com/);
    await expect(footerImages.first()).toHaveAttribute(
      "src",
      "/api/assets/" + asset,
    );
    await expect(footerImages.first()).toHaveAttribute("alt", "");
    // ColaBike and the tagline sit in the middle of the page; the logos are
    // on its left on wide screens and above it on phones (#124).
    const brandLine = page
      .locator("footer p")
      .filter({ hasText: "Люди. Велосипеды. Истории." });
    await footerImages.last().scrollIntoViewIfNeeded();
    const logo = await footerImages.first().boundingBox(),
      line = await brandLine.boundingBox(),
      band = await page.locator("footer").boundingBox();
    expect(
      Math.abs(line.x + line.width / 2 - (band.x + band.width / 2)),
    ).toBeLessThan(2);
    if (isMobile) expect(logo.y + logo.height).toBeLessThanOrEqual(line.y + 1);
    else expect(logo.x + logo.width).toBeLessThanOrEqual(line.x + 1);
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
      ).toContainText("Знакомство");
      await expect(
        page.locator(".primary-navigation > :first-child"),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.locator(".primary-navigation > :first-child img"),
      ).toHaveCount(0);
      await expect(
        page.locator(".primary-navigation > :first-child svg.site-icon"),
      ).toBeVisible();
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
    try {
      if (original) await save(original);
    } finally {
      await db.end();
    }
  }
});
