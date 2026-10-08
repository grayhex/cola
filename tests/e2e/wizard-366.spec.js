import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const limit = 10 * 1024 * 1024;

// #366: the new-bike wizard. One search field; step 2 opens only after a
// search has run to its end for what is typed; step 3 puts the identity first;
// a refused photo is named beside the file input.
async function member(page, label) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "wizard-366-secret-123",
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
// A search that finds nothing, whatever the service would say.
const nothingFound = (page) =>
  page.route("**/api/bikes/resolve-stream", (route) =>
    route.fulfill(
      ndjson({
        status: "not_found",
        query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
        cached: false,
      }),
    ),
  );
const next = (wizard) => wizard.getByRole("button", { name: "Далее" });
const gate = (wizard) => wizard.locator("#wizard-gate");

test("wizard step 1: one search field, and no way past it before a search has ended", async ({
  page,
}, info) => {
  await member(page, "Gate");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  const field = wizard.getByLabel("Модель, год и комплектация", {
    exact: true,
  });

  // One field for the search, the garage name has moved to step 3, and there
  // is neither a «fill by hand» button nor a hint about going around.
  await expect(wizard.locator("input:not([type=url]):visible")).toHaveCount(1);
  await expect(wizard.getByLabel("Название в гараже")).toHaveCount(0);
  await expect(
    wizard.getByRole("button", { name: "Заполнить вручную" }),
  ).toHaveCount(0);
  await expect(wizard).not.toContainText("продолжите вручную");
  const link = wizard.getByRole("button", {
    name: "Распознать по странице магазина",
    exact: true,
  });
  await expect(link).toHaveAttribute("aria-expanded", "false");
  await expect(wizard.getByLabel("Страница велосипеда")).toHaveCount(0);

  // Nothing typed, typed but not searched: shut, with the reason.
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("Введите марку и модель");
  await expect(next(wizard)).toHaveAccessibleDescription(
    /Введите марку и модель/,
  );
  const numbers = wizard
    .getByRole("navigation", { name: "Шаги добавления" })
    .getByRole("button");
  await expect(numbers.nth(1)).toBeDisabled();
  await expect(numbers.nth(2)).toBeDisabled();
  await field.fill("Giant Contend AR 1 2024");
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("нажмите «Найти комплектацию»");
  // Enter in the form is the same rule: it searches, it does not go on.
  await wizard.locator("form").press("Enter");
  await expect(wizard.getByRole("heading", { level: 3 })).toContainText(
    "Поиск комплектации",
  );

  // Variants offered and none chosen is not an end either.
  const cards = wizard.locator(".wizard-candidate");
  await field.press("Enter");
  await expect(cards.first()).toBeVisible();
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("Выберите свою комплектацию");
  // The permission belongs to what is typed now: change it and it is gone,
  // put it back and it is back.
  await field.fill("Giant Contend AR 1 2024 Disc");
  await expect(gate(wizard)).toContainText("изменились");
  await field.fill("Giant  Contend AR 1 2024");
  await expect(gate(wizard)).toContainText("Выберите свою комплектацию");
  await cards.first().click();
  await expect(wizard.locator(".wizard-found")).toBeVisible();
  await expect(next(wizard)).toBeEnabled();
  await expect(gate(wizard)).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("wizard-step1-found.png"),
    animations: "disabled",
  });

  // A changed query is not covered by the old search.
  await field.fill("Giant Contend AR 2 2024");
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("Запрос или ссылка изменились");
  await field.fill("Giant Contend AR 1 2024");
  await expect(next(wizard)).toBeEnabled();

  // Edits on the later steps need no new search; going back finds the way open.
  await next(wizard).click();
  await next(wizard).click();
  await expect(wizard.getByRole("heading", { level: 3 })).toContainText(
    "Детали и фото",
  );
  await wizard.getByLabel("Марка", { exact: true }).fill("Giant Bicycles");
  await wizard.getByLabel("Год", { exact: true }).fill("2023");
  await wizard.getByRole("button", { name: "Назад", exact: true }).click();
  await wizard.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(field).toHaveValue("Giant Contend AR 1 2024");
  await expect(next(wizard)).toBeEnabled();
  await next(wizard).click();
  await next(wizard).click();
  await expect(wizard.getByLabel("Год", { exact: true })).toHaveValue("2023");
  expect(await pageOverflow(page)).toBeNull();
});

