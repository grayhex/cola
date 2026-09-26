import { registerVerified } from "../fixtures/verified-user.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #129: the component window stays open while its fields and the catalog
// are in use. Only a press on the backdrop, the close button or Escape
// close it, and typed data asks before it is thrown away.
test("component window stays open while its fields are in use", async ({
  page,
}) => {
  const nonce = randomUUID().slice(0, 8);
  expect(
    (
      await registerVerified(page.request, {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Parts " + nonce,
          email: `parts-${nonce}@example.test`,
          password: "parts-window-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Parts bike " + nonce,
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: false,
    },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.goto("/account?tab=bikes&bike=" + id);

  const add = page.getByRole("button", {
    name: "Добавить компонент",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Добавить компонент",
    exact: true,
  });
  const confirm = page.getByRole("alertdialog", {
    name: "Закрыть без сохранения?",
  });
  const keepEditing = confirm.getByRole("button", {
    name: "Продолжить редактирование",
  });
  const name = dialog.getByLabel("Компонент или модель", { exact: true });
  await add.click();
  await expect(dialog).toBeVisible();

  // Enter in the manufacturer does not save half a part. Chromium moves on
  // to the next field; WebKit lets Enter answer its open suggestion list.
  await dialog
    .getByRole("combobox", { name: "Категория", exact: true })
    .selectOption("Групсет");
  const maker = dialog.getByLabel("Производитель", { exact: true });
  await maker.fill("Shimano");
  await maker.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("Shimano ");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.placeholder))
    .toMatch(/^(Выберите производителя|Например, Brooks C17)$/);
  expect(
    (await (await page.request.get("/api/bikes/" + id)).json()).bike.components,
  ).toEqual([]);
  await name.fill("Shimano GRX");

  // The window's own padding is the <dialog> element as well.
  const box = await dialog.boundingBox();
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(dialog).toBeVisible();
  // A text selection dragged out of a field ends on the backdrop.
  const field = await name.boundingBox();
  await page.mouse.move(field.x + field.width - 4, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 6, field.y + field.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  // A model from the catalog, then Enter moves on as well.
  await dialog
    .getByRole("button", { name: "Shimano GRX RX820", exact: true })
    .click();
  await expect(name).toHaveValue("Shimano GRX RX820");
  await name.press("Enter");
  await expect(dialog.getByLabel("Примечание", { exact: true })).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(confirm).toHaveCount(0);

  // A press on the backdrop and Escape ask first; the data stays.
  await page.mouse.click(2, 2);
  await expect(confirm).toBeVisible();
  await keepEditing.click();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("Shimano GRX RX820");
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  // Escape again answers the question; one more is a new close request,
  // which the browser may refuse to let the page cancel.
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await keepEditing.click();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("Shimano GRX RX820");

  await dialog
    .getByRole("button", { name: "Сохранить деталь", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Деталь сохранена")).toBeVisible();
  const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
  expect(bike.components.map((c) => c.name)).toEqual(["Shimano GRX RX820"]);

  // An untouched window closes from the backdrop without a question.
  await add.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  // The page scrolls again once the window is gone.
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
});
