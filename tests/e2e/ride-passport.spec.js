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

test("passport form, keyboard disclosure, themes, edit and live RSVP privacy without a participant bike", async ({
  page,
  context,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/account?tab=rides&action=plan");
  const composer = page.getByRole("group", { name: "Как поедем", exact: true });
  await expect(composer).toBeVisible();
  await expect(composer).toContainText("Организатор пока не уточнил");
  await expect(page.getByLabel("Кто видит точное место встречи")).toHaveValue(
    "participants",
  );
  await page.getByLabel("Название", { exact: true }).fill("Утро в парке");
  await page.getByLabel("Дата и время старта").fill("2031-03-29T09:00");
  await page.getByLabel("Место встречи", { exact: true }).fill(secret);
  await page.getByLabel("Область поездки").fill("Измайловский парк");
  await page.getByLabel("Цель поездки").selectOption("social");
  await page.getByLabel("Покрытие", { exact: true }).selectOption("mixed");
  await page.getByRole("button", { name: "Спокойный", exact: true }).click();
  const disclosure = composer.locator("summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Дистанция, км: от", { exact: true }).fill("20");
  await page.getByLabel("Дистанция, км: до", { exact: true }).fill("40");
  await page.getByLabel("Подходит новичкам").selectOption("true");
  await page.getByLabel("Как ждём отстающих").selectOption("wait");
  await disclosure.click();
  await disclosure.click();
  await expect(
    page.getByLabel("Дистанция, км: от", { exact: true }),
  ).toHaveValue("20");
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".ride-form").analyze())
        .violations,
    ).toEqual([]);
    await composer.screenshot({
      path: info.outputPath(`passport-form-${theme}.png`),
      animations: "disabled",
    });
  }
  await page.getByLabel("Опубликовать", { exact: true }).check();
  await page
    .getByRole("button", { name: "Сохранить покатушку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Планируемая покатушка", exact: true }),
  ).toHaveCount(0);
  let data = (
    await (await author.request.get("/api/rides?own=1")).json()
  ).rides.find((r) => r.title === "Утро в парке");
  expect(data.passport.distanceKm).toEqual({ min: 20, max: 40 });
  const card = page.locator(".ride-card").filter({ hasText: "Утро в парке" });
  await expect(
    card.getByRole("region", { name: "Паспорт поездки" }),
  ).toContainText("Измайловский парк");
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  await expect(page.getByLabel("Область поездки")).toHaveValue(
    "Измайловский парк",
  );
  await expect(page.getByLabel("Кто видит точное место встречи")).toHaveValue(
    "participants",
  );
  await page.getByRole("button", { name: "Умеренный", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить покатушку", exact: true })
    .click();
  await expect(composer).toHaveCount(0);
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

test("controls survive reduced motion, missing Motion chunk, loading and API errors", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account?tab=rides&action=plan", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Спокойный", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Спокойный", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Умеренный", exact: true }).click();
  await page.getByText("Дополнительные условия", { exact: true }).click();
  await expect(page.getByLabel("Техническая сложность")).toBeVisible();
  await page.getByLabel("Название", { exact: true }).fill("Ошибка сохранения");
  await page.getByLabel("Дата и время старта").fill("2031-03-29T09:00");
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
  const save = page.getByRole("button", {
    name: "Сохранить покатушку",
    exact: true,
  });
  await save.click();
  await expect(save).toBeDisabled();
  release();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Проверьте длительность поездки",
  );
  await expect(
    page.getByRole("button", { name: "Умеренный", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(save).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("passport-error.png"),
    fullPage: true,
    animations: "disabled",
  });
});
