import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const limit = 10 * 1024 * 1024;

// #370: the new-bike wizard is search → details and photos → parts, the bike
// is created after the last step. Search is optional: «Продолжить вручную»
// leaves it from any state; going back and forth keeps what was entered; a
// problem is shown at the step it belongs to; the wide window puts related
// fields side by side.
async function member(page, label) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "wizard-370-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
}
async function openWizard(page) {
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  return wizard;
}
const ndjson = (result) => ({
  status: 200,
  contentType: "application/x-ndjson",
  body: JSON.stringify({ type: "result", result }) + "\n",
});
const nothingFound = {
  status: "not_found",
  query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
  cached: false,
};
const forward = (wizard) =>
  wizard.getByRole("button", { name: /^(Далее|Продолжить вручную)$/ });
const heading = (wizard) => wizard.getByRole("heading", { level: 3 });
const searchBox = (wizard) =>
  wizard.getByLabel("Модель, год и комплектация", { exact: true });
const back = (wizard) =>
  wizard.getByRole("button", { name: "Назад", exact: true });
async function details(
  wizard,
  { brand, model, year, category = "road_gravel" },
) {
  await wizard.getByLabel("Марка", { exact: true }).fill(brand);
  await wizard.getByLabel("Модель", { exact: true }).fill(model);
  await wizard.getByLabel("Год", { exact: true }).fill(String(year));
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption(category);
}

test("step 1: search is optional — «Продолжить вручную» leaves it from every state", async ({
  page,
}, info) => {
  await member(page, "Manual");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  const field = searchBox(wizard);

  // The order is search, details and photos, parts.
  const steps = wizard
    .getByRole("navigation", { name: "Шаги добавления" })
    .getByRole("button");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveAccessibleName("Шаг 1: Поиск");
  await expect(steps.nth(1)).toHaveAccessibleName("Шаг 2: Сведения и фото");
  await expect(steps.nth(2)).toHaveAccessibleName("Шаг 3: Комплектация");
  await expect(heading(wizard)).toContainText("Поиск");

  // Nothing typed: no search was run, and the way on is open.
  await expect(forward(wizard)).toBeEnabled();
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue("");
  await expect(wizard.getByLabel("Год", { exact: true })).toHaveValue("");
  await back(wizard).click();

  // Typed but not searched: the line fills the fields of the next step.
  await field.fill("Trek Domane SL 5 2023");
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await forward(wizard).click();
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue("Trek");
  await expect(wizard.getByLabel("Год", { exact: true })).toHaveValue("2023");
  await back(wizard).click();

  // Nothing found, an error of the service, and variants none of which fits.
  let answer = (route) => route.fulfill(ndjson(nothingFound));
  await page.route("**/api/bikes/resolve-stream", (route) => answer(route));
  await field.fill("Cube Aim 2020");
  await wizard.getByRole("button", { name: /^Найти комплектацию/ }).click();
  await expect(wizard.locator("#wizard-gate")).toContainText(
    "Нажмите «Продолжить вручную»",
  );
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  answer = (route) => route.fulfill({ status: 502, body: "<html>bad</html>" });
  await wizard.getByRole("button", { name: /^Повторить/ }).click();
  await expect(wizard).toContainText("Не удалось выполнить поиск");
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await expect(forward(wizard)).toBeEnabled();
  await page.unroute("**/api/bikes/resolve-stream");
  await field.fill("Giant Contend AR 1 2024");
  await wizard.getByRole("button", { name: /^Повторить/ }).click();
  const cards = wizard.locator(".wizard-candidate");
  await expect(cards.first()).toBeVisible();
  await expect(wizard.locator("#wizard-gate")).toContainText(
    "Ни один вариант не подходит",
  );
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await page.screenshot({
    path: info.outputPath("wizard-step1-variants.png"),
    animations: "disabled",
  });
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue(
    "Giant",
  );
  await back(wizard).click();

  // Choosing a variant is a found bike: «Далее» now, with its parts in step 3.
  await cards.first().click();
  await expect(wizard.locator(".wizard-found")).toBeVisible();
  await expect(forward(wizard)).toHaveText(/Далее/);
  await expect(wizard.locator("#wizard-gate")).toHaveCount(0);
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue(
    "Giant",
  );
  // Only the category is added: editing the make or model by hand would let
  // go of what was found for the old ones.
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Комплектация");
  expect(await wizard.locator(".wizard-part").count()).toBeGreaterThan(0);
  // A changed line is not covered by what was found: the way on is manual
  // again, the parts stay for the person to keep or remove.
  await back(wizard).click();
  await back(wizard).click();
  await field.fill("Giant Contend AR 2 2024");
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await field.fill("Giant Contend AR 1 2024");
  await expect(forward(wizard)).toHaveText(/Далее/);
  expect(await pageOverflow(page)).toBeNull();
});

