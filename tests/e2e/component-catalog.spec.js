import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { componentNavigation } from "../../lib/component-navigation.ts";
const defaultGroups = componentNavigation();
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
import { publicPath } from "../../lib/public-urls.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("product catalog separates installation text, paired products and public navigation", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let owner;
  try {
    const nonce = randomUUID().slice(0, 8);
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Product owner",
        email: "products-" + nonce + "@example.test",
        password: "products-browser-secret-123",
      },
    });
    expect(registered.status()).toBe(201);
    owner = (await registered.json()).user.id;
    const tire = "Schwalbe G-One RS " + nonce;
    const parts = [
      ["Передняя покрышка", tire],
      ["Задняя покрышка", tire],
      ["Передний тормоз", "Shimano XT M8100 " + nonce],
      ["Задний тормоз", "Shimano Deore M6100 " + nonce],
      ["Кассета", "Shimano Deore CS-M6100 " + nonce],
      ["Система / шатуны", "карбоновые шатуны " + nonce],
      ["Другое", "катафот " + nonce],
    ];
    const response = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: {
          name: "Продуктовая комплектация",
          brand: "Cube",
          model: "Travel",
          year: 2021,
          category: "road",
          is_public: true,
          description: "",
          color: "",
          size: "",
          weight: null,
        },
        components: parts.map(([category, name]) => ({
          section: "build",
          category,
          name,
          notes: "",
          price: null,
        })),
      },
    });
    expect(response.status()).toBe(201);
    const id = (await response.json()).id;
    const bike = (await db.query("SELECT * FROM bikes WHERE id=$1", [id]))
      .rows[0];
    const installations = (
      await db.query(
        "SELECT category,name,model_id,position FROM components WHERE bike_id=$1",
        [id],
      )
    ).rows;
    expect(installations).toHaveLength(7);
    expect(installations.filter((p) => p.model_id === null)).toHaveLength(3);
    const catalogResponse = await page.request.get(
      "/api/components?" + new URLSearchParams({ q: nonce }),
    );
    expect(catalogResponse.ok()).toBe(true);
    const catalog = await catalogResponse.json();
    expect(catalog.total).toBe(3);
    expect(catalog.items.filter((m) => m.category === "Покрышки")).toHaveLength(
      1,
    );
    expect(catalog.items.filter((m) => m.category === "Тормоза")).toHaveLength(
      2,
    );
    await page.goto(publicPath("bike", bike));
    for (const button of await page.locator(".component-group-toggle").all())
      if ((await button.getAttribute("aria-expanded")) === "false")
        await button.click();
    await expect(page.locator(".compact-part")).toHaveCount(7);
    for (const [, name] of parts.slice(4)) {
      const part = page.locator(".compact-part").filter({ hasText: name });
      await expect(part).toBeVisible();
      await expect(part.locator("strong a")).toHaveCount(0);
    }
    const links = page
      .locator(".compact-part")
      .filter({ hasText: tire })
      .locator("strong a");
    await expect(links).toHaveCount(2);
    expect(
      new Set(
        await links.evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("href")),
        ),
      ).size,
    ).toBe(1);
    await page.goto("/components?" + new URLSearchParams({ q: nonce }));
    const models = page.getByRole("region", { name: "Модели компонентов" });
    await expect(models.getByRole("heading", { level: 2 })).toHaveCount(3);
    const filters = page.getByRole("form", { name: "Фильтры компонентов" });
    for (const name of ["Кассета", "Другое", "Передняя покрышка"])
      await expect(
        filters.getByRole("option", { name, exact: true }),
      ).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("cola:theme", value);
        window.dispatchEvent(new Event("storage"));
      }, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        (await new AxeBuilder({ page }).include("main").analyze()).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath("component-products-" + theme + ".png"),
        fullPage: true,
      });
      expect(await pageOverflow(page)).toBeNull();
    }
  } finally {
    if (owner) await db.query("DELETE FROM users WHERE id=$1", [owner]);
    await db.end();
  }
});

