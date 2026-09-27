import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

test("component photo search previews, confirms and publishes attributed local media in both themes", async ({
  page,
  isMobile,
}, info) => {
  const nonce = randomUUID().slice(0, 8),
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let user;
  try {
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Search reader " + nonce,
        email: `search-ui-${nonce}@example.test`,
        password: "photo-search-browser-123",
      },
    });
    expect(registered.status()).toBe(201);
    user = (await registered.json()).user.id;
    const created = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: {
          name: "Search bicycle",
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
        components: [
          {
            section: "build",
            category: "Седло",
            name: "Commons Saddle " + nonce,
            notes: "",
            price: null,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const bike = (await created.json()).id;
    const part = (
      await db.query("SELECT id,model_id FROM components WHERE bike_id=$1", [
        bike,
      ])
    ).rows[0];
    await db.query("DELETE FROM components WHERE id=$1", [part.id]);
    await page.goto("/components/" + part.model_id);
    const gallery = page.getByRole("region", {
      name: "Фотографии компонента",
      exact: true,
    });
    await expect(
      gallery.getByLabel("Ваше фото компонента", { exact: true }),
    ).toHaveCount(0);
    await gallery
      .getByRole("button", { name: "Найти фото", exact: true })
      .click();
    const selection = gallery.getByRole("group", {
      name: "Выберите до трёх фотографий",
    });
    await expect(selection).toBeVisible();
    await expect(selection.locator("img")).toHaveCount(2);
    await expect
      .poll(() =>
        selection
          .locator("img")
          .evaluateAll((images) =>
            images.every((img) => img.complete && img.naturalWidth > 0),
          ),
      )
      .toBe(true);
    await selection
      .getByRole("checkbox", { name: /Выбрать:/ })
      .first()
      .check();
    await expect(
      selection.getByRole("button", { name: /Опубликовать выбранные/ }),
    ).toBeDisabled();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      for (const width of isMobile ? [320, 390] : [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await pageOverflow(page);
        expect(
          overflow,
          overflow ? describeOverflow(overflow) : "fits",
        ).toBeNull();
        await page.screenshot({
          path: info.outputPath(`component-search-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    const axe = await new AxeBuilder({ page })
      .include('section[aria-labelledby="component-photos"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await selection
      .getByRole("checkbox", { name: /Я проверил модель/ })
      .check();
    await selection
      .getByRole("button", { name: /Опубликовать выбранные/ })
      .click();
    await expect(gallery.locator("figure")).toHaveCount(1);
    await expect(
      gallery.getByRole("button", { name: "Найти фото", exact: true }),
    ).toHaveCount(0);
    await expect(
      gallery
        .getByRole("complementary", { name: "Действия и сведения о фото" })
        .getByText("Автор: Fixture author", { exact: true }),
    ).toBeVisible();
    await expect(
      gallery
        .getByRole("complementary", { name: "Действия и сведения о фото" })
        .getByRole("link", { name: "CC BY-SA 4.0" }),
    ).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    await expect(gallery.locator("figure img")).toHaveAttribute(
      "src",
      /^\/api\/components\/media\//,
    );
  } finally {
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
