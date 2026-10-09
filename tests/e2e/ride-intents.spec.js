import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chosenArea, nameArea } from "../fixtures/ride-area.js";
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
  // #253: the composer takes the zone from the profile, not a form field.
  const zone = await request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
  expect(zone.status()).toBe(200);
}
async function open(page) {
  await page.goto("/ride-intents");
  await expect(
    page.getByText("Пока нет намерений.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Новое намерение", exact: true });
}
// Who sees an intent sits under «Дополнительно», folded by default (#264).
async function advanced(dialog) {
  const details = dialog.locator("details.intent-advanced");
  if (!(await details.evaluate((el) => el.open)))
    await details.locator("summary").click();
}
// #243: trip conditions are option tiles that open a compact sheet.
async function pick(page, scope, tile, option) {
  await scope
    .getByRole("button", { name: new RegExp("^" + tile + ":") })
    .click();
  const sheet = page.getByRole("dialog", { name: new RegExp("^" + tile) });
  await sheet.getByRole("button", { name: option, exact: true }).click();
  await expect(sheet).toHaveCount(0);
}
async function fill(dialog, area = "Парк намерений") {
  // No zone field: the profile's Europe/Moscow is shown read-only.
  await expect(dialog.getByLabel(/Часовой пояс/)).toHaveCount(0);
  await expect(dialog).toContainText("Europe/Moscow");
  await dialog
    .getByLabel("Окно 1: с", { exact: true })
    .fill(date(1) + "T10:00");
  await dialog
    .getByLabel("Окно 1: до", { exact: true })
    .fill(date(1) + "T15:00");
  await nameArea(dialog, area);
  await pick(dialog.page(), dialog, "Цель", "Общение");
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
  await pick(page, dialog, "Темп", "Спокойный");
  await dialog.getByRole("button", { name: /^Дистанция:/ }).click();
  const distance = page.getByRole("dialog", { name: "Дистанция, км" });
  await distance.getByLabel("Дистанция, км: от", { exact: true }).fill("20");
  await distance.getByLabel("Дистанция, км: до", { exact: true }).fill("40");
  await distance.getByRole("button", { name: "Готово" }).click();
  await expect(distance).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Дистанция: 20–40 км" }),
  ).toBeFocused();
  await dialog
    .getByRole("button", {
      name: "Сохранить как постоянные предпочтения",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Постоянные предпочтения сохранены",
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
  for (const [name, locator] of [
    ["tiles", dialog.getByRole("group", { name: "Параметры поездки" })],
    ["privacy", dialog.getByRole("group", { name: "Кому видно" })],
  ]) {
    if (name === "privacy") await advanced(dialog);
    await locator.scrollIntoViewIfNeeded();
    await dialog.screenshot({
      path: info.outputPath(`intent-${name}.png`),
      animations: "disabled",
    });
  }
  const change = chosenArea(dialog).getByRole("button", {
    name: "Изменить место",
  });
  await change.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await expect(change).toBeFocused();
  // A new intent is for the community by default (#370); this one is kept
  // private on purpose, so the reader below sees nothing until it is shared.
  await expect(
    dialog.getByLabel("Сообществу ColaBike", { exact: true }),
  ).toBeChecked();
  await dialog.getByLabel("Только мне — для подбора", { exact: true }).check();
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
    await advanced(editor);
    await editor.getByLabel("Сообществу ColaBike", { exact: true }).check();
    await editor.getByRole("button", { name: "Сохранить изменения" }).click();
    await expect(editor).toHaveCount(0);
    expect((await reader.request.get("/api/ride-intents/" + id)).status()).toBe(
      200,
    );
    await card.getByRole("button", { name: "Изменить", exact: true }).click();
    await advanced(editor);
    await editor
      .getByLabel("Только мне — для подбора", { exact: true })
      .check();
    await editor.getByRole("button", { name: "Сохранить изменения" }).click();
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
    name: "Новое намерение",
    exact: true,
  });
  await fill(dialog, "Повторная отправка");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let chunks = 0;
  await page.route("**/_next/static/**/*.js", (route) => {
    chunks++;
    return route.abort();
  });
  await pick(page, dialog, "Темп", "Спортивный");
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
  await expect(chosenArea(dialog)).toContainText("Повторная отправка");
  await dialog.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(dialog).toHaveCount(0);
  const list = await (await page.request.get("/api/ride-intents")).json();
  expect(list.total).toBe(1);
  expect(list.items[0].passport.pace).toBe("sporty");
  expect(chunks).toBeGreaterThan(0);
});
test("workspace screen (#243): setup sections, preference tiles, tabs, empty and filled states in both themes", async ({
  page,
  isMobile,
}, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ride-intents");
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { name: "Хочу кататься", level: 1 }),
  ).toBeVisible();
  await expect(
    main.getByText("Пока нет намерений. Выберите время"),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Как это работает" }),
  ).toBeVisible();
  const save = main.getByRole("button", { name: "Сохранить предпочтения" });
  await expect(save).toBeDisabled();
  // Tiles: keyboard open, Escape closes and returns focus, a value fills it.
  const pace = main.getByRole("button", { name: "Темп: Любой" });
  await pace.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Темп поездки" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(pace).toBeFocused();
  await pick(page, main, "Темп", "Умеренный");
  await expect(
    main.getByRole("button", { name: "Темп: Умеренный" }),
  ).toHaveAttribute("data-filled", "true");
  await main.getByRole("button", { name: /^Компания:/ }).click();
  const company = page.getByRole("dialog", { name: "Размер компании, чел." });
  await company.getByLabel("Размер компании, чел.: от").fill("5");
  await company.getByLabel("Размер компании, чел.: до").fill("2");
  await company.getByRole("button", { name: "Готово" }).click();
  await expect(company.getByRole("alert")).toContainText("Нижняя граница");
  await company.getByLabel("Размер компании, чел.: до").fill("8");
  await company.getByRole("button", { name: "Готово" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(main.getByRole("status")).toContainText(
    "Постоянные предпочтения сохранены",
  );
  const prefs = await (
    await page.request.get("/api/ride-intents/preferences")
  ).json();
  expect(prefs.preferences.passport).toEqual({
    pace: "moderate",
    groupSize: { min: 5, max: 8 },
  });
  expect(
    (await (await page.request.get("/api/ride-intents")).json()).total,
  ).toBe(0);
  const shoot = async (name) => {
    for (const [theme, system] of [
      ["light", "light"],
      ["dark", "light"],
      ["system", "dark"],
    ]) {
      await page.emulateMedia({ colorScheme: system });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      // Measure the final palette: colours transition after a theme switch.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      expect(
        (await new AxeBuilder({ page }).include("main").analyze()).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`workspace-${name}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
  };
  await shoot("empty");
  // One, then several intents; the list keeps its place while refreshing.
  for (const [n, area] of [
    [1, "Первое намерение"],
    [2, "Второе намерение"],
  ]) {
    const response = await page.request.post("/api/ride-intents", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        readiness: n === 1 ? "ready" : "considering",
        timeZone: "Europe/Moscow",
        windows: [
          { startLocal: date(n) + "T10:00", endLocal: date(n) + "T15:00" },
        ],
        passport: { area: { label: area }, purpose: "social" },
        visibility: n === 1 ? "private" : "community",
      },
    });
    expect(response.status()).toBe(201);
    await main.getByRole("button", { name: "Обновить" }).click();
    await expect(main.locator("[data-intent-id]")).toHaveCount(n);
    if (n === 1) await shoot("one");
  }
  await shoot("several");
  await main.getByRole("button", { name: "Сообщество" }).click();
  await expect(
    main.getByRole("button", { name: "Сообщество" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Other members' community intents may be listed too; the private one never.
  await expect(main).toContainText("Второе намерение");
  await expect(main).not.toContainText("Первое намерение");
  await expect(main.getByRole("button", { name: "Обновить" })).toBeEnabled();
  await shoot("community");
});

test("area from preferences moves the map view; Enter keeps the stored centre (#241)", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  const saved = await page.request.put("/api/ride-intents/preferences", {
    headers: { origin },
    data: {
      passport: {
        area: { label: "Невский", center: [30.32, 59.93], radiusM: 3000 },
        purpose: "social",
      },
    },
  });
  expect(saved.status()).toBe(200);
  const dialog = await open(page);
  await dialog
    .getByRole("button", { name: "Подставить постоянные предпочтения" })
    .click();
  const map = dialog.getByRole("application");
  await expect(map).toBeVisible();
  await map.focus();
  await page.keyboard.press("Enter");
  await dialog
    .getByLabel("Окно 1: с", { exact: true })
    .fill(date(1) + "T10:00");
  await dialog
    .getByLabel("Окно 1: до", { exact: true })
    .fill(date(1) + "T15:00");
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog).toHaveCount(0);
  const list = await (await page.request.get("/api/ride-intents")).json();
  expect(list.items[0].passport.area.center).toEqual([30.32, 59.93]);
});