test("wizard step 1: a search that ends without a result, with an error or stopped", async ({
  page,
}, info) => {
  await member(page, "Gate2");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await openWizard(page);
  const field = wizard.getByLabel("Модель, год и комплектация", {
    exact: true,
  });
  const search = wizard.getByRole("button", { name: /^Найти комплектацию/ });

  // Nothing found: allowed, and it says what comes next.
  let answer = (route) =>
    route.fulfill(
      ndjson({
        status: "not_found",
        query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
        cached: false,
      }),
    );
  await page.route("**/api/bikes/resolve-stream", (route) => answer(route));
  await field.fill("Cube Aim 2020");
  await expect(next(wizard)).toBeDisabled();
  await search.click();
  await expect(next(wizard)).toBeEnabled();
  await expect(gate(wizard)).toContainText("заполните её вручную");
  await next(wizard).click();
  await expect(
    wizard.getByText("Автоматически комплектацию найти не удалось"),
  ).toBeVisible();
  await wizard.getByRole("button", { name: "Назад", exact: true }).click();

  // An error of the service or the network: allowed too.
  answer = (route) => route.fulfill({ status: 502, body: "<html>bad</html>" });
  await field.fill("Cube Aim 2021");
  await expect(next(wizard)).toBeDisabled();
  await wizard.getByRole("button", { name: /^Повторить/ }).click();
  await expect(wizard).toContainText("Не удалось выполнить поиск");
  await expect(next(wizard)).toBeEnabled();

  // Stopped while it runs: not an end. Running blocks as well.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  answer = async (route) => {
    await held;
    await route.abort();
  };
  await field.fill("Cube Aim 2022");
  await wizard.getByRole("button", { name: /^Повторить/ }).click();
  await expect(
    wizard.getByRole("button", { name: "Остановить поиск", exact: true }),
  ).toBeVisible();
  await expect(next(wizard)).toBeDisabled();
  await wizard
    .getByRole("button", { name: "Остановить поиск", exact: true })
    .click();
  release();
  await expect(wizard).toContainText("Поиск остановлен");
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("нажмите «Найти комплектацию»");
  await expect(
    wizard.getByLabel("Модель, год и комплектация", { exact: true }),
  ).toBeEnabled();

  // The link form is the same rule: a link is part of what the search covers.
  answer = (route) =>
    route.fulfill(
      ndjson({
        status: "parse_error",
        query: { brand: "Cube", model: "Aim", trim: null, year: 2022 },
        cached: false,
      }),
    );
  await wizard
    .getByRole("button", {
      name: "Распознать по странице магазина",
      exact: true,
    })
    .click();
  const url = wizard.getByLabel("Страница велосипеда", { exact: true });
  await url.fill("shop.example/bike");
  await expect(next(wizard)).toBeDisabled();
  await expect(gate(wizard)).toContainText("http://");
  await url.fill("https://shop.example/bike");
  await expect(gate(wizard)).toContainText("нажмите «Распознать страницу»");
  await url.press("Enter");
  await expect(next(wizard)).toBeEnabled();
  await url.fill("https://shop.example/other");
  await expect(next(wizard)).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("wizard-step1-link.png"),
    animations: "disabled",
  });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
  }
});

test("wizard step 3: identity first, photos refused one by one beside the input, a failed upload retried without a second bike", async ({
  page,
}, info) => {
  await member(page, "Photos");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nothingFound(page);
  const wizard = await openWizard(page);
  await wizard
    .getByLabel("Модель, год и комплектация", { exact: true })
    .fill("Cube Aim 2020");
  await wizard.getByRole("button", { name: /^Найти комплектацию/ }).click();
  await next(wizard).click();
  await next(wizard).click();
  const labels = await wizard
    .locator(".wizard-content label.field, .wizard-content legend")
    .allInnerTexts();
  const position = (text) =>
    labels.findIndex((label) => label.replace(/\s+/g, " ").includes(text));
  // Make+Model, Year+Trim, the garage name, then the rest; the former bike's
  // switch is down with the privacy.
  const order = [
    "Марка",
    "Модель",
    "Год",
    "Комплектация / версия",
    "Название в гараже",
  ].map(position);
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const box = (locator) => locator.boundingBox();
  const make = await box(wizard.getByLabel("Марка", { exact: true }));
  const model = await box(wizard.getByLabel("Модель", { exact: true }));
  const year = await box(wizard.getByLabel("Год", { exact: true }));
  expect(Math.abs(make.y - model.y)).toBeLessThan(4);
  expect(year.y).toBeGreaterThan(make.y);
  const category = await box(
    wizard.getByLabel("Категория велосипеда", { exact: true }),
  );
  const garage = await box(wizard.getByLabel("Название в гараже"));
  expect(category.y).toBeGreaterThan(garage.y);
  const former = await box(
    wizard.getByRole("checkbox", { name: "Бывший велосипед" }),
  );
  const photos = await box(wizard.getByRole("heading", { name: "Фотографии" }));
  expect(former.y).toBeGreaterThan(photos.y);

  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("mtb");
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
  await expect(wizard.locator(".wizard-local-photos img")).toHaveCount(1);
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
  // Beside the input, in view, not in a line at the top of the dialog.
  const near = await problems.boundingBox();
  const field = await input.boundingBox();
  expect(Math.abs(near.y - field.y)).toBeLessThan(260);
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

  // The bike is saved; the one photo fails on the network and stays queued.
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
  await expect(wizard.getByRole("alert").first()).toContainText(
    "Велосипед сохранён, но не все фото загружены",
  );
  await expect(problems).toContainText("«fine.png» не отправлено");
  await expect(wizard.locator(".wizard-local-photos img")).toHaveCount(1);
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