test("step 1: a manual continue during a search stops it and its late answer changes nothing", async ({
  page,
}) => {
  await member(page, "Late");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let asked = 0;
  await page.route("**/api/bikes/resolve-stream", async (route) => {
    asked += 1;
    await held;
    // The answer the person no longer waits for: it must not be used.
    await route
      .fulfill(
        ndjson({
          status: "resolved",
          query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
          cached: false,
        }),
      )
      .catch(() => {});
  });
  await searchBox(wizard).fill("Cube Aim 2020");
  await wizard.getByRole("button", { name: /^Найти комплектацию/ }).click();
  await expect(
    wizard.getByRole("button", { name: "Остановить поиск", exact: true }),
  ).toBeVisible();
  // While it runs, the way on is open and stops the search.
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await expect(forward(wizard)).toBeEnabled();
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await wizard.getByLabel("Марка", { exact: true }).fill("Мой бренд");
  await wizard.getByLabel("Модель", { exact: true }).fill("Моя модель");
  release();
  await page.waitForTimeout(500);
  expect(asked).toBe(1);
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue(
    "Мой бренд",
  );
  await expect(wizard.getByLabel("Модель", { exact: true })).toHaveValue(
    "Моя модель",
  );
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByRole("alertdialog")).toHaveCount(0);
  await forward(wizard).click();
  // The category is still missing: the problem is shown on this step.
  await expect(wizard.getByRole("alert").first()).toContainText(
    "Выберите категорию велосипеда",
  );
  await expect(heading(wizard)).toContainText("Сведения и фото");
});

test("a repeat of a found search leaves only the manual way on, and its late answer changes nothing", async ({
  page,
}) => {
  await member(page, "Repeat");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  const field = searchBox(wizard);
  await field.fill("Giant Contend AR 1 2024");
  await wizard.getByRole("button", { name: /^Найти комплектацию/ }).click();
  await wizard.locator(".wizard-candidate").first().click();
  await expect(wizard.locator(".wizard-found")).toBeVisible();
  await expect(forward(wizard)).toHaveText(/Далее/);
  // Go and see the parts, and come back to search again.
  await forward(wizard).click();
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");
  await forward(wizard).click();
  const parts = await wizard.locator(".wizard-part").count();
  expect(parts).toBeGreaterThan(0);
  await back(wizard).click();
  await back(wizard).click();

  // The same request again, held: while it runs the way on is by hand.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/bikes/resolve-stream", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await wizard
    .getByRole("button", { name: /^Повторить автоматический поиск/ })
    .click();
  // A search over a draft of parts asks first.
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  await expect(
    wizard.getByRole("button", { name: "Остановить поиск", exact: true }),
  ).toBeVisible();
  await expect(forward(wizard)).toHaveText(/Продолжить вручную/);
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await wizard.getByLabel("Цвет").fill("Мой цвет");
  release();
  await page.waitForTimeout(800);
  // Nothing came from the late answer: the draft is as it was, on this step.
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByLabel("Цвет")).toHaveValue("Мой цвет");
  await expect(wizard.getByRole("alertdialog")).toHaveCount(0);
  await forward(wizard).click();
  await expect(wizard.locator(".wizard-part")).toHaveCount(parts);
});

