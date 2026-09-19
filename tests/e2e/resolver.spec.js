import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("wizard live trace, stop, partial import and mobile review", async ({
  page,
}, info) => {
  const suffix = randomUUID();
  const registered = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      name: "Resolver " + suffix,
      email: suffix + "@example.test",
      password: "resolver-browser-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Производитель", exact: true })
    .fill("Giant");
  await dialog
    .getByRole("combobox", { name: "Модель", exact: true })
    .fill("Contend");
  await dialog.getByLabel("Комплектация / версия").fill("AR 1");
  await dialog.getByLabel("Год", { exact: true }).fill("2024");
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(dialog.locator(".resolver-timeline")).toBeVisible();
  await expect(dialog.locator(".wizard-found")).toBeVisible();
  await expect(dialog.locator(".wizard-found")).toContainText(
    "характеристик распознаны",
  );
  await expect(
    dialog.getByRole("link", { name: "Источник комплектации" }),
  ).toHaveAttribute("href", /giant-bicycles/);
  await dialog.locator(".resolver-timeline summary").click();
  await expect(dialog.locator(".resolver-timeline")).toContainText(
    /Компоненты распознаны|Найдено в кеше/,
  );
  await page.screenshot({
    path: info.outputPath("resolver-result.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", {
      name: "Распознать по странице магазина",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Страница велосипеда", { exact: true })
    .fill("https://www.velo-port.ru/test-bike");
  page.on("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "Распознать страницу", exact: true })
    .click();
  await expect(dialog).toContainText("Найдена часть комплектации");
  await expect(dialog.locator(".wizard-found")).toContainText("3 из 3");
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(dialog.locator(".wizard-part")).toHaveCount(3);
  const contentBox = await dialog.locator(".wizard-content").boundingBox();
  const actionsBox = await dialog.locator(".wizard-actions").boundingBox();
  expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(
    actionsBox.y + 1,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("resolver-partial.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Назад", exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "Распознать по странице магазина",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Страница велосипеда", { exact: true })
    .fill("https://www.velo-port.ru/slow-bike");
  const failed = page.waitForEvent("requestfailed", {
    predicate: (r) => r.url().includes("/api/bikes/resolve-stream"),
  });
  await dialog
    .getByRole("button", { name: "Распознать страницу", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Остановить поиск", exact: true })
    .click();
  await failed;
  await expect(dialog).toContainText("Поиск остановлен");
  await expect(
    dialog.getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled();
});
test("wizard quick setup, identity confirmation, image size and successful save", async ({
  page,
}, info) => {
  const suffix = randomUUID();
  await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      name: "Wizard " + suffix,
      email: suffix + "@example.test",
      password: "resolver-browser-secret-123",
    },
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Добавить велосипед", exact: true }),
  ).toHaveCount(0);
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Год", { exact: true })).toHaveValue(
    String(new Date().getFullYear()),
  );
  await dialog
    .getByRole("combobox", { name: "Производитель", exact: true })
    .fill("Giant");
  await dialog
    .getByRole("combobox", { name: "Модель", exact: true })
    .fill("Contend");
  await dialog.getByLabel("Комплектация / версия").fill("AR 1");
  await dialog.getByLabel("Год", { exact: true }).fill("2024");
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(dialog.locator(".wizard-found")).toBeVisible();
  await dialog
    .getByRole("button", {
      name: "Распознать по странице магазина",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Страница велосипеда", { exact: true })
    .fill("https://www.velo-port.ru/test-bike");
  const prompts = [];
  page.on("dialog", async (d) => {
    prompts.push(d.message());
    await d.accept();
  });
  await dialog
    .getByRole("button", { name: "Распознать страницу", exact: true })
    .click();
  await expect(dialog).toContainText("Найдена часть комплектации");
  expect(prompts.some((p) => p.includes("Модель или год отличаются"))).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await dialog.locator(".wizard-add-picker summary").click();
  await expect(dialog.locator(".wizard-group-add button")).toHaveCount(7);
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  const small = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "small.png", mimeType: "image/png", buffer: small });
  await expect(dialog).toContainText("Фото слишком маленькое");
  const good = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "bike.png", mimeType: "image/png", buffer: good });
  await expect(dialog.locator(".wizard-local-photos img")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("wizard-details.png"),
    fullPage: true,
  });
  const beforeSave = prompts.length;
  await dialog
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(prompts).toHaveLength(beforeSave);
  await expect(
    page.getByRole("heading", { name: "Giant Contend AR 1 2024", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("bike-detail.png"),
    fullPage: true,
  });
});
