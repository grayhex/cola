import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #366: the sections of the Android app's settings are items of the admin
// menu itself, the account menu and the footer carry no duplicates.
async function member(request, name, admin = false, db) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "admin-menus-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const user = (await (await request.get("/api/me")).json()).user;
  if (admin)
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  return user;
}

test("admin: the app's sections are menu items; drafts, dots and errors follow them, notifications stay apart", async ({
  page,
}, info) => {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const original = (
    await db.query("SELECT value FROM mobile_settings WHERE id=1")
  ).rows[0].value;
  let user;
  try {
    user = await member(page.request, "Menu admin", true, db);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin");
    await page
      .getByRole("tab", { name: "Мобильное приложение", exact: true })
      .click();
    const menu = page.getByRole("navigation", { name: "Разделы админки" });
    // The dot of unsaved changes is part of the button's name.
    const item = (name) =>
      menu.getByRole("button", { name: new RegExp("^" + name + "( Есть|$)") });
    const open = (name) => item(name).click();
    const dots = menu.getByLabel("Есть несохранённые изменения");

    // Seven items, no intermediate «Настройки приложения».
    await expect(menu.getByRole("button")).toHaveText([
      "Экран запуска",
      "Знакомство",
      "Сообщение",
      "Ссылки",
      "Функции",
      "Версии",
      "Уведомления",
    ]);
    await expect(
      page.getByRole("button", { name: "Настройки приложения" }),
    ).toHaveCount(0);
    // Each item opens its own block, and the notifications only theirs.
    const mobile = page.getByRole("region", { name: "Мобильное приложение" });
    const notifications = page.getByRole("region", { name: "Уведомления" });
    for (const name of [
      "Экран запуска",
      "Знакомство",
      "Сообщение",
      "Ссылки",
      "Функции",
      "Версии",
    ]) {
      await open(name);
      await expect(item(name)).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(mobile).toBeVisible();
      await expect(notifications).toHaveCount(0);
    }
    await open("Уведомления");
    await expect(item("Уведомления")).toHaveAttribute("aria-current", "page");
    await expect(notifications).toBeVisible();
    await expect(mobile).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Настройки Android-приложения" }),
    ).toBeHidden();

    // A draft survives moving around, and each dot is on the item that holds it.
    await open("Экран запуска");
    await mobile
      .getByRole("switch", { name: "Показывать экран запуска" })
      .check();
    await open("Ссылки");
    await mobile
      .getByLabel("Помощь", { exact: true })
      .fill("javascript:alert(1)");
    await open("Уведомления");
    const perDay = notifications.getByLabel(
      "Предложений наружу на человека в сутки",
    );
    await perDay.fill("4");
    await expect(dots).toHaveCount(3);
    for (const name of ["Экран запуска", "Ссылки", "Уведомления"])
      await expect(
        item(name).getByLabel("Есть несохранённые изменения"),
      ).toBeVisible();
    await open("Экран запуска");
    await expect(
      mobile.getByRole("switch", { name: "Показывать экран запуска" }),
    ).toBeChecked();
    await open("Ссылки");
    await expect(mobile.getByLabel("Помощь", { exact: true })).toHaveValue(
      "javascript:alert(1)",
    );
    await page.screenshot({
      path: info.outputPath("admin-menu-links.png"),
      fullPage: true,
      animations: "disabled",
    });

    // Saving one form does not touch the other: two forms, two requests.
    const writes = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/api/admin/"))
        writes.push(new URL(request.url()).pathname);
    });
    await open("Уведомления");
    await notifications.getByRole("button", { name: "Сохранить" }).click();
    await expect(notifications.getByRole("status").first()).toContainText(
      "Настройки уведомлений сохранены",
    );
    expect(writes).toEqual(["/api/admin/notifications"]);
    await expect(
      item("Уведомления").getByLabel("Есть несохранённые изменения"),
    ).toHaveCount(0);
    await expect(dots).toHaveCount(2);

    // A mistake opens the section that holds it, and the menu shows it; the
    // typed values stay.
    await open("Версии");
    await mobile
      .getByRole("button", { name: "Сохранить и опубликовать" })
      .click();
    await expect(item("Экран запуска")).toHaveAttribute("aria-current", "page");
    await expect(mobile.getByRole("alert").first()).toContainText(
      "Исправьте поля",
    );
    await expect(
      mobile.getByRole("switch", { name: "Показывать экран запуска" }),
    ).toBeChecked();
    expect(writes).toEqual(["/api/admin/notifications"]);
    await open("Ссылки");
    const link = mobile.getByLabel("Помощь", { exact: true });
    await expect(link).toHaveValue("javascript:alert(1)");
    await expect(link).toHaveAttribute("aria-invalid", "true");

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      expect(
        (await new AxeBuilder({ page }).include(".admin-nav").analyze())
          .violations,
      ).toEqual([]);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await db.query(
      "UPDATE notification_limits SET discovery_per_day=3,disabled_categories='{}',version=version+1",
    );
    await db.query(
      "UPDATE mobile_settings SET value=$1,version=version+1,updated_at=now() WHERE id=1",
      [JSON.stringify(original)],
    );
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});

test("account menu without «Уведомления» and «Достижения», the bell stays; footer without graphics credits", async ({
  page,
  isMobile,
}, info) => {
  const name = "Menu " + randomUUID().slice(0, 8);
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  let user;
  try {
    user = await member(page.request, name, false, db);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", {
        name: isMobile ? "Открыть меню" : "Аккаунт — " + name,
      })
      .click();
    // The phone's drawer holds the site's sections as well, with links of its
    // own named alike («Подписки»): the account part is its own region.
    const account = isMobile
      ? page
          .getByRole("dialog", { name: "Меню ColaBike" })
          .getByRole("region", { name: "Аккаунт" })
      : page.locator(".account-disclosure .nav-popover");
    await expect(
      account.getByRole("link", { name: "Мой профиль" }),
    ).toBeVisible();
    for (const label of ["Подписки", "Сохранённое", "Мои велосипеды"])
      await expect(
        account.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    for (const label of ["Достижения", "Уведомления"])
      await expect(account.getByRole("link", { name: label })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("account-menu-366.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");

    // The way to the notifications is the bell in the header.
    const bell = page
      .locator(".global-header")
      .getByRole("link", { name: /^Уведомления: \d+ непрочитанных/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page).toHaveURL(/\/notifications$/);

    // The footer has neither the credits link nor the licences block, in any
    // theme or width; the licences are on the About page.
    for (const colorScheme of ["light", "dark"])
      for (const width of [1280, 390]) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/");
        const footer = page.locator("footer");
        await expect(footer).toContainText("Люди. Велосипеды. Истории.");
        await expect(footer).not.toContainText("Авторы графики");
        await expect(footer).not.toContainText("Лицензии графики");
        await expect(footer.locator("details")).toHaveCount(0);
        await expect(footer.locator("[class*=credits]")).toHaveCount(0);
      }
    await page.goto("/about");
    const licenses = page.getByRole("region", { name: "Лицензии" });
    await expect(licenses.getByRole("link")).toHaveCount(4);
    const font = await page.request.get(
      await licenses
        .getByRole("link", { name: "SIL OFL 1.1" })
        .first()
        .getAttribute("href"),
    );
    expect(font.status()).toBe(200);
    expect((await font.text()).toLowerCase()).toContain("open font license");
    await expect(page.locator("footer")).not.toContainText("Авторы графики");
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
  } finally {
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