test("photo candidates are for the bike they were looked up for: an edit of the identity stops the lookup and lets them go", async ({
  page,
}) => {
  await member(page, "Candidates");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/api/bikes/photo-candidates/**", (route) =>
    route.fulfill({ contentType: "image/png", body: dot }),
  );
  const asked = [];
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let hold = true;
  await page.route("**/api/bikes/photo-search", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body.model);
    if (hold && asked.length === 1) await held;
    await route
      .fulfill({
        json: {
          photos: [
            {
              id: randomUUID(),
              sourceUrl: "https://shop.example/" + body.model,
            },
          ],
        },
      })
      .catch(() => {});
  });
  const wizard = await openWizard(page);
  await searchBox(wizard).fill("Trek Domane 2023");
  await forward(wizard).click();
  // The lookup for the first bike is on its way; the model is edited.
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe("Domane");
  await wizard.getByLabel("Модель", { exact: true }).fill("Madone");
  release();
  await page.waitForTimeout(600);
  // Its answer is not shown for the other model, and typing asked for nothing.
  await expect(wizard.locator(".photo-candidates label")).toHaveCount(0);
  expect(asked).toHaveLength(1);
  // On request it looks again, for what stands in the fields now.
  hold = false;
  await wizard.getByRole("button", { name: "Повторить поиск фото" }).click();
  await expect(wizard.locator(".photo-candidates label")).toHaveCount(1);
  expect(asked).toEqual(["Domane", "Madone"]);
  await wizard.locator(".photo-candidates input").check();
  // Candidates already shown go when the identity is edited, with the reason.
  await wizard.getByLabel("Модель", { exact: true }).fill("Emonda");
  await expect(wizard.locator(".photo-candidates label")).toHaveCount(0);
  await expect(wizard).toContainText("Марка или модель изменились");
  expect(asked).toHaveLength(2);
});

test("a bike is created with no search, a name of its own and no parts", async ({
  page,
}) => {
  await member(page, "Plain");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await forward(wizard).click();
  await details(wizard, { brand: "Kona", model: "Rove", year: 2022 });
  // The garage name is optional and closed by default; without it the bike
  // gets the automatic name.
  await expect(wizard.getByLabel("Название в гараже")).toBeHidden();
  await wizard.locator("summary", { hasText: "Своё название" }).click();
  await expect(wizard.getByLabel("Название в гараже")).toHaveValue("");
  await expect(wizard.getByText("Без своего названия")).toContainText(
    "Kona Rove 2022",
  );
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Комплектация");
  // An empty equipment does not stop saving.
  await expect(wizard.locator(".wizard-part")).toHaveCount(0);
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).toHaveCount(0);
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  expect(bikes).toHaveLength(1);
  expect(bikes[0].name).toBe("Kona Rove 2022");
});

test("step 2: problems are shown at the step, inside the closed blocks too", async ({
  page,
}) => {
  await member(page, "Problems");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await forward(wizard).click();
  const alert = wizard.getByRole("alert").first();

  // Brand and model, then the year, then the category, one at a time.
  await forward(wizard).click();
  await expect(alert).toContainText("Укажите марку и модель");
  await expect(wizard.getByLabel("Марка", { exact: true })).toBeFocused();
  await wizard.getByLabel("Марка", { exact: true }).fill("Kona");
  await forward(wizard).click();
  await expect(wizard.getByLabel("Модель", { exact: true })).toBeFocused();
  await wizard.getByLabel("Модель", { exact: true }).fill("Rove");
  await forward(wizard).click();
  await expect(alert).toContainText("Укажите год выпуска");
  await expect(wizard.getByLabel("Год", { exact: true })).toBeFocused();
  await wizard.getByLabel("Год", { exact: true }).fill("2022");
  await forward(wizard).click();
  await expect(alert).toContainText("Выберите категорию велосипеда");
  await expect(
    wizard.getByLabel("Категория велосипеда", { exact: true }),
  ).toBeFocused();
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");

  // A wrong number in an open field.
  await wizard.getByLabel("Вес, кг").fill("0");
  await forward(wizard).click();
  await expect(alert).toContainText("Вес");
  await expect(wizard.getByLabel("Вес, кг")).toBeFocused();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await wizard.getByLabel("Вес, кг").fill("9.5");

  // A wrong value inside a closed block opens it and takes the focus.
  const description = wizard.getByLabel("О велосипеде");
  await expect(description).toBeHidden();
  await wizard.locator("summary", { hasText: "Описание" }).click();
  // `fill` honours maxlength: a pasted text is set the way the page sees it.
  await description.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    set.call(el, "я".repeat(2001));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wizard.locator("summary", { hasText: "Описание" }).click();
  await expect(description).toBeHidden();
  await forward(wizard).click();
  await expect(alert).toContainText("Описание");
  await expect(description).toBeVisible();
  await expect(description).toBeFocused();
  await description.fill("Нормальное описание");
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Комплектация");
});

