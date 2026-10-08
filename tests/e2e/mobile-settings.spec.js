import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// The «Мобильное приложение» section (#338) in a real browser: upload, select
// and reset the launch image, reorder onboarding, a feature switch, a notice,
// the hard-update confirmation, protected deletion and the phone preview.
test("mobile app settings: publish launch, onboarding, notice and switches; assigned image is protected", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM mobile_settings WHERE id=1")
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
            name: "Mobile editor",
            email: randomUUID() + "@example.test",
            password: "mobile-settings-secret-123",
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
    // Its own block, not a part of the web «Дизайн»; its sections are items
    // of the left menu itself (#366).
    await page
      .getByRole("tab", { name: "Мобильное приложение", exact: true })
      .click();
    const menu = page.getByRole("navigation", { name: "Разделы админки" });
    const open = (name) =>
      menu.getByRole("button", { name, exact: true }).click();
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
      menu.getByRole("button", { name: "Экран запуска", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Экран запуска", level: 1 }),
    ).toBeVisible();
    const editor = page.getByRole("region", { name: "Мобильное приложение" });
    await expect(
      editor.getByRole("heading", { name: "Настройки Android-приложения" }),
    ).toBeVisible();
    await expect(
      editor.getByText("не системный Android SplashScreen", { exact: false }),
    ).toBeVisible();
    const save = editor.getByRole("button", {
      name: "Сохранить и опубликовать",
    });
    await expect(save).toBeDisabled();

    // Turning the screen on without an image is caught before saving.
    await editor
      .getByRole("switch", { name: "Показывать экран запуска" })
      .check();
    await expect(editor.locator(".admin-save")).toContainText(
      "Не опубликовано: экран запуска",
    );
    // The dot is on the section that holds the change, and only there.
    await expect(
      menu
        // The dot is part of the button's name.
        .getByRole("button", { name: /^Экран запуска Есть несохранённые/ })
        .getByLabel("Есть несохранённые изменения"),
    ).toBeVisible();
    await expect(menu.getByLabel("Есть несохранённые изменения")).toHaveCount(
      1,
    );
    await save.click();
    await expect(editor.getByRole("alert").first()).toContainText(
      "Выберите изображение экрана запуска",
    );

    // Upload, reset and select again.
    const uploaded = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/assets?") &&
        r.request().method() === "POST",
    );
    await editor
      .getByLabel("Файл: Изображение экрана запуска", { exact: true })
      .setInputFiles({
        name: "launch-e2e.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: {
            width: 1080,
            height: 1920,
            channels: 3,
            background: "#f3b51b",
          },
        })
          .png()
          .toBuffer(),
      });
    const response = await uploaded;
    expect(response.status()).toBe(201);
    const asset = (await response.json()).id;
    assets.push(asset);
    const picker = editor.getByRole("combobox", {
      name: "Изображение экрана запуска",
    });
    await expect(picker).toHaveValue(asset);
    const phone = editor.getByRole("img", {
      name: /Предпросмотр экрана запуска/,
    });
    await expect(phone.locator("img")).toHaveAttribute(
      "src",
      new RegExp(asset),
    );
    await editor
      .getByRole("button", { name: "Сбросить: Изображение экрана запуска" })
      .click();
    await expect(picker).toHaveValue("");
    await expect(phone).toContainText("Нет изображения");
    await picker.selectOption(asset);
    await editor
      .getByRole("combobox", { name: "Как показывать изображение" })
      .selectOption("fit");
    await expect(phone.locator("[data-mode=fit] img")).toBeVisible();
    await editor.getByLabel("Подпись", { exact: true }).fill("Привет, райдер");
    await expect(phone).toContainText("Привет, райдер");

    // Onboarding: two cards, the second moved up with the keyboard.
    await menu.getByRole("button", { name: "Знакомство", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      menu.getByRole("button", { name: "Знакомство", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Знакомство", level: 1 }),
    ).toBeVisible();
    // The notifications are not under every section, only under their own.
    await expect(page.getByRole("region", { name: "Уведомления" })).toHaveCount(
      0,
    );
    await editor.getByRole("switch", { name: /Показывать знакомство/ }).check();
    for (const title of ["Первая", "Вторая"]) {
      await editor.getByRole("button", { name: "Добавить карточку" }).click();
      await editor.getByLabel("Заголовок", { exact: true }).last().fill(title);
    }
    const up = editor.getByRole("button", { name: "Карточка 2: выше" });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(
      editor.getByLabel("Заголовок", { exact: true }).first(),
    ).toHaveValue("Вторая");
    // Focus stays with the moved card, on the button that still works.
    await expect(
      editor.getByRole("button", { name: "Карточка 1: ниже" }),
    ).toBeFocused();
    await expect(
      editor.getByRole("img", { name: /Предпросмотр карточки 1 из 2: Вторая/ }),
    ).toBeVisible();

    // A feature switch and a notice with an allowed link.
    await open("Функции");
    await editor.getByRole("switch", { name: /Барахолка/ }).uncheck();
    await expect(
      editor.getByRole("switch", { name: /Барахолка/ }),
    ).not.toBeChecked();
    await open("Сообщение");
    await editor.getByRole("switch", { name: "Показывать сообщение" }).check();
    await editor.getByRole("combobox", { name: "Тип" }).selectOption("service");
    await editor
      .getByLabel("Заголовок", { exact: true })
      .fill("Покатушки в субботу");
    await editor.getByLabel("Текст кнопки", { exact: true }).fill("Открыть");
    const link = editor.getByLabel("Ссылка кнопки", { exact: true });
    await link.fill("javascript:alert(1)");
    await expect(link).toHaveAttribute("aria-invalid", "true");
    await expect(
      editor.getByText("Внешний адрес — только https://", { exact: true }),
    ).toBeVisible();
    await link.fill("/rides");
    await expect(
      editor.getByRole("img", {
        name: /Предпросмотр сообщения «Покатушки в субботу»/,
      }),
    ).toContainText("Открыть");

    await save.click();
    await expect(editor.getByRole("status").first()).toContainText(
      "Опубликовано",
    );
    await expect(save).toBeDisabled();
    await expect(editor.locator(".admin-save")).toContainText(
      "Опубликована версия",
    );

    // Apps get the new revision with public fields only.
    const config = await (await page.request.get("/api/v1/app-config")).json();
    expect(config.launch).toEqual({
      enabled: true,
      imageUrl: "/api/assets/" + asset,
      contentMode: "fit",
      title: "Привет, райдер",
    });
    expect(config.onboarding.items.map((item) => item.title)).toEqual([
      "Вторая",
      "Первая",
    ]);
    expect(config.features.market).toBe(false);
    expect(config.notice.kind).toBe("service");
    expect(config.notice.action.url).toMatch(/\/rides$/);
    await expect(editor.locator("details pre")).toContainText(
      `"revision": ${config.revision},`,
    );

    // Hard update asks first; cancelling keeps everything as published.
    await open("Версии");
    await editor
      .getByLabel("Минимальная поддерживаемая версия", { exact: true })
      .fill("5");
    await editor
      .getByLabel("Ссылка на обновление", { exact: true })
      .fill("/about");
    await editor
      .getByRole("combobox", { name: "Если версия ниже минимальной" })
      .selectOption("hard");
    await save.click();
    const dialog = page.getByRole("alertdialog", {
      name: "Включить обязательное обновление?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toBeHidden();
    expect(
      (await (await page.request.get("/api/v1/app-config")).json())
        .compatibility.updateMode,
    ).toBe("soft");
    await save.click();
    await dialog
      .getByRole("button", { name: "Включить обязательное обновление" })
      .click();
    await expect(editor.getByRole("status").first()).toContainText(
      "Опубликовано",
    );
    expect(
      (await (await page.request.get("/api/v1/app-config")).json())
        .compatibility.updateMode,
    ).toBe("hard");

    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      for (const name of ["Экран запуска", "Знакомство", "Версии"]) {
        await open(name);
        expect(
          (await new AxeBuilder({ page }).include(".admin-content").analyze())
            .violations,
        ).toEqual([]);
      }
      await open("Экран запуска");
      await page.screenshot({
        path: info.outputPath(`mobile-settings-${mode}.png`),
        fullPage: true,
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);

    // The assigned image cannot be deleted from the media library.
    expect(
      (
        await page.request.delete("/api/admin/assets/" + asset, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Медиатека", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Найти файл" })
      .fill("launch-e2e");
    await expect(
      page.getByRole("article").filter({ hasText: "launch-e2e.png" }),
    ).toContainText("Мобильное приложение");
    await expect(
      page.getByRole("button", { name: "Удалить: launch-e2e.png" }),
    ).toBeDisabled();
  } finally {
    await db.query(
      "UPDATE mobile_settings SET value=$1,version=version+1,updated_at=now() WHERE id=1",
      [JSON.stringify(original)],
    );
    for (const id of assets)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
