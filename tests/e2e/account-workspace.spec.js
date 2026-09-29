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
  "Оформление",
  "Аккаунт",
];
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
