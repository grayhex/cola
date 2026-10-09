import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { pageOverflow } from "../fixtures/overflow.js";

// #382: «Достижения» is a section of the main menu of its own, with «Рекорды»
// (/records) and «Награды» (/records?tab=awards); «Рекорды» left
// «Велосипеды». The page already open follows the menu and «Назад» /
// «Вперёд»; a list of the menu saved before the section existed gets it once.
let db, original;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
});
test.afterAll(async () => {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  await db.end();
});
// The menu of a visit: the section, its two links, the way to each page.
async function section(page, isMobile) {
  if (isMobile) {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    return page
      .getByRole("dialog", { name: "Меню ColaBike" })
      .locator("[data-section='achievements']");
  }
  return page.locator("header");
}
async function openMenu(page, isMobile) {
  if (isMobile) return section(page, true);
  const trigger = page.getByRole("button", {
    name: "Подразделы: Достижения",
    exact: true,
  });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return page.locator("header .nav-popover:visible");
}
test("«Достижения» is its own section: two links, none left in «Велосипеды», the open page follows the menu and Back/Forward", async ({
  page,
  isMobile,
}, info) => {
  await page.goto("/about");
  // A guest sees it: after «Покатушки», before «Рынок».
  const sections = isMobile
    ? page.getByRole("button", { name: "Открыть меню" })
    : page.locator("header .primary-navigation > *");
  if (!isMobile) {
    const names = await page
      .locator("header .primary-navigation a.nav-trigger")
      .allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([
      "Велосипеды",
      "Компоненты",
      "Журнал",
      "Статьи",
      "Покатушки",
      "Достижения",
      "Рынок",
      "О проекте",
    ]);
    expect(await sections.count()).toBeGreaterThan(0);
    expect(await pageOverflow(page)).toBeNull();
    // Eight sections fit between the brand and the utilities wherever the full
    // menu shows, and fold into the panel (the «Открыть меню» button) below
    // 1276 px.
    for (const width of [1101, 1275]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("header .primary-navigation")).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Открыть меню" }),
      ).toBeVisible();
      expect(await pageOverflow(page)).toBeNull();
    }
    for (const width of [1276, 1280, 1350, 1440, 1499, 1500, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("header .primary-navigation")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Открыть меню" }),
      ).toBeHidden();
      const fit = await page.evaluate(() => {
        const rect = (selector) =>
          document.querySelector(selector)?.getBoundingClientRect();
        const nav = rect("header .primary-navigation");
        const brand = rect("header .brand");
        const utilities = rect("header .nav-utilities");
        const items = [
          ...document.querySelectorAll(
            "header .primary-navigation a.nav-trigger",
          ),
        ].map((a) => a.getBoundingClientRect());
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          beyond: nav.right - innerWidth,
          overBrand: brand.right - nav.left,
          overUtilities: nav.right - utilities.left,
          // Every label on one line.
          wrapped: items.some((box) => box.height > 40),
        };
      });
      expect(fit.overflow, "page at " + width).toBeLessThanOrEqual(1);
      expect(fit.beyond, "right edge at " + width).toBeLessThanOrEqual(0);
      expect(fit.overBrand, "brand at " + width).toBeLessThanOrEqual(0);
      expect(fit.overUtilities, "utilities at " + width).toBeLessThanOrEqual(0);
      expect(fit.wrapped, "wrapped label at " + width).toBe(false);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  // «Велосипеды» has no records of its own any more.
  if (isMobile) {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    const drawer = page.getByRole("dialog", { name: "Меню ColaBike" });
    await expect(
      drawer.locator("[data-section='bikes']").getByRole("link", {
        name: "Рекорды",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(drawer.locator("[data-section='achievements'] a")).toHaveText([
      "Достижения",
      "Рекорды",
      "Награды",
    ]);
    await page.keyboard.press("Escape");
  } else {
    const bikes = page.getByRole("button", {
      name: "Подразделы: Велосипеды",
      exact: true,
    });
    await bikes.click();
    await expect(
      page.locator("header .nav-popover:visible").getByRole("link", {
        name: "Рекорды",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  // A mark in the window to tell a navigation inside the app from a reload.
  await page.goto("/records");
  await page.evaluate(() => (window.__kept = "same document"));
  await expect(
    page.getByRole("button", { name: "Рекорды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const go = async (label) => {
    const menu = await openMenu(page, isMobile);
    await menu.getByRole("link", { name: label, exact: true }).click();
  };
  await go("Награды");
  await expect(page).toHaveURL(/\/records\?tab=awards$/);
  await expect(
    page.getByRole("button", { name: "Награды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Рекорды", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__kept)).toBe("same document");
  // The section is the current one and so is the item of the submenu.
  if (!isMobile) {
    await expect(
      page
        .locator("header")
        .getByRole("link", { name: /Достижения/ })
        .first(),
    ).toHaveAttribute("aria-current", "page");
    const menu = await openMenu(page, false);
    await expect(
      menu.getByRole("link", { name: "Награды", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      menu.getByRole("link", { name: "Рекорды", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
  }
  await go("Рекорды");
  await expect(page).toHaveURL(/\/records$/);
  await expect(
    page.getByRole("button", { name: "Рекорды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__kept)).toBe("same document");
  // Back and Forward follow the address.
  await page.goBack();
  await expect(page).toHaveURL(/\/records\?tab=awards$/);
  await expect(
    page.getByRole("button", { name: "Награды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(page).toHaveURL(/\/records$/);
  await expect(
    page.getByRole("button", { name: "Рекорды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The tabs of the page keep the address too.
  await page.getByRole("button", { name: "Награды", exact: true }).click();
  await expect(page).toHaveURL(/\/records\?tab=awards$/);
  expect(await pageOverflow(page)).toBeNull();
  if (!isMobile)
    expect(
      (await new AxeBuilder({ page }).include("header").analyze()).violations,
    ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("achievements-menu.png"),
    animations: "disabled",
  });
});

test("a menu saved before «Достижения» gets it once; one the administrator hid or renamed stays as it is", async ({
  page,
  isMobile,
}) => {
  const stored = (patch) =>
    db.query("UPDATE site_settings SET value=$1::jsonb WHERE id=1", [
      { ...original, ...patch },
    ]);
  const labels = async () => {
    await page.goto("/about");
    if (isMobile) {
      await page.getByRole("button", { name: "Открыть меню" }).click();
      return page
        .getByRole("dialog", { name: "Меню ColaBike" })
        .locator("[data-section] > details > summary a, [data-section] > a")
        .allInnerTexts()
        .then((all) => all.map((n) => n.trim()));
    }
    return (
      await page
        .locator("header .primary-navigation a.nav-trigger")
        .allInnerTexts()
    ).map((n) => n.trim());
  };
  // An old list: seven sections in the administrator's order, one hidden.
  const old = [
    { id: "about", label: "О проекте", visible: true },
    { id: "rides", label: "Покатушки", visible: true },
    { id: "bikes", label: "Мой гараж", visible: true },
    { id: "market", label: "Рынок", visible: false },
    { id: "journal", label: "Журнал", visible: true },
  ];
  await stored({ navigation: old });
  const names = await labels();
  // «Компоненты» and «Статьи» join by the rules they had; «Достижения»
  // follows «Покатушки»; the order and the names of the others are kept.
  expect(names).toEqual([
    "О проекте",
    "Покатушки",
    "Достижения",
    "Мой гараж",
    "Компоненты",
    "Журнал",
    "Статьи",
  ]);
  expect(names).not.toContain("Рынок");
  // Saved by the administrator as hidden and renamed: not added again.
  await stored({
    navigation: [
      { id: "bikes", label: "Велосипеды", visible: true },
      { id: "achievements", label: "Хроника", visible: false },
      { id: "rides", label: "Покатушки", visible: true },
      { id: "about", label: "О проекте", visible: true },
    ],
  });
  const hidden = await labels();
  expect(hidden).not.toContain("Достижения");
  expect(hidden).not.toContain("Хроника");
  // Renamed and shown: the name is the administrator's.
  await stored({
    navigation: [
      { id: "bikes", label: "Велосипеды", visible: true },
      { id: "achievements", label: "Хроника", visible: true },
      { id: "rides", label: "Покатушки", visible: true },
      { id: "about", label: "О проекте", visible: true },
    ],
  });
  expect(await labels()).toContain("Хроника");
});
