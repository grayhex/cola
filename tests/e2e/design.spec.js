import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("dense visual system: shared cards, filters, search, themes and responsive grids", async ({
  page,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const suffix = randomUUID().slice(0, 8),
    name = "Design " + suffix;
  const register = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      name,
      email: suffix + "@example.test",
      password: "design-browser-secret-123",
    },
  });
  expect(register.status()).toBe(201);
  const user = (await (await page.request.get("/api/me")).json()).user;
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  const overview = await (await page.request.get("/api/admin/overview")).json();
  const original = overview.settings;
  const originalCatalog = overview.catalog;
  const bikes = [];
  let asset;
  async function settings(value) {
    const latest = await (await page.request.get("/api/admin/overview")).json();
    const r = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: {
        value: { ...original, ...value },
        version: latest.settingsVersion,
      },
    });
    expect(r.status()).toBe(200);
  }
  async function screenshot(label) {
    await page.screenshot({
      path: info.outputPath(label + ".png"),
      fullPage: true,
      animations: "disabled",
    });
  }
  async function noOverflow() {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  try {
    const image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#c0d4cd" },
    })
      .png()
      .toBuffer();
    const uploaded = await page.request.post(
      "/api/admin/assets?name=Design-fixture",
      { headers: { origin, "Content-Type": "image/png" }, data: image },
    );
    expect(uploaded.status()).toBe(201);
    asset = (await uploaded.json()).id;
    for (let i = 0; i < 5; i++) {
      const category = ["road", "mtb", "gravel"][i % 3];
      const r = await page.request.post("/api/bikes", {
        headers: { origin },
        data: {
          name:
            name + " — " + i + " Long bicycle model with an expressive name",
          brand: "Cube",
          model: "Travel",
          year: 2020,
          category,
          description: "",
          color: "",
          size: i ? "" : "M",
          weight: i ? null : 12,
          is_public: true,
        },
      });
      expect(r.status()).toBe(201);
      bikes.push((await r.json()).id);
    }
    await settings({
      roadImageId: asset,
      mtbImageId: asset,
      gravelImageId: asset,
    });
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?q=" + encodeURIComponent(name));
    await expect(page.locator(".bike-card")).toHaveCount(5);
    const card = page.locator(".bike-card").first();
    await expect(card.locator(".card-social .author-link")).toBeVisible();
    await expect(card.locator(".card-photo .like-button")).toHaveCount(0);
    expect(await card.locator(".important-badge").count()).toBeLessThanOrEqual(
      1,
    );
    expect(
      await card
        .locator(".card-identity-row h2")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("17px");
    await expect(card.locator(".card-info > *")).toHaveCount(2);
    await expect(card.locator(".like-button img")).toHaveCount(0);
    await expect(card.locator(".like-button .site-emoji")).toBeVisible();
    expect(
      await card
        .locator(".card-open-photo > img")
        .evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe("contain");
    await expect(card.locator(".card-info")).not.toContainText("2020");
    const heading = await page.locator(".garage-heading h1").boundingBox();
    const controls = await page.locator(".showcase-actions").boundingBox();
    expect(heading.width).toBeGreaterThan(100);
    if (!isMobile)
      expect(
        Math.abs(
          heading.y + heading.height / 2 - controls.y - controls.height / 2,
        ),
      ).toBeLessThan(3);
    await expect(card.locator(".micro-metric")).toHaveCount(0);
    await expect(
      card.getByRole("link", { name: "Похожие сборки" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    const panel = page.getByRole("dialog", { name: "Фильтры", exact: true });
    await panel.getByRole("checkbox").nth(0).check();
    await panel.getByRole("checkbox").nth(1).check();
    expect(
      await panel
        .getByRole("button", { name: "Применить" })
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await screenshot("filters");
    await panel.getByRole("button", { name: "Применить" }).click();
    await expect(
      page.locator('.filter-chips button[aria-label^="Убрать фильтр"]'),
    ).toHaveCount(2);
    await expect
      .poll(async () => page.locator(".bike-card").count())
      .toBeLessThan(5);
    const invalid = await page.request.get("/api/showcase?category=unknown");
    expect(invalid.status()).toBe(400);
    while (
      await page
        .locator('.filter-chips button[aria-label^="Убрать фильтр"]')
        .count()
    )
      await page
        .locator('.filter-chips button[aria-label^="Убрать фильтр"]')
        .first()
        .click();
    await expect(page.locator(".bike-card")).toHaveCount(5);
    await page.getByRole("button", { name: "Порядок витрины" }).click();
    await page.getByRole("option", { name: "Популярные", exact: true }).click();
    await expect(page.locator(".bike-card")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Поиск ColaBike", exact: true })
      .click();
    await page
      .getByRole("combobox", {
        name: "Найти велосипед, компонент или покатушку",
      })
      .fill(name);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await expect(
      page
        .getByRole("region", { name: "Велосипеды", exact: true })
        .locator('a[href^="/b/"]'),
    ).toHaveCount(5);
    await page.goto("/?q=" + encodeURIComponent(name));
    // Simulate a future larger catalogue in the disposable database only.
    // Production taxonomy and its database constraint remain unchanged.
    const expanded = structuredClone(originalCatalog);
    for (let i = 0; i < 20; i++)
      expanded.categories["future-" + i] = "Дополнительная категория " + i;
    await db.query("UPDATE site_catalog SET value=$1 WHERE id=1", [
      JSON.stringify(expanded),
    ]);
    await page.reload();
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    await expect(panel.getByRole("checkbox")).toHaveCount(23);
    await panel.getByRole("checkbox").last().check();
    await noOverflow();
    await screenshot("long-filter-catalog");
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole("button", { name: /^Фильтры/ })).toBeFocused();
    await db.query("UPDATE site_catalog SET value=$1 WHERE id=1", [
      JSON.stringify(originalCatalog),
    ]);
    for (const columns of [3, 4, 5]) {
      await settings({
        desktopColumns: columns,
        roadImageId: asset,
        mtbImageId: asset,
        gravelImageId: asset,
      });
      await page.reload();
      await expect(page.locator(".bike-card")).toHaveCount(5);
      const count = await page
        .locator(".bike-grid")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      // At 1440 px five columns would make cards narrower than 280 px.
      expect(count).toBe(isMobile ? 1 : Math.min(columns, 4));
      await noOverflow();
      await screenshot("grid-" + columns);
    }
    {
      await settings({
        appearance: { ...original.appearance, theme: "dark" },
        desktopColumns: 4,
        roadImageId: asset,
        mtbImageId: asset,
        gravelImageId: asset,
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator(".site-root")).not.toHaveAttribute(
        "data-background-mode",
      );
      await expect(page.locator(".bike-card")).toHaveCount(5);
      await noOverflow();
      await screenshot("dark");
    }
    await page.goto("/u/" + user.username);
    await expect(page.locator(".bike-card")).toHaveCount(5);
    await noOverflow();
    await screenshot("profile");
    await page.goto("/account");
    await expect(page.locator(".recent-bikes .bike-card")).toHaveCount(3);
    await noOverflow();
    await screenshot("account");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".bike-card")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");
  } finally {
    test.setTimeout(info.timeout + 15000);
    await db.query("UPDATE site_catalog SET value=$1 WHERE id=1", [
      JSON.stringify(originalCatalog),
    ]);
    await settings({});
    for (const id of bikes)
      await page.request.delete("/api/bikes/" + id, { headers: { origin } });
    if (asset)
      await page.request.delete("/api/admin/assets/" + asset, {
        headers: { origin },
      });
    await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
