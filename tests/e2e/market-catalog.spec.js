import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("market catalog: optional models, independent listing, private bicycle and responsive editing", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const nonce = randomUUID().slice(0, 8),
    name = "Объявление " + nonce,
    partName = "Brooks Market " + nonce;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const guestContext = await browser.newContext(info.project.use);
  let owner;
  try {
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "MarketLinks " + nonce,
        email: `market-links-${nonce}@example.test`,
        password: "market-links-browser-123",
      },
    });
    expect(registered.status()).toBe(201);
    owner = (await registered.json()).user.id;
    const bikeInput = {
      name: "Публичный велосипед " + nonce,
      brand: "MarketBrand" + nonce,
      model: "Test Model",
      year: 2024,
      category: "road",
      is_public: true,
      description: "",
      color: "",
      size: "",
      weight: null,
    };
    const seed = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: bikeInput,
        components: [
          {
            section: "build",
            category: "Седло",
            name: partName,
            notes: "",
            price: null,
          },
        ],
      },
    });
    expect(seed.status()).toBe(201);
    const bikeId = (await seed.json()).id;
    const bike = (await (await page.request.get("/api/bikes/" + bikeId)).json())
      .bike;
    const secret = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        ...bikeInput,
        name: "Приватный велосипед " + nonce,
        is_public: false,
      },
    });
    expect(secret.status()).toBe(201);
    const privateId = (await secret.json()).id;
    await page.goto("/market/new");
    await page.getByLabel("Название", { exact: true }).fill(name);
    await page
      .getByLabel("Описание", { exact: true })
      .fill("Описание моего товара, не каталожная карточка");
    await page.getByLabel("Цена, ₽", { exact: true }).fill("950");
    await page
      .getByLabel("Категория", { exact: true })
      .selectOption("components");
    await page
      .getByLabel("Найти модель компонента", { exact: true })
      .fill(partName);
    await page
      .getByRole("button", { name: "Найти модель", exact: true })
      .click();
    await page
      .getByLabel("Модель каталога", { exact: true })
      .selectOption(bike.components[0].model_id);
    await expect(page.getByText("Выбрана модель:")).toContainText(partName);
    await page
      .getByLabel("Мой велосипед", { exact: true })
      .selectOption(privateId);
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    const detailUrl = page.url(),
      listing = (
        await db.query(
          "SELECT id,share_id FROM market_listings WHERE owner_id=$1",
          [owner],
        )
      ).rows[0];
    const anonymous = await guestContext.newPage();
    await anonymous.goto(detailUrl);
    await expect(
      anonymous.getByRole("link", { name: partName, exact: true }),
    ).toBeVisible();
    await expect(
      anonymous.getByText("Приватный велосипед " + nonce, { exact: false }),
    ).toHaveCount(0);
    const publicJson = await (
      await guestContext.request.get("/api/market/public/" + listing.share_id)
    ).json();
    expect(JSON.stringify(publicJson)).not.toContain(privateId);
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await expect(page.getByLabel("Мой велосипед", { exact: true })).toHaveValue(
      privateId,
    );
    await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
      name,
    );
    await page.getByLabel("Категория", { exact: true }).selectOption("bikes");
    await expect(page.getByText("Выбрана модель:")).toHaveCount(0);
    await page
      .getByLabel("Найти модель велосипеда", { exact: true })
      .fill(bikeInput.brand);
    await page
      .getByRole("button", { name: "Найти модель", exact: true })
      .click();
    await page
      .getByLabel("Модель каталога", { exact: true })
      .selectOption(bike.catalog_model_id);
    await page
      .getByLabel("Мой велосипед", { exact: true })
      .selectOption(bikeId);
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await anonymous.reload();
    await expect(
      anonymous.getByRole("link", { name: bikeInput.name, exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => localStorage.setItem("cola:theme", t), theme);
      await page.goto(detailUrl);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Изменить", exact: true }).click();
      await expect(page.getByText("Выбрана модель:")).toContainText(
        bikeInput.brand,
      );
      for (const width of isMobile ? [390, 360] : [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await pageOverflow(page);
        expect(
          overflow,
          overflow ? describeOverflow(overflow) : "Page fits viewport",
        ).toBeNull();
        await expect(
          page.getByLabel("Мой велосипед", { exact: true }),
        ).toHaveValue(bikeId);
        await page.screenshot({
          path: info.outputPath(`market-catalog-${theme}-${width}.png`),
          fullPage: true,
        });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
      }
    }
    // Removing both links is a normal edit, not a new/changed advertisement.
    await page
      .getByRole("button", { name: "Убрать модель", exact: true })
      .click();
    await page.getByLabel("Мой велосипед", { exact: true }).selectOption("");
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    let dto = (
      await (
        await page.request.get("/api/market/public/" + listing.share_id)
      ).json()
    ).listing;
    expect(dto.bikeModel).toBeNull();
    expect(dto.linkedBike).toBeNull();
    expect(Number(dto.price)).toBe(950);
    await page.goto("/market/new");
    await page
      .getByLabel("Название", { exact: true })
      .fill("Ручное объявление " + nonce);
    await page
      .getByLabel("Описание", { exact: true })
      .fill("Моей модели нет в каталоге");
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Ручное объявление " + nonce,
      }),
    ).toBeVisible();
  } finally {
    await guestContext.close();
    if (owner) await db.query("DELETE FROM users WHERE id=$1", [owner]);
    await db.end();
  }
});