test("step 2: related fields side by side, privacy as a choice of two, prices as one combo box", async ({
  page,
  isMobile,
}, info) => {
  await member(page, "Layout");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  const box = (locator) => locator.boundingBox();

  // Only this dialog is wider (up to 1520 px since #378, never past the screen
  // with its margins); the phone keeps one column.
  const dialog = await box(wizard);
  const screen = page.viewportSize().width;
  if (isMobile) expect(dialog.width).toBeLessThanOrEqual(screen);
  else {
    expect(dialog.width).toBeGreaterThan(900);
    expect(dialog.width).toBeLessThanOrEqual(Math.min(1520, screen - 48) + 1);
  }
  const make = await box(wizard.getByLabel("Марка", { exact: true }));
  const model = await box(wizard.getByLabel("Модель", { exact: true }));
  const year = await box(wizard.getByLabel("Год", { exact: true }));
  const trim = await box(wizard.getByLabel("Комплектация / версия"));
  const category = await box(
    wizard.getByLabel("Категория велосипеда", { exact: true }),
  );
  // Make and model, then year and version, side by side and in that order;
  // the category is below them.
  expect(Math.abs(make.y - model.y)).toBeLessThan(4);
  expect(Math.abs(year.y - trim.y)).toBeLessThan(4);
  expect(year.y).toBeGreaterThan(make.y);
  expect(category.y).toBeGreaterThan(year.y);
  if (!isMobile) {
    const photos = await box(
      wizard.getByRole("heading", { name: "Фотографии" }),
    );
    // On a wide window the photos sit beside the fields, not below them.
    expect(photos.x).toBeGreaterThan(make.x + 200);
  }
  expect(await pageOverflow(page)).toBeNull();

  // The garage name and the description are folded; the former bike's mark
  // and the privacy are in the settings group.
  await expect(wizard.getByLabel("Название в гараже")).toBeHidden();
  await expect(wizard.getByLabel("О велосипеде")).toBeHidden();
  const privacy = wizard.getByRole("group", { name: "Приватность" });
  const radios = privacy.getByRole("radio");
  await expect(radios).toHaveCount(2);
  await expect(privacy.getByRole("radio", { name: "Публичный" })).toBeChecked();
  await expect(
    privacy.getByRole("radio", { name: "Только я" }),
  ).not.toBeChecked();
  await expect(
    wizard.getByRole("checkbox", { name: "Приватный велосипед" }),
  ).toHaveCount(0);
  await expect(
    wizard.getByRole("checkbox", { name: "Бывший велосипед" }),
  ).toBeVisible();

  // Prices: one combo box with a summary; the three settings stay independent.
  const prices = wizard.getByRole("combobox", { name: /Показ стоимости/ });
  await expect(prices).toContainText("Не показывать");
  await prices.click();
  const list = wizard.getByRole("listbox", { name: "Показ стоимости" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await list.getByRole("option", { name: "Стоимость компонентов" }).click();
  await expect(prices).toContainText("Компоненты");
  await list.getByRole("option", { name: "Стоимость велосипеда" }).click();
  await expect(prices).toContainText("Велосипед, компоненты");
  // Changing privacy leaves the choice of prices alone, and the reverse.
  await privacy.getByRole("radio", { name: "Только я" }).check();
  await expect(prices).toContainText("Велосипед, компоненты");
  // The keyboard: arrows move, Space toggles, Escape closes the list only.
  await prices.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  await expect(prices).toContainText("Все цены");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(wizard).toBeVisible();
  await page.screenshot({
    path: info.outputPath("wizard-step2.png"),
    animations: "disabled",
  });

  await details(wizard, { brand: "Kona", model: "Rove", year: 2022 });
  await forward(wizard).click();
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).toHaveCount(0);
  // What was chosen is what is stored: both privacy and the three flags.
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  const bike = bikes.find((b) => b.brand === "Kona");
  expect(bike.is_public).toBe(false);
  expect(bike.show_bike_price).toBe(true);
  expect(bike.show_component_prices).toBe(true);
  expect(bike.show_accessory_prices).toBe(true);
});

test("going back and forward keeps the details, the photos and the parts; axe on every step", async ({
  page,
}) => {
  await member(page, "Keep");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await searchBox(wizard).fill("Cube Aim 2020");
  await forward(wizard).click();
  await details(wizard, {
    brand: "Cube",
    model: "Aim",
    year: 2020,
    category: "mtb",
  });
  await wizard.getByLabel("Вес, кг").fill("12.4");
  await wizard.locator("summary", { hasText: "Своё название" }).click();
  await wizard.getByLabel("Название в гараже").fill("Мой Cube");
  await wizard.getByRole("radio", { name: "Только я" }).check();
  const good = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#6f7768" },
  })
    .png()
    .toBuffer();
  await wizard
    .locator('input[type="file"]')
    .setInputFiles({ name: "fine.png", mimeType: "image/png", buffer: good });
  await expect(
    wizard.locator('.wizard-draft-photos li[data-kind="local"] img'),
  ).toHaveCount(1);
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Комплектация");
  await wizard
    .locator(".wizard-group-add")
    .getByRole("button", { name: /Тормоза/ })
    .click();
  await expect(wizard.locator(".wizard-part")).toHaveCount(1);
  const parts = 1;

  // Axe on the three steps, both themes.
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
  }
  await back(wizard).click();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
  }

  // Back to step 2, then 1, then forward again: everything is where it was.
  await expect(wizard.getByLabel("Название в гараже")).toHaveValue("Мой Cube");
  await expect(wizard.getByLabel("Вес, кг")).toHaveValue("12.4");
  await expect(wizard.getByRole("radio", { name: "Только я" })).toBeChecked();
  await expect(
    wizard.locator('.wizard-draft-photos li[data-kind="local"] img'),
  ).toHaveCount(1);
  await back(wizard).click();
  await expect(searchBox(wizard)).toHaveValue("Cube Aim 2020");
  await forward(wizard).click();
  await expect(wizard.getByLabel("Марка", { exact: true })).toHaveValue("Cube");
  await expect(
    wizard.getByLabel("Категория велосипеда", { exact: true }),
  ).toHaveValue("mtb");
  await forward(wizard).click();
  await expect(wizard.locator(".wizard-part")).toHaveCount(parts);
  await back(wizard).click();
  await expect(wizard.getByLabel("Название в гараже")).toHaveValue("Мой Cube");
  expect(await pageOverflow(page)).toBeNull();
});

