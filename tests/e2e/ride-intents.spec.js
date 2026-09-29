import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function register(request) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Intent Rider",
      email: randomUUID() + "@example.test",
      password: "intent-browser-secret-123",
    },
  });
  expect(response.status()).toBe(201);
}
async function open(page) {
  await page.goto("/ride-intents");
  await expect(
    page.getByText("Пока нет намерений.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Хочу кататься", exact: true });
}
async function fill(dialog, area = "Парк намерений") {
  await dialog
    .getByLabel("Часовой пояс (IANA)", { exact: false })
    .fill("Europe/Moscow");
  await dialog
    .getByLabel("Окно 1: с", { exact: true })
    .fill(date(1) + "T10:00");
  await dialog
    .getByLabel("Окно 1: до", { exact: true })
    .fill(date(1) + "T15:00");
  await dialog.getByLabel("Область поездки").fill(area);
  await dialog.getByRole("button", { name: "Общение", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await register(page.request);
});
test("intent lifecycle without a bike: windows, preferences, themes, privacy and repeat", async ({
  page,
  browser,
}, info) => {
  let geoCalls = 0;
  await page.exposeFunction("recordGeo", () => {
    geoCalls++;
  });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => window.recordGeo();
  });
  const dialog = await open(page);
  await fill(dialog);
  await dialog
    .getByRole("button", { name: "Готов ехать", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Добавить окно", exact: true })
    .click();
  await dialog
    .getByLabel("Окно 2: с", { exact: true })
    .fill(date(2) + "T23:00");
  await dialog
    .getByLabel("Окно 2: до", { exact: true })
    .fill(date(3) + "T02:00");
  await dialog.getByRole("button", { name: "Спокойный", exact: true }).click();
  await dialog.getByText("Дополнительные условия", { exact: true }).click();
  await dialog.getByLabel("Дистанция, км: от", { exact: true }).fill("20");
  await dialog.getByLabel("Дистанция, км: до", { exact: true }).fill("40");
  await dialog.getByText("Дополнительные условия", { exact: true }).click();
  await dialog
    .getByRole("button", {
      name: "Сохранить условия как предпочтения",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Предпочтения сохранены",
  );
  expect(
    (await (await page.request.get("/api/ride-intents")).json()).total,
  ).toBe(0);
  for (const [theme, system] of [
    ["light", "light"],
    ["dark", "light"],
    ["system", "dark"],
  ]) {
    await page.emulateMedia({ colorScheme: system });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(dialog).toHaveCSS(
      "color",
      theme === "light" ? "rgb(17, 24, 39)" : "rgb(255, 255, 255)",
    );
    // Measure the final palette, including controls whose colors transition.
    await expect(
      dialog.getByRole("button", { name: "Добавить окно", exact: true }),
    ).toHaveCSS(
      "color",
      theme === "light" ? "rgb(75, 85, 99)" : "rgb(156, 163, 175)",
    );
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await dialog.screenshot({
      path: info.outputPath(`intent-${theme}.png`),
      animations: "disabled",
    });
  }
  await dialog.getByLabel("Область поездки").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await expect(dialog.getByLabel("Область поездки")).toBeFocused();
  await dialog
    .getByRole("button", { name: "Сохранить намерение", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  let list = await (await page.request.get("/api/ride-intents")).json();
  const id = list.items[0].id,
    card = page.locator(`[data-intent-id="${id}"]`);
  expect(list.items[0].windows).toHaveLength(2);
  expect(list.items[0].windows[0].startsAt).toContain("07:00:00");
  expect(list.items[0].allowSuggestions).toBe(false);
  await expect(card).toContainText("20–40 км");
  await page.screenshot({
    path: info.outputPath("intent-list.png"),
    fullPage: true,
    animations: "disabled",
  });
  const reader = await browser.newContext({ baseURL: origin });
  try {
    await register(reader.request);
    expect((await reader.request.get("/api/ride-intents/" + id)).status()).toBe(
      404,
    );
    await card.getByRole("button", { name: "Изменить", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Изменить намерение" });
    await editor.getByLabel("Сообществу ColaBike", { exact: true }).check();
    await editor.getByRole("button", { name: "Сохранить намерение" }).click();
    await expect(editor).toHaveCount(0);
    expect((await reader.request.get("/api/ride-intents/" + id)).status()).toBe(
      200,
    );
    await card.getByRole("button", { name: "Изменить", exact: true }).click();
    await editor
      .getByLabel("Только мне — для подбора", { exact: true })
      .check();
    await editor.getByRole("button", { name: "Сохранить намерение" }).click();
    await expect(editor).toHaveCount(0);
    expect((await reader.request.get("/api/ride-intents/" + id)).status()).toBe(
      404,
    );
  } finally {
    await reader.close();
  }
  await card.getByRole("button", { name: "Отменить", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Отменить намерение", exact: true })
    .click();
  await expect(card.getByRole("heading")).toHaveText("Отменено");
  await card.getByRole("button", { name: "Повторить с новыми датами" }).click();
  await expect(dialog.getByLabel("Окно 1: с", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByLabel("Только мне — для подбора", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "В выходные", exact: true }).click();
  await expect(
    dialog.getByRole("region", { name: "Предпросмотр намерения" }),
  ).not.toContainText("Выберите точные даты");
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog).toHaveCount(0);
  list = await (await page.request.get("/api/ride-intents")).json();
  expect(list.items).toHaveLength(2);
  expect(new Set(list.items.map((i) => i.id)).size).toBe(2);
  await card.getByRole("button", { name: "Удалить", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  expect(geoCalls).toBe(0);
});
test("load failure, lost create response, reduced motion and missing chunk preserve intent without duplicates", async ({
  page,
}) => {
  let failList = true;
  await page.route("**/api/ride-intents?**", async (route) => {
    if (failList) {
      failList = false;
      await route.fulfill({
        status: 500,
        json: { error: "Проверка ошибки списка" },
      });
    } else await route.continue();
  });
  await page.goto("/ride-intents", { waitUntil: "networkidle" });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Проверка ошибки списка",
  );
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    page.getByText("Пока нет намерений.", { exact: false }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Хочу кататься",
    exact: true,
  });
  await fill(dialog, "Повторная отправка");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let chunks = 0;
  await page.route("**/_next/static/**/*.js", (route) => {
    chunks++;
    return route.abort();
  });
  await dialog.getByRole("button", { name: "Спортивный", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Готов ехать", exact: true })
    .click();
  let first = true,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ride-intents", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await gate;
      await route.abort();
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(
    dialog.getByRole("button", { name: "Сохраняем…" }),
  ).toBeDisabled();
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Область поездки")).toHaveValue(
    "Повторная отправка",
  );
  await dialog.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(dialog).toHaveCount(0);
  const list = await (await page.request.get("/api/ride-intents")).json();
  expect(list.total).toBe(1);
  expect(list.items[0].passport.pace).toBe("sporty");
  expect(chunks).toBeGreaterThan(0);
});
