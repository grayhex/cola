import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";

// #245 «Покататься вместе» on the home page, #241 coarse area picking and
// #233 public filters, on real APIs.
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
let organizer;
test.beforeAll(async ({ browser }) => {
  organizer = await browser.newContext();
  await member(organizer.request, "Organizer");
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
  await plan(titles.suits, day(5), "06:30", "08:30", {
    purpose: "social",
    pace: "moderate",
    area: { label: "Парк Горького", center: [37.6, 55.73], radiusM: 3000 },
  });
  await plan(titles.maybe, day(6), "12:00", "15:00", {
    purpose: "training",
    pace: "sporty",
    surface: "gravel",
  });
  await plan(titles.relaxed, day(7), "10:00", "11:00", {
    purpose: "leisure",
    pace: "relaxed",
    area: { label: "Сокольники" },
  });
});
test.afterAll(async () => {
  await organizer?.close();
});
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
});

const personalApi =
  /\/api\/(ride-matches|ride-intents|rides\?own|bikes$|rides\/settings)/;
const togetherBlock = (page) =>
  page.locator("section[aria-labelledby=together-heading]");

test("signed-in home: one «Покататься вместе» block, both composers in windows, themes and account switch", async ({
  page,
}, info) => {
  await member(page.request, "Rider");
  const personal = [];
  page.on("request", (r) => {
    if (personalApi.test(r.url())) personal.push(r.url());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const block = togetherBlock(page);
  await expect(
    block.getByRole("heading", { name: "Покататься вместе" }),
  ).toBeVisible();
  // #245: the personal dashboard is gone, and so are its requests.
  for (const gone of ["Ты собираешься", "Подходит тебе", "Можно собраться"])
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  expect(
    personal.filter((url) => !url.endsWith("/ride-intents/pulse")),
  ).toEqual([]);
  const buttons = block.getByRole("button");
  await expect(buttons).toHaveText(["Хочу кататься", "Организовать покатушку"]);
  // Order: hero, ride-together, weekly bike, then four destinations.
  const top = async (selector) =>
    (await page.locator(selector).first().boundingBox()).y;
  expect(await top("#hero-title")).toBeLessThan(await top("#together-heading"));
  expect(await top("#together-heading")).toBeLessThan(
    await top("#bike-week-heading"),
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
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== "running"),
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include("section[aria-labelledby=together-heading]")
          .analyze()
      ).violations,
    ).toEqual([]);
    // The block is its own surface: its background differs from the page.
    const [pageBg, blockBg] = await block.evaluate((el) => [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(el.querySelector(".frame-inner")).backgroundColor,
    ]);
    expect(blockBg).not.toBe(pageBg);
    expect(pageBg).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`home-together-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  // «Хочу кататься»: the #231 composer; the area is picked without a mouse.
  const want = block.getByRole("button", { name: "Хочу кататься" });
  await want.click();
  // The same «Новое намерение» window as on /ride-intents (#264).
  const dialog = page.getByRole("dialog", {
    name: "Новое намерение",
    exact: true,
  });
  await dialog.getByRole("button", { name: "В выходные", exact: true }).click();
  await dialog.getByLabel("Область поездки").fill("Воробьёвы горы");
  await dialog.getByRole("button", { name: /^Цель:/ }).click();
  await page
    .getByRole("dialog", { name: "Цель поездки" })
    .getByRole("button", { name: "Общение", exact: true })
    .click();
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
  await expect(block.getByRole("status")).toContainText("Намерение сохранено");
  const own = await call(page.request, "ride-intents?scope=own", "GET");
  const picked = own.items.find(
    (i) => i.passport.area.label === "Воробьёвы горы",
  );
  expect(picked.passport.area.radiusM).toBe(3000);
  for (const n of picked.passport.area.center)
    expect(Math.round(n * 100) / 100).toBe(n); // never finer than 0.01°
  // «Организовать покатушку» without a bike: an explanation, no ride.
  const organize = block.getByRole("button", {
    name: "Организовать покатушку",
  });
  await organize.click();
  const planner = page.getByRole("dialog", { name: "Организовать покатушку" });
  await expect(planner).toContainText("Покатушка привязана к велосипеду");
  await expect(
    planner.getByRole("link", { name: "Добавить велосипед" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(planner).toHaveCount(0);
  await expect(organize).toBeFocused();
  expect((await call(page.request, "rides?own=1", "GET")).rides.length).toBe(0);
  // With a bike the same window holds the plan form and saves on the spot.
  await call(page.request, "bikes", "POST", {
    name: "Rider bike",
    brand: "Trek",
    model: "Checkpoint",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  });
  await organize.click();
  await planner.getByLabel("Название", { exact: true }).fill("Круг с главной");
  await planner.getByLabel("Дата", { exact: true }).fill(day(4));
  await planner.getByLabel("Старт", { exact: true }).fill("09:00");
  await planner
    .getByRole("button", { name: "Создать покатушку", exact: true })
    .click();
  await expect(planner).toHaveCount(0);
  await expect(block.getByRole("status")).toContainText(
    "Покатушка запланирована",
  );
  await expect(
    block.getByRole("status").getByRole("link", { name: "Мои покатушки" }),
  ).toHaveAttribute("href", "/account?tab=rides");
  expect(
    (await call(page.request, "rides?own=1", "GET")).rides.map((r) => r.title),
  ).toContain("Круг с главной");
  // Logout and another account: nothing personal remains on the page.
  await call(page.request, "auth/logout", "POST");
  await page.goto("/");
  await expect(
    block.getByRole("link", { name: "Хочу кататься" }),
  ).toHaveAttribute("href", "/ride-intents?new=1");
  await expect(block.getByRole("status")).toHaveCount(0);
  await member(page.request, "Second");
  await page.goto("/");
  await expect(
    block.getByRole("button", { name: "Хочу кататься" }),
  ).toBeVisible();
  await expect(block.getByRole("status")).toHaveCount(0);
  await expect(block).not.toContainText("Воробьёвы горы");
});

test("guest home stays public: the same block, links to sign in, no personal requests or cached data", async ({
  page,
}) => {
  const personal = [];
  page.on("request", (r) => {
    if (personalApi.test(r.url())) personal.push(r.url());
  });
  const response = await page.goto("/", { waitUntil: "networkidle" });
  const html = await response.text();
  const block = togetherBlock(page);
  await expect(
    block.getByRole("heading", { name: "Покататься вместе" }),
  ).toBeVisible();
  // The block is server-rendered: no personal data, no layout shift.
  expect(html).toContain("Покататься вместе");
  await expect(
    block.getByRole("link", { name: "Хочу кататься" }),
  ).toHaveAttribute("href", "/ride-intents?new=1");
  await expect(
    block.getByRole("link", { name: "Организовать покатушку" }),
  ).toHaveAttribute("href", "/account?tab=rides&action=plan");
  expect(personal).toEqual([]);
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
  await choose("Цель", "adventure");
  await expect(
    page.getByRole("button", { name: "Убрать фильтр Приключение" }),
  ).toBeVisible();
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
  // A district typed and, within the pause, another filter chosen: the
  // delayed URL write carries both, never a stale snapshot.
  if (!isMobile) {
    const bar = page.locator(".ride-filters");
    await bar.getByLabel("Район или парк").fill("Сокол");
    await bar.getByLabel("Покрытие").selectOption("asphalt");
    await expect(page).toHaveURL(/area=/);
    const settled = new URL(page.url());
    expect(settled.searchParams.get("surface")).toBe("asphalt");
    expect(settled.searchParams.get("area")).toBe("Сокол");
  }
  await page.getByRole("button", { name: "Сбросить всё" }).click();
  await expect(page.locator("main")).toContainText(titles.relaxed);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("the composer chunk: reduced motion, a failed load, a slow load, then the window", async ({
  page,
}) => {
  await member(page.request, "Calm");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  const block = togetherBlock(page);
  const want = block.getByRole("button", { name: "Хочу кататься" });
  await expect(want).toBeEnabled();
  // A lost chunk shows an error and leaves the action usable.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await want.click();
  await expect(block.getByRole("alert")).toContainText("Не удалось открыть");
  await expect(want).toBeEnabled();
  await page.unroute("**/_next/static/**/*.js");
  // A slow network: the button says it is opening, then the window appears.
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js", async (route) => {
    await slow;
    await route.continue();
  });
  await want.click();
  await expect(
    block.getByRole("button", { name: "Открываем…" }).first(),
  ).toBeDisabled();
  release();
  const dialog = page.getByRole("dialog", { name: "Новое намерение" });
  await expect(dialog).toBeVisible();
  await expect(block.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(want).toBeFocused();
});