test("photos: refused one by one beside the input, a failed upload leads back to them and is retried without a second bike", async ({
  page,
}, info) => {
  await member(page, "Photos");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await forward(wizard).click();
  await details(wizard, {
    brand: "Cube",
    model: "Aim",
    year: 2020,
    category: "mtb",
  });
  await wizard.locator("summary", { hasText: "Своё название" }).click();
  await wizard.getByLabel("Название в гараже").fill("Photo bike");
  const input = wizard.locator('input[type="file"]');
  const problems = wizard.locator(".photo-problems");
  const good = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#6f7768" },
  })
    .png()
    .toBuffer();
  const files = {
    big: {
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(limit + 1),
    },
    ok: { name: "fine.png", mimeType: "image/png", buffer: good },
    vector: {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    },
    tiny: {
      name: "tiny.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 100, height: 100, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    },
  };

  // One selection: the accepted file stays, each refused one says why. The
  // size is not mixed up with the format or the pixel size.
  await input.setInputFiles([files.big, files.ok, files.vector, files.tiny]);
  await expect(
    wizard.locator('.wizard-draft-photos li[data-kind="local"] img'),
  ).toHaveCount(1);
  await expect(problems).toBeVisible();
  await expect(problems.locator("li")).toHaveCount(3);
  await expect(problems.locator('li[data-kind="size"]')).toHaveText(
    /Фото «huge\.png» слишком большое: 10,01 МБ\. Максимальный размер — 10 МБ\./,
  );
  await expect(problems.locator('li[data-kind="format"]')).toContainText(
    "«logo.svg»",
  );
  await expect(problems.locator('li[data-kind="small"]')).toContainText(
    "«tiny.png»",
  );
  await expect(problems).toHaveAttribute("role", "alert");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(/huge\.png/);
  await expect(problems).toBeInViewport();
  await expect(input).toHaveValue("");
  await page.screenshot({
    path: info.outputPath("wizard-photo-problems.png"),
    animations: "disabled",
  });
  // The same file can be chosen again.
  await problems.getByRole("button", { name: "Скрыть" }).click();
  await expect(problems).toHaveCount(0);
  await input.setInputFiles(files.big);
  await expect(problems.locator("li")).toHaveCount(1);
  // Exactly the limit passes the size rule (this body is no picture, and says so).
  await input.setInputFiles({
    name: "edge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(limit),
  });
  await expect(problems.locator("li")).toHaveCount(1);
  await expect(problems.locator("li")).toContainText("не удалось прочитать");
  await expect(problems.locator('li[data-kind="size"]')).toHaveCount(0);

  // To the parts and save: the bike is created, the one photo fails on the
  // network and stays queued.
  await forward(wizard).click();
  await expect(heading(wizard)).toContainText("Комплектация");
  let created = 0,
    uploads = 0,
    offline = true;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/api/bikes/wizard")) created += 1;
    if (/\/api\/bikes\/[^/]+\/photos$/.test(request.url())) uploads += 1;
  });
  await page.route("**/api/bikes/*/photos", (route) =>
    offline ? route.abort() : route.continue(),
  );
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  // The error leads to the photos: the person lands on the second step, the
  // bike's own fields are shut, the file input and the queue are not.
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(wizard.getByRole("alert").first()).toContainText(
    "Велосипед сохранён, но не все фото загружены",
  );
  await expect(problems).toContainText("«fine.png» не отправлено");
  await expect(
    wizard.locator('.wizard-draft-photos li[data-kind="local"] img'),
  ).toHaveCount(1);
  await expect(wizard.getByLabel("Марка", { exact: true })).toBeDisabled();
  await expect(input).toBeEnabled();
  const retry = wizard.getByRole("button", {
    name: "Повторить загрузку фото",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  expect(created).toBe(1);
  offline = false;
  await retry.click();
  await expect(wizard).not.toBeVisible();
  expect(created).toBe(1);
  expect(uploads).toBe(2);
  const bikes = (await (await page.request.get("/api/bikes")).json()).bikes;
  expect(bikes.filter((bike) => bike.name === "Photo bike")).toHaveLength(1);
  const [bike] = bikes;
  const gallery = await (
    await page.request.get("/api/bikes/" + bike.id)
  ).json();
  expect(gallery.bike.photos).toHaveLength(1);
});

