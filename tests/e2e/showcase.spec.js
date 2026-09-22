import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
async function register(page, name) {
  await page.goto("/bikes");
  await expect(page.locator(".global-header")).toBeVisible();
  if (await page.getByRole("button", { name: "Открыть меню" }).isVisible())
    await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Нет аккаунта? Зарегистрироваться",
      exact: true,
    })
    .click();
  await page.locator("input[name=name]").fill(name);
  await page.locator("input[name=email]").fill(name + "@example.test");
  await page.locator("input[name=password]").fill("colabike-e2e-secret-123");
  await page
    .locator("input[name=confirmPassword]")
    .fill("different-secret-123");
  await page.getByRole("checkbox", { name: "Принять пользовательское соглашение" }).check();
  await page.getByRole("checkbox", { name: "Согласен с политикой обработки персональных данных" }).check();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Пароли не совпадают",
  );
  expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
  await page
    .locator("input[name=confirmPassword]")
    .fill("colabike-e2e-secret-123");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect
    .poll(
      async () => (await (await page.request.get("/api/me")).json()).user?.name,
    )
    .toBe(name);
}
test("registration, touch autocomplete, bike/photo, public feed, like and revoke", async ({
  page,
  browser,
  isMobile,
}) => {
  const name = "e2e-" + randomUUID(),
    bikeName = "Bike " + name;
  await register(page, name);
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Тип велосипеда").selectOption("mtb");
  await expect(dialog.getByLabel("Год", { exact: true })).toHaveValue(
    String(new Date().getFullYear()),
  );
  const brand = dialog.getByRole("combobox", {
    name: "Производитель",
    exact: true,
  });
  await brand.fill("");
  await brand.click();
  const popup = dialog.locator(".combo-popup").first();
  await expect(popup).toBeVisible();
  // A moving/cancelled touch must not commit a value, including its synthetic click.
  const row = popup.getByRole("option").first();
  await row.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 120,
  });
  await row.dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 60,
  });
  await popup.locator("ul").evaluate((el) => {
    el.scrollTop = 60;
  });
  await row.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 60,
  });
  await row.dispatchEvent("click", { detail: 1 });
  await expect(brand).toHaveValue("");
  await brand.fill("Cub");
  const cube = dialog
    .locator(".combo-popup")
    .getByRole("option", { name: "Cube", exact: true });
  if (isMobile) await cube.tap();
  else await cube.click();
  await expect(brand).toHaveValue("Cube");
  const model = dialog.getByRole("combobox", { name: "Модель", exact: true });
  await model.click();
  const option = dialog.locator(".combo-popup").getByRole("option").first();
  const modelName = await option.textContent();
  if (isMobile) await option.tap();
  else await option.click();
  await expect(model).toHaveValue(modelName);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await dialog.getByLabel("Год", { exact: true }).fill("2020");
  await dialog.getByLabel("Название в гараже · необязательно").fill(bikeName);
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Далее", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  await dialog.getByRole("button", { name: "Далее", exact: true }).click();
  const bytes = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#ff6633" },
  })
    .png()
    .toBuffer();
  await dialog
    .locator("input[type=file]")
    .setInputFiles({ name: "bike.png", mimeType: "image/png", buffer: bytes });
  await dialog
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: bikeName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Поделиться", exact: true }).click();
  await page
    .getByRole("button", { name: "Опубликовать на витрине", exact: true })
    .click();
  const publicUrl = await page
    .getByLabel("Публичная ссылка", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  const visitorContext = await browser.newContext({
    baseURL: process.env.TEST_ORIGIN || "http://localhost:3100",
  });
  const visitor = await visitorContext.newPage();
  await register(visitor, "voter-" + randomUUID());
  const card = visitor.locator(".bike-card").filter({ hasText: bikeName });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Нравится: 0" }).click();
  await expect(
    card.getByRole("button", { name: "Нравится: 1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await visitor.goto(publicUrl);
  await expect(
    visitor.getByRole("heading", { name: bikeName, exact: true }),
  ).toBeVisible();
  await expect(visitor.locator(".hero-photo")).toBeVisible();
  await page.getByRole("button", { name: "Поделиться", exact: true }).click();
  await page
    .getByRole("button", { name: "Закрыть доступ", exact: true })
    .click();
  await visitor.reload();
  await expect(
    visitor.getByRole("heading", { name: "Велосипед недоступен" }),
  ).toBeVisible();
  await visitor.goto("/bikes");
  await expect(
    visitor.locator(".bike-card").filter({ hasText: bikeName }),
  ).toHaveCount(0);
  await visitorContext.close();
});
