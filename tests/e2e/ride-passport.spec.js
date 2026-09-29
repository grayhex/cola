import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { publicPath } from "../../lib/public-urls.js";
import { gpx, loop } from "../ride-fixtures.js";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
let author, reader, bike;
const secret = "Закрытая встреча у входа 17";
const plannedAt = "2031-03-29T09:00:00Z";
async function create(request, path, data) {
  const response = await request.post("/api/" + path, {
    headers: { origin },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
test.beforeAll(async ({ browser }) => {
  author = await browser.newContext({ baseURL: origin });
  reader = await browser.newContext({ baseURL: origin });
  for (const context of [author, reader]) {
    const response = await registerVerified(context.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Passport Rider",
        email: randomUUID() + "@example.test",
        password: "passport-browser-secret-123",
      },
    });
    expect(response.status()).toBe(201);
  }
  bike = await create(author.request, "bikes", {
    name: "Passport gravel",
    brand: "Giant",
    model: "Revolt",
    year: 2026,
    category: "gravel",
    description: "",
    color: "",
    size: "M",
    weight: 9,
    is_public: true,
  });
});
test.afterAll(async () => {
  await author?.close();
  await reader?.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies((await author.storageState()).cookies);
});

// #243 option tiles: a tile opens a compact sheet with the choices.
async function pick(page, scope, tile, option) {
  await scope
    .getByRole("button", { name: new RegExp("^" + tile + ":") })
    .click();
  const sheet = page.getByRole("dialog", { name: new RegExp("^" + tile) });
  await sheet.getByRole("button", { name: option, exact: true }).click();
  await expect(sheet).toHaveCount(0);
}
async function range(page, scope, tile, title, min, max) {
  await scope
    .getByRole("button", { name: new RegExp("^" + tile + ":") })
    .click();
  const sheet = page.getByRole("dialog", { name: title });
  await sheet.getByLabel(title + ": от", { exact: true }).fill(String(min));
  await sheet.getByLabel(title + ": до", { exact: true }).fill(String(max));
  await sheet.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

test("planner (#253): when and where first, tiles, visibility, advanced, themes, edit and live RSVP privacy", async ({
  page,
  context,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/account?tab=rides&action=plan");
  const dialog = page.getByRole("dialog", { name: "Организовать покатушку" });
  const when = dialog.getByRole("group", { name: "Когда и где" });
  const how = dialog.getByRole("group", { name: "Как поедем" });
  const access = dialog.getByRole("group", { name: "Участники и доступ" });
  await expect(when.getByLabel("Дата", { exact: true })).toBeVisible();
  // No per-ride zone, publish checkbox or track privacy in a plan.
  await expect(dialog.getByLabel(/Часовой пояс/)).toHaveCount(0);
  await expect(dialog.getByLabel("Опубликовать", { exact: true })).toHaveCount(
    0,
  );
  await expect(dialog.getByText("Скрыть начало и конец маршрута")).toHaveCount(
    0,
  );
  await expect(dialog.getByText("Радиус приватности")).toHaveCount(0);
  await expect(
    access.getByRole("radio", { name: "Публичная покатушка" }),
  ).toBeChecked();
  await expect(access.getByLabel("Кто видит точное место встречи")).toHaveValue(
    "participants",
  );
  // The only current bike is chosen by itself; the bike lives in «Дополнительно».
  await expect(dialog.getByLabel("Велосипед", { exact: true })).toBeHidden();
  await when.getByLabel("Дата", { exact: true }).fill("2031-03-29");
  await when.getByLabel("Старт", { exact: true }).fill("09:00");
  await when.getByLabel("Окончание", { exact: true }).fill("12:00");
  await when.getByLabel("Место встречи", { exact: true }).fill(secret);
  await when.getByLabel("Район или парк").fill("Измайловский парк");
  await how.getByLabel("Название", { exact: true }).fill("Утро в парке");
  await pick(page, how, "Цель", "Общение");
  await pick(page, how, "Покрытие", "Смешанное");
  await pick(page, how, "Темп", "Спокойный");
  await range(page, how, "Дистанция", "Дистанция, км", 20, 40);
  await how.getByLabel("Подходит новичкам").selectOption("true");
  await how.getByLabel("Как ждём отстающих").selectOption("wait");
  const advanced = dialog.locator("summary", { hasText: "Дополнительно" });
  await advanced.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Велосипед", { exact: true })).toHaveValue(
    bike.id,
  );
  await dialog.getByLabel("Техническая сложность").selectOption("easy");
  for (const [theme, system] of [
    ["light", "light"],
    ["dark", "light"],
    ["system", "dark"],
  ]) {
    await page.emulateMedia({ colorScheme: system });
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".plan-form").analyze())
        .violations,
    ).toEqual([]);
    await dialog.screenshot({
      path: info.outputPath(`planner-${theme}.png`),
      animations: "disabled",
    });
  }
  await dialog
    .getByRole("button", { name: "Создать покатушку", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  let data = (
    await (await author.request.get("/api/rides?own=1")).json()
  ).rides.find((r) => r.title === "Утро в парке");
  expect(data.passport.distanceKm).toEqual({ min: 20, max: 40 });
  expect(data.passport.difficulty).toBe("easy");
  expect(data.isPublic).toBe(true);
  // A hidden meeting point protects the route edges with the default radius.
  expect(data.privacyEnabled).toBe(true);
  const card = page.locator(".ride-card").filter({ hasText: "Утро в парке" });
  await expect(
    card.getByRole("region", { name: "Паспорт поездки" }),
  ).toContainText("Измайловский парк");
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Изменить покатушку" });
  await expect(edit.getByLabel("Район или парк")).toHaveValue(
    "Измайловский парк",
  );
  await expect(edit.getByLabel("Старт", { exact: true })).toHaveValue("09:00");
  await expect(edit.getByLabel("Кто видит точное место встречи")).toHaveValue(
    "participants",
  );
  await pick(page, edit, "Темп", "Умеренный");
  await edit
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(edit).toHaveCount(0);
  data = (
    await (await author.request.get("/api/rides/public/" + data.shareId)).json()
  ).ride;
  await context.clearCookies();
  await context.addCookies((await reader.storageState()).cookies);
  await page.goto(publicPath("ride", data));
  await expect(
    page.getByRole("region", { name: "Паспорт поездки" }),
  ).toContainText("Умеренный");
  await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  const rsvp = page.getByRole("group", { name: "Участие в покатушке" });
  await rsvp.getByRole("button", { name: /^Иду/ }).click();
  await expect(page.getByText(secret, { exact: false })).toBeVisible();
  await rsvp.getByRole("button", { name: /^Не иду/ }).click();
  await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("passport-detail.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("HTTP schemas and private meeting never leak to anonymous API, SSR or previews", async ({
  browser,
}) => {
  const guest = await browser.newContext({ baseURL: origin });
  try {
    const input = {
      bikeId: bike.id,
      title: "HTTP passport",
      description: "Public description",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: plannedAt,
      meetingPoint: secret,
    };
    expect(
      (
        await guest.request.post("/api/rides/plan", {
          headers: { origin },
          data: input,
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await author.request.post("/api/rides/plan", {
          headers: { origin: "https://evil.test" },
          data: input,
        })
      ).status(),
    ).toBe(403);
    for (const fields of [
      { passport: { surprise: true } },
      { passport: { distanceKm: { min: 40, max: 20 } } },
      { expectedEndAt: "2031-03-29T08:00:00Z" },
    ])
      expect(
        (
          await author.request.post("/api/rides/plan", {
            headers: { origin },
            data: { ...input, ...fields },
          })
        ).status(),
      ).toBe(400);
    const plan = await create(author.request, "rides/plan", input);
    const track = await author.request.post(`/api/rides/${plan.id}/track`, {
      headers: { origin, "content-type": "application/gpx+xml" },
      data: gpx([loop]),
    });
    expect(track.status(), await track.text()).toBe(200);
    const data = (
      await (
        await guest.request.get("/api/rides/public/" + plan.shareId)
      ).json()
    ).ride;
    expect(data.passport).toEqual({});
    expect(data.meetingPoint).toBe("");
    expect(
      data.geometry
        .flat()
        .some((p) => p[0] === loop[0][0] && p[1] === loop[0][1]),
    ).toBe(false);
    expect(data.analysis).toBeNull();
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(
      await (await guest.request.get(publicPath("ride", data))).text(),
    ).not.toContain(secret);
    expect(await (await guest.request.get("/api/rides")).text()).not.toContain(
      secret,
    );
    for (const response of ["accepted", "declined"]) {
      expect(
        (
          await reader.request.patch(`/api/rides/${plan.id}/rsvp`, {
            headers: { origin },
            data: { response, occurrenceAt: plannedAt },
          })
        ).status(),
      ).toBe(200);
      const detail = (
        await (
          await reader.request.get("/api/rides/public/" + plan.shareId)
        ).json()
      ).ride;
      expect(detail.meetingPoint).toBe(response === "accepted" ? secret : "");
      expect(
        await (await guest.request.get(publicPath("ride", data))).text(),
      ).not.toContain(secret);
    }
  } finally {
    await guest.close();
  }
});

test("planner controls survive reduced motion, a missing Motion chunk, a slow API error and a missing bike", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account?tab=rides&action=plan", {
    waitUntil: "networkidle",
  });
  const dialog = page.getByRole("dialog", { name: "Организовать покатушку" });
  await pick(page, dialog, "Темп", "Спокойный");
  await expect(dialog.getByRole("button", { name: /^Темп:/ })).toContainText(
    "Спокойный",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await pick(page, dialog, "Темп", "Умеренный");
  await dialog.locator("summary", { hasText: "Дополнительно" }).click();
  await expect(dialog.getByLabel("Техническая сложность")).toBeVisible();
  await dialog
    .getByLabel("Название", { exact: true })
    .fill("Ошибка сохранения");
  await dialog.getByLabel("Дата", { exact: true }).fill("2031-03-29");
  await dialog.getByLabel("Старт", { exact: true }).fill("09:00");
  // No bike chosen: the advanced block explains and focuses the selector.
  await dialog.getByLabel("Велосипед", { exact: true }).evaluate((select) => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const save = dialog.getByRole("button", {
    name: "Создать покатушку",
    exact: true,
  });
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("Выберите велосипед");
  await expect(dialog.getByLabel("Велосипед", { exact: true })).toBeFocused();
  await dialog.getByLabel("Велосипед", { exact: true }).selectOption(bike.id);
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rides/plan", async (route) => {
    await delayed;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Проверьте длительность поездки" }),
    });
  });
  await save.click();
  await expect(save).toBeDisabled();
  release();
  await expect(dialog.getByRole("alert")).toContainText(
    "Проверьте длительность поездки",
  );
  // The entered plan stays as it was.
  await expect(dialog.getByRole("button", { name: /^Темп:/ })).toContainText(
    "Умеренный",
  );
  await expect(dialog.getByLabel("Название", { exact: true })).toHaveValue(
    "Ошибка сохранения",
  );
  await expect(save).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("planner-error.png"),
    fullPage: true,
    animations: "disabled",
  });
});
