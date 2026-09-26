import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

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
    const filters = page.getByRole("form", { name: "Фильтры компонентов" });
    await filters.getByLabel("Поиск модели").fill(prefix);
    await filters
      .getByLabel("Категория", { exact: true })
      .selectOption("Седло");
    await filters.getByLabel("Бренд", { exact: true }).selectOption("Brooks");
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
