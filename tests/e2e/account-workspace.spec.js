import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";

// #245: the account as a Hugging Face Settings workspace.
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const sections = [
  "Обзор",
  "Мой профиль",
  "Мои велосипеды",
  "Мои покатушки",
  "Интеграции и импорт",
  "Социальное",
  "Достижения",
  "Велосипед недели",
  "Оформление",
  "Аккаунт",
];
test("an unavailable account profile reports an error without crashing the page", async ({
  page,
}) => {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Missing profile",
      email: `missing-profile-${randomUUID()}@example.test`,
      password: "workspace-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/social/account", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), profile: null },
    });
  });
  await page.goto("/account");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Профиль недоступен. Обновите страницу.",
  );
  await expect(
    page.getByRole("heading", { name: "Личный кабинет", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("sidebar, overview actions, one section shell, imports moved, old links and the header avatar", async ({
  page,
  isMobile,
}, info) => {
  const name = "Workspace " + randomUUID().slice(0, 8);
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: `workspace-${randomUUID()}@example.test`,
      password: "workspace-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Workspace gravel",
      brand: "Canyon",
      model: "Grizl",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    },
  });
  // The avatar in the header is a link to the account; the menu has its
  // own chevron.
  await page.goto("/");
  if (!isMobile) {
    await page
      .locator(".global-header")
      .getByRole("link", { name: "Личный кабинет" })
      .click();
    await expect(page).toHaveURL(/\/account$/);
    const menu = page
      .locator(".global-header")
      .getByRole("button", { name: "Аккаунт — " + name });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
  } else await page.goto("/account");
  const nav = page.getByRole("navigation", {
    name: "Разделы личного кабинета",
  });
  const toggle = page.getByRole("button", { name: /^Раздел:/ });
  const open = async (label) => {
    if (isMobile) await toggle.click();
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Разделы кабинета" }),
    ).toHaveCount(0);
  };
  // One navigation at a time: a column on desktop, a selector on phones.
  if (isMobile) {
    await expect(nav).toHaveCount(0);
    await expect(toggle).toHaveAccessibleName("Раздел: Обзор");
    await toggle.click();
  } else await expect(toggle).toBeHidden();
  await expect(nav.getByRole("link")).toHaveText(sections);
  await expect(
    nav.getByRole("link", { name: "Обзор", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (isMobile) {
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
  }
  // Overview: exactly the two riding actions, no «Добавить велосипед».
  const overview = page.locator(".account-overview");
  await expect(overview.getByRole("button")).toHaveText([
    "Хочу кататься",
    "Организовать покатушку",
  ]);
  await expect(
    page.locator(".account-main").getByText("Добавить велосипед"),
  ).toHaveCount(0);
  // «Мои велосипеды» and «Мои покатушки» share one shell.
  await open("Мои велосипеды");
  await expect(page).toHaveURL(/tab=bikes/);
  const head = page.locator(".account-section-head");
  await expect(
    head.getByRole("heading", { level: 2, name: "Мои велосипеды" }),
  ).toBeVisible();
  await expect(
    head.getByRole("button", { name: "Добавить велосипед" }),
  ).toBeVisible();
  await expect(page.locator(".account-toolbar")).toHaveCount(1);
  const bikesAction = await head
    .getByRole("button", { name: "Добавить велосипед" })
    .boundingBox();
  await open("Мои покатушки");
  await expect(page).toHaveURL(/tab=rides/);
  await expect(
    head.getByRole("heading", { level: 2, name: "Мои покатушки" }),
  ).toBeVisible();
  const ridesAction = await head
    .getByRole("button", { name: "Организовать покатушку" })
    .boundingBox();
  expect(Math.abs(ridesAction.height - bikesAction.height)).toBeLessThan(2);
  await expect(page.locator(".account-toolbar")).toHaveCount(1);
  const main = page.locator(".account-main");
  for (const technical of [
    "Garmin CSV",
    "Ride with GPS",
    "Загрузить GPX",
    "Синхронизировать",
  ])
    await expect(main.getByText(technical)).toHaveCount(0);
  // Browser history follows the sections.
  await page.goBack();
  await expect(page).toHaveURL(/tab=bikes/);
  await page.goForward();
  await expect(page).toHaveURL(/tab=rides/);
  await open("Велосипед недели");
  await expect(page).toHaveURL(/tab=spotlight/);
  await expect(
    main.getByRole("heading", { name: "Велосипед недели", exact: true }),
  ).toBeVisible();
  // Old import links land in «Интеграции и импорт» with the same intent.
  await page.goto("/account?tab=rides&action=add");
  await expect(page).toHaveURL(/tab=integrations&action=add/);
  await expect(page.getByLabel("Файл трека", { exact: false })).toBeVisible();
  await page.goto("/account?tab=rides&activity_sync=error");
  await expect(page).toHaveURL(/tab=integrations/);
  const rwgps = page.getByRole("region", { name: "Ride with GPS" });
  await expect(rwgps.getByRole("alert")).toContainText(
    "Не удалось подключить Ride with GPS",
  );
  await expect(
    page.getByRole("group", { name: "Garmin Connect" }),
  ).toContainText("Скоро");
  await page.goto("/account?tab=integrations");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
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
      path: info.outputPath(`account-integrations-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await open("Обзор");
  await page.screenshot({
    path: info.outputPath("account-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("a failed ride settings load does not strand «Изменить» or «Повторить»", async ({
  page,
}) => {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Settings " + randomUUID().slice(0, 8),
      email: `settings-${randomUUID()}@example.test`,
      password: "workspace-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const bike = await (
    await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Settings gravel",
        brand: "Canyon",
        model: "Grizl",
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: false,
      },
    })
  ).json();
  const created = await page.request.post("/api/rides/plan", {
    headers: { origin },
    data: {
      bikeId: bike.id,
      title: "План для правки",
      description: "",
      isPublic: false,
      privacyEnabled: false,
      privacyRadiusM: 500,
      scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);
  // The next settings request fails; later ones succeed.
  let fails = 1;
  await page.route("**/api/rides/settings", (route) => {
    if (fails <= 0) return route.continue();
    fails--;
    return route.fulfill({
      status: 500,
      json: { error: "Настройки недоступны" },
    });
  });
  await page.goto("/account?tab=rides");
  const section = page.locator(".account-section");
  await expect(section.getByRole("alert")).toContainText(
    "Настройки недоступны",
  );
  // «Повторить» reloads the missing settings too.
  const settings = page.waitForResponse((r) =>
    r.url().endsWith("/api/rides/settings"),
  );
  await section.getByRole("button", { name: "Повторить" }).click();
  expect((await settings).ok()).toBe(true);
  await expect(section.getByRole("alert")).toHaveCount(0);
  // Editing after a failed first load fetches the settings itself.
  fails = 1;
  await page.goto("/account?tab=rides");
  await expect(section.getByRole("alert")).toContainText(
    "Настройки недоступны",
  );
  await page
    .locator(".ride-card", { hasText: "План для правки" })
    .getByRole("button", { name: "Изменить" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Изменить покатушку" }),
  ).toBeVisible();
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "План для правки",
  );
});