test("photos: after a partly failed save the cover stays what was chosen; nothing left behind is promoted to it, and the retry keeps it", async ({
  page,
}) => {
  await member(page, "Cover");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  await forward(wizard).click();
  await details(wizard, {
    brand: "Cube",
    model: "Aim",
    year: 2020,
    category: "mtb",
  });
  const picture = (width) =>
    sharp({
      create: { width, height: 700, channels: 3, background: "#6f7768" },
    })
      .png()
      .toBuffer();
  await wizard.locator('input[type="file"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: await picture(1000) },
    { name: "second.png", mimeType: "image/png", buffer: await picture(1100) },
  ]);
  const thumbs = wizard.locator(".wizard-draft-photos button.thumb");
  await expect(thumbs).toHaveCount(2);

  // The thumbnails are one row of small pictures, the mark of the cover inside
  // the first of them.
  const boxes = [
    await thumbs.nth(0).boundingBox(),
    await thumbs.nth(1).boundingBox(),
  ];
  expect(Math.abs(boxes[0].width - 104)).toBeLessThan(2);
  expect(boxes[1].y).toBe(boxes[0].y);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1);
  const mark = await thumbs.nth(0).locator(".photo-cover-mark").boundingBox();
  expect(mark.x).toBeGreaterThanOrEqual(boxes[0].x);
  expect(mark.x + mark.width).toBeLessThanOrEqual(
    boxes[0].x + boxes[0].width + 1,
  );

  await forward(wizard).click();
  // The first upload goes through; the second is lost on the way.
  let uploads = 0;
  await page.route("**/api/bikes/*/photos", (route) =>
    route.request().method() === "POST" && ++uploads > 1
      ? route.abort()
      : route.fallback(),
  );
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(heading(wizard)).toContainText("Сведения и фото");
  await expect(thumbs).toHaveCount(1);
  // The first photo is on the bike as its cover. The one left is not the cover
  // and the control says the cover is decided.
  await expect(thumbs.first()).toHaveAccessibleName(/second\.png$/);
  await expect(wizard.locator(".photo-cover-mark")).toHaveCount(0);
  const menu = wizard
    .getByRole("group", { name: "Фотографии велосипеда" })
    .getByRole("button", { name: /: действия/ });
  await expect(menu).toHaveAccessibleName("Фото 1 из 1: действия");
  await menu.click();
  await expect(
    wizard.getByRole("button", { name: "Обложка выбрана при сохранении" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.unroute("**/api/bikes/*/photos");
  await wizard
    .getByRole("button", { name: "Повторить загрузку фото", exact: true })
    .click();
  await expect(wizard).not.toBeVisible();
  const [bike] = (await (await page.request.get("/api/bikes")).json()).bikes;
  const { bike: saved } = await (
    await page.request.get("/api/bikes/" + bike.id)
  ).json();
  expect(saved.photos).toHaveLength(2);
  const cover = saved.photos.find((photo) => photo.is_cover);
  const bytes = await (
    await page.request.get("/api/photos/" + cover.id)
  ).body();
  expect((await sharp(bytes).metadata()).width).toBe(1000);
});
