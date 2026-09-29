import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";

// #233 personal home planning and #241 coarse area picking, on real APIs.
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const nonce = randomUUID().slice(0, 8);
const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
async function member(request, name) {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.test`;
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: `${name} ${nonce}`,
      email,
      password: "home-planner-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}
async function call(request, path, method, data) {
  const response = await request.fetch(origin + "/api/" + path, {
    method,
    headers: { origin },
    data,
  });
  expect(response.ok(), path + " " + (await response.text())).toBe(true);
  return response.json();
}
const titles = {
  suits: `Утренний круг ${nonce}`,
  maybe: `Воскресный гравий ${nonce}`,
  relaxed: `Спокойная прогулка ${nonce}`,
};
let organizer, community, plans;
test.beforeAll(async ({ browser }) => {
  organizer = await browser.newContext();
  community = await browser.newContext();
  await member(organizer.request, "Organizer");
  await member(community.request, "Neighbour");
  const bike = await call(organizer.request, "bikes", "POST", {
    name: "Planner bike",
    brand: "Giant",
    model: "Revolt",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  });
  const plan = (title, date, from, to, passport) =>
    call(organizer.request, "rides/plan", "POST", {
      bikeId: bike.id,
      title,
      description: "",
      isPublic: true,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: `${date}T${from}:00+03:00`,
      expectedEndAt: `${date}T${to}:00+03:00`,
      meetingPoint: "Секретная калитка",
      passport,
    });
  plans = {
    suits: await plan(titles.suits, day(5), "06:30", "08:30", {
      purpose: "social",
      pace: "moderate",
      area: { label: "Парк Горького", center: [37.6, 55.73], radiusM: 3000 },
    }),
    maybe: await plan(titles.maybe, day(6), "12:00", "15:00", {
      purpose: "training",
      pace: "sporty",
      surface: "gravel",
    }),
    relaxed: await plan(titles.relaxed, day(7), "10:00", "11:00", {
      purpose: "leisure",
      pace: "relaxed",
      area: { label: "Сокольники" },
    }),
  };
  await call(community.request, "ride-intents", "POST", {
    requestId: randomUUID(),
    readiness: "ready",
    timeZone: "Europe/Moscow",
    windows: [{ startLocal: day(5) + "T06:00", endLocal: day(5) + "T10:00" }],
    passport: { area: { label: "Нескучный сад" }, purpose: "social" },
    visibility: "community",
    allowSuggestions: true,
  });
});
test.afterAll(async () => {
  await organizer?.close();
  await community?.close();
});
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
});

test("signed-in home: going, suits, gather, composer with a keyboard-picked area, themes and account switch", async ({
  page,
}, info) => {
  const rider = await member(page.request, "Rider");
  // A private intent drives only the owner's own suggestions.
  await call(page.request, "ride-intents", "POST", {
    requestId: randomUUID(),
    readiness: "ready",
    timeZone: "Europe/Moscow",
    windows: [{ startLocal: day(5) + "T06:00", endLocal: day(5) + "T09:30" }],
    passport: {
      area: { label: "У реки", center: [37.61, 55.74], radiusM: 5000 },
      purpose: "social",
      pace: "moderate",
    },
  });
  const maybe = await call(
    page.request,
    "rides/public/" + plans.maybe.shareId,
    "GET",
  );
  await call(page.request, `rides/${plans.maybe.id}/rsvp`, "PATCH", {
    response: "maybe",
    occurrenceAt: maybe.ride.scheduledAt,
  });
  await page.goto("/");
  const planner = page.locator("section[aria-labelledby=planner-heading]");
  await expect(
    planner.getByRole("heading", { name: "Покататься вместе" }),
  ).toBeVisible();
  const going = planner.locator("section[aria-labelledby=going-heading]");
  const goingRow = going.locator("article", { hasText: titles.maybe });
  await expect(goingRow).toContainText("Может быть");
  await expect(goingRow).toContainText("Место встречи откроется после «Иду»");
  await expect(goingRow).not.toContainText("Секретная калитка");
  const suits = planner.locator("section[aria-labelledby=suits-heading]");
  const suitsRow = suits.locator("article", { hasText: titles.suits });
  await expect(suitsRow).toContainText("Подходит: время");
  await expect(suitsRow).toContainText("область");
  await expect(suits).not.toContainText(titles.relaxed);
  const gather = planner.locator("section[aria-labelledby=gather-heading]");
  await expect(gather.locator("article").first()).toContainText("целиком");
  await gather.getByRole("button", { name: "3 ч", exact: true }).click();
  await expect(gather.getByRole("button", { name: "3 ч" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const [theme, system] of [
    ["light", "light"],
    ["dark", "light"],
    ["system", "dark"],
  ]) {
    await page.emulateMedia({ colorScheme: system });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    expect(
      (
        await new AxeBuilder({ page })
          .include("section[aria-labelledby=planner-heading]")
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await planner.screenshot({
      path: info.outputPath(`home-planner-${theme}.png`),
      animations: "disabled",
    });
  }
  // The composer is the same #231 form; the area is picked without a mouse.
  await planner.getByRole("button", { name: "Хочу кататься" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Хочу кататься",
    exact: true,
  });
  await dialog.getByLabel("Область поездки").fill("Воробьёвы горы");
  await dialog.getByRole("button", { name: "Общение", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Отметить область на карте" })
    .click();
  const map = dialog.getByRole("application");
  await map.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await dialog.getByLabel("Радиус").selectOption("3");
  await expect(
    dialog.getByText("Выбрана область радиусом 3 км.", { exact: false }),
  ).toBeVisible();
  await dialog.screenshot({
    path: info.outputPath("area-picker.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(planner.getByRole("status")).toContainText(
    "Намерение сохранено",
  );
  const own = await call(page.request, "ride-intents?scope=own", "GET");
  const picked = own.items.find(
    (i) => i.passport.area.label === "Воробьёвы горы",
  );
  expect(picked.passport.area.radiusM).toBe(3000);
  for (const n of picked.passport.area.center)
    expect(Math.round(n * 100) / 100).toBe(n); // never finer than 0.01°
  // Logout and another account: nothing personal remains on the page.
  await call(page.request, "auth/logout", "POST");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Найти компанию для поездки" }),
  ).toBeVisible();
  await expect(
    page.locator("section[aria-labelledby=planner-heading]"),
  ).toHaveCount(0);
  await member(page.request, "Second");
  await page.goto("/");
  await expect(
    planner.getByRole("heading", { name: "Покататься вместе" }),
  ).toBeVisible();
  await expect(going.locator(".empty-state")).toBeVisible();
  // Public feeds may mention the ride; the personal planner must not.
  await expect(planner).not.toContainText(titles.maybe);
  await expect(planner).not.toContainText("У реки");
  // No intent and no preferences: an honest empty state, not a random list.
  await expect(suits).toContainText(
    "Пока нет намерений и предпочтений для подбора.",
  );
  await expect(suits.locator("article")).toHaveCount(0);
  expect(rider.id).toBeTruthy();
});

test("guest home stays public: no personal requests, HTML or cached data", async ({
  page,
}) => {
  const personal = [];
  page.on("request", (r) => {
    if (/\/api\/(ride-matches|ride-intents)/.test(r.url()))
      personal.push(r.url());
  });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  const html = await response.text();
  await expect(
    page.getByRole("heading", { name: "Найти компанию для поездки" }),
  ).toBeVisible();
  expect(personal).toEqual([]);
  expect(html).not.toContain("Покататься вместе");
  expect(response.headers()["cache-control"] || "").not.toMatch(/public/);
});

test("public filters: URL keeps shared choices only, slow answers never win, empty vs error, back/forward", async ({
  page,
  isMobile,
}) => {
  await page.goto("/rides?status=planned&pace=moderate&intent=secret&lat=55.7");
  await expect(page.locator("main")).toContainText(titles.suits);
  await expect(page.locator("main")).not.toContainText(titles.relaxed);
  // Slow first answer for "relaxed", fast one for "sporty": the latest wins.
  let delayed = true;
  await page.route("**/api/rides?**", async (route) => {
    if (delayed && route.request().url().includes("pace=relaxed")) {
      delayed = false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  const choose = async (label, value) => {
    if (isMobile) {
      await page.getByRole("button", { name: /Фильтры/ }).click();
      const sheet = page.getByRole("dialog", { name: "Фильтры" });
      await sheet.getByLabel(label).selectOption(value);
      await sheet.getByRole("button", { name: "Показать" }).click();
    } else
      await page.locator(".ride-filters").getByLabel(label).selectOption(value);
  };
  await choose("Темп", "relaxed");
  await choose("Темп", "sporty");
  await expect(page.locator("main")).toContainText(titles.maybe);
  await page.waitForTimeout(1800);
  await expect(page.locator("main")).toContainText(titles.maybe);
  await expect(page.locator("main")).not.toContainText(titles.relaxed);
  const url = new URL(page.url());
  expect(url.searchParams.get("pace")).toBe("sporty");
  for (const key of ["intent", "lat", "from", "to"])
    expect(url.searchParams.has(key)).toBe(false);
  // Back from a ride keeps the filter and the result.
  await page.getByRole("link", { name: titles.maybe }).first().click();
  await expect(page).toHaveURL(/\/r\//);
  await page.goBack();
  await expect(page).toHaveURL(/pace=sporty/);
  await expect(page.locator("main")).toContainText(titles.maybe);
  // Zero results and a failing service are different messages. A change in
  // the first ~100 ms after back can land during the navigation's view
  // transition, before React owns the controls; retry until it is applied.
  await expect(async () => {
    await choose("Цель", "adventure");
    await expect(
      page.getByRole("button", { name: "Убрать фильтр Приключение" }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(
    page.getByText("По этим фильтрам предстоящих выездов нет."),
  ).toBeVisible();
  let fail = true;
  await page.route("**/api/rides?**", async (route) => {
    if (fail && route.request().url().includes("purpose=exploration")) {
      fail = false;
      await route.fulfill({
        status: 500,
        json: { error: "Сервис покатушек недоступен" },
      });
    } else await route.continue();
  });
  await choose("Цель", "exploration");
  const alert = page.locator(".ride-list").getByRole("alert");
  await expect(alert).toContainText("Сервис покатушек недоступен");
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Сбросить всё" }).click();
  await expect(page.locator("main")).toContainText(titles.relaxed);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("reduced motion and a missing animation chunk keep the planner working", async ({
  page,
}) => {
  await member(page.request, "Calm");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  const gather = page.locator("section[aria-labelledby=gather-heading]");
  await expect(gather).toBeVisible();
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await gather.getByRole("button", { name: "1 ч", exact: true }).click();
  await expect(gather.getByRole("button", { name: "1 ч" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(gather.locator("[aria-busy=false]")).toHaveCount(1);
});
