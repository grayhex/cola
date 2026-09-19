import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
    .getByText("Распознать по странице магазина", { exact: true })
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
    .getByText("Распознать по странице магазина", { exact: true })
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