test("component catalog: real filters, pagination, themes, mobile and durable model management", async ({
  page,
  isMobile,
}, info) => {
  const nonce = randomUUID().slice(0, 8),
    prefix = "Brooks Catalog " + nonce;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let owner;
  try {
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Catalog " + nonce,
        email: `catalog-e2e-${nonce}@example.test`,
        password: "catalog-browser-secret-123",
      },
    });
    expect(registered.status()).toBe(201);
    owner = (await registered.json()).user.id;
    const created = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: {
          name: "Catalog bike",
          brand: "Cube",
          model: "Travel",
          year: 2024,
          category: "road",
          is_public: true,
          description: "",
          color: "",
          size: "",
          weight: null,
        },
        components: Array.from({ length: 26 }, (_, n) => ({
          section: "build",
          category: "Седло",
          name: prefix + " " + n,
          notes: "",
          price: null,
        })),
      },
    });
    expect(created.status()).toBe(201);
    const bikeId = (await created.json()).id;
    await page.goto("/components");
    const categories = page.getByRole("region", {
      name: "Категории компонентов",
    });
    for (const group of defaultGroups) {
      const trigger = categories.getByRole("button", {
        name: new RegExp(group.name),
      });
      if (isMobile) await trigger.tap();
      else {
        await trigger.hover();
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await trigger.click();
      }
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const panel = page.locator("#component-group-types");
      for (const category of group.categories)
        await expect(
          panel.getByRole("link", { name: category, exact: true }),
        ).toBeVisible();
      if (!isMobile) {
        const neighbour = categories
          .getByRole("button")
          .filter({ hasNotText: group.name })
          .first();
        await neighbour.hover();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(neighbour).toHaveAttribute("aria-expanded", "false");
      }
      await trigger.focus();
      await trigger.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await categories
      .getByText("Все типы компонентов", { exact: false })
      .click();
    const directory = categories.locator("details");
    for (const category of defaultGroups.flatMap((g) => g.categories)) {
      await expect(
        directory.getByRole("link", { name: category, exact: true }),
      ).toHaveCount(1);
    }
    await directory.getByRole("link", { name: "Батарея", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("category") === "Батарея",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Компоненты 0",
    );
    await page.goto("/components#component-group-cockpit");
    await expect(
      categories.getByRole("button", { name: /Управление и посадка/ }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const filters = page.getByRole("form", { name: "Фильтры компонентов" });
    await filters.getByLabel("Поиск модели").fill(prefix);
    await filters
      .getByRole("combobox", { name: "Категория", exact: true })
      .selectOption("Седло");
    await filters
      .getByRole("combobox", { name: "Бренд", exact: true })
      .selectOption("Brooks");
    await filters.getByRole("button", { name: "Показать" }).click();
    const results = page.getByRole("region", { name: "Модели компонентов" });
    await expect(results.getByRole("heading", { level: 2 })).toHaveCount(24);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("26");
    await page
      .getByRole("navigation", { name: "Страницы", exact: true })
      .getByRole("link", { name: "Далее" })
      .click();
    await expect(results.getByRole("heading", { level: 2 })).toHaveCount(2);
    expect(new URL(page.url()).searchParams.get("brand")).toBe("Brooks");
    await page
      .getByRole("navigation", { name: "Сортировка компонентов" })
      .getByRole("link", { name: "Новые" })
      .click();
    await expect(results.getByRole("heading", { level: 2 })).toHaveCount(24);
    expect(new URL(page.url()).searchParams.get("page")).toBe("1");
    const names = await results
      .getByRole("heading", { level: 2 })
      .allTextContents();
    await page.reload();
    await expect(results.getByRole("heading", { level: 2 })).toHaveText(names);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => localStorage.setItem("cola:theme", t), theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const width of isMobile ? [390, 360] : [1440, 1120, 360]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await pageOverflow(page);
        expect(
          overflow,
          overflow ? describeOverflow(overflow) : "Page fits the viewport",
        ).toBeNull();
        await page.screenshot({
          path: info.outputPath(`components-${theme}-${width}.png`),
          fullPage: true,
        });
      }
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations).toEqual([]);
    }
    const modelLink = results
      .getByRole("heading", { level: 2 })
      .first()
      .getByRole("link");
    const oldPath = await modelLink.getAttribute("href"),
      modelName = await modelLink.innerText();
    await modelLink.click();
    await expect(
      page.getByRole("heading", { level: 1, name: modelName }),
    ).toBeVisible();
    const hidden = await page.request.patch(`/api/bikes/${bikeId}/share`, {
      headers: { origin },
      data: { is_public: false },
    });
    expect(hidden.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByText(
        "Пока нет публичных сборок с этой моделью. Страница остаётся в каталоге.",
      ),
    ).toBeVisible();
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [owner]);
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Каталог", exact: true }).click();
    await page
      .getByRole("button", { name: "Каталог компонентов", exact: true })
      .click();
    const management = page.getByRole("region", {
      name: "Управление каталогом компонентов",
    });
    await management
      .getByRole("textbox", { name: "Найти модель каталога", exact: true })
      .fill(modelName);
    await management
      .getByRole("button", { name: "Найти", exact: true })
      .click();
    await expect(
      management.getByRole("link", { name: modelName, exact: true }),
    ).toBeVisible();
    await management
      .locator(".list-row")
      .filter({ has: page.getByRole("link", { name: modelName, exact: true }) })
      .getByRole("button", { name: "Изменить", exact: true })
      .click();
    await management
      .getByLabel("Название модели", { exact: true })
      .fill(modelName + " Classic");
    await management
      .getByRole("button", { name: "Сохранить модель", exact: true })
      .click();
    await expect(
      management.getByText("Модель сохранена. Прежние ссылки сохранены.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(oldPath);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      modelName + " Classic",
    );
    expect(new URL(page.url()).pathname).not.toBe(oldPath);
  } finally {
    if (owner) await db.query("DELETE FROM users WHERE id=$1", [owner]);
    await db.end();
  }
});
