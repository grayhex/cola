import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("three-column bike, raster map, six-ride accordion, preferences and grouped admin", async ({
  page,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let original,
    tileRequests = 0;
  const tile = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#d4ddca" },
  })
    .png()
    .toBuffer();
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tileRequests++;
    return route.fulfill({ contentType: "image/png", body: tile });
  });
  const nonce = randomUUID().slice(0, 8);
  const putSettings = async (value) => {
    const latest = await (await page.request.get("/api/admin/overview")).json();
    expect(
      (
        await page.request.put("/api/admin/settings", {
          headers: { origin },
          data: { value, version: latest.settingsVersion },
        })
      ).status(),
    ).toBe(200);
  };
  try {
    expect(
      (
        await page.request.post("/api/auth/register", {
          headers: { origin },
          data: {
      ...testConsents,
            name: "Layout " + nonce,
            email: nonce + "@layout.test",
            password: "layout-test-secret-123",
          },
        })
      ).status(),
    ).toBe(201);
    const user = (await (await page.request.get("/api/me")).json()).user;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    original = (await (await page.request.get("/api/admin/overview")).json())
      .settings;
    await putSettings({
      ...original,
      map: {
        enabled: true,
        provider: "osm",
        tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        styleUrl: "",
        publicKey: "",
        attribution: "© OpenStreetMap contributors",
      },
    });
    const bike = await (
      await page.request.post("/api/bikes", {
        headers: { origin },
        data: {
          name: "Layout bike",
          brand: "Giant",
          model: "Tourer",
          year: 2024,
          category: "road",
          description: "",
          color: "",
          size: "",
          weight: null,
          is_public: true,
        },
      })
    ).json();
    const share = (
      await db.query("SELECT share_id FROM bikes WHERE id=$1", [bike.id])
    ).rows[0].share_id;
    // Six independent, synthetic public rides: no original tracks or external services.
    for (let i = 0; i < 6; i++)
      await db.query(
        "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,public_geometry,is_public,source_hash,point_count,public_point_count,privacy_radius_m) VALUES($1,$1,$2,$3,$4,2400,$5,true,$6,3,3,500)",
        [
          randomUUID(),
          user.id,
          bike.id,
          "Маршрут " + i,
          JSON.stringify([
            [
              [37.5, 55.7],
              [37.51, 55.71],
              [37.52, 55.7],
            ],
          ]),
          "fixture-" + nonce + "-" + i,
        ],
      );
    await page.goto("/b/" + share);
    await expect(page.locator(".bike-rides .ride-list-item")).toHaveCount(6);
    await expect(page.locator(".bike-rides .ride-list-item[open]")).toHaveCount(
      0,
    );
    expect(tileRequests).toBe(0);
    await page.locator(".bike-rides summary").first().click();
    await expect.poll(() => tileRequests).toBeGreaterThan(0);
    await expect(
      page.locator(".bike-rides .ride-map-attribution").first(),
    ).toContainText("OpenStreetMap");
    await expect(
      page
        .locator(".bike-rides .ride-list-item[open] .ride-route image")
        .first(),
    ).toBeVisible();
    const boxes = await Promise.all(
      [".showcase", ".specifications", ".bike-rides"].map((c) =>
        page.locator(".bike-detail > " + c).boundingBox(),
      ),
    );
    if (!isMobile) {
      expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x);
      expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x);
      expect(Math.abs(boxes[0].y - boxes[2].y)).toBeLessThan(3);
    } else {
      expect(boxes[0].y).toBeLessThan(boxes[1].y);
      expect(boxes[1].y).toBeLessThan(boxes[2].y);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("bike-three-columns.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/account?tab=appearance");
    await page
      .getByRole("combobox", { name: "Покатушки на странице велосипеда", exact: true })
      .selectOption("cards");
    await page
      .getByRole("combobox", { name: "Карта покатушки", exact: true })
      .selectOption("route");
    await page
      .getByRole("button", { name: "Сохранить оформление", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Оформление сохранено");
    await page.goto("/b/" + share);
    await expect(
      page.locator(".bike-rides .ride-grid > .ride-card"),
    ).toHaveCount(6);
    await expect(page.locator(".bike-rides .ride-route image")).toHaveCount(0);
    await page.goto("/admin");
    const adminGroups = page.getByRole("tablist", { name: "Группы админки" });
    await expect(adminGroups).toHaveAttribute("aria-orientation", "vertical");
    await expect(adminGroups.getByRole("tab")).toHaveCount(5);
    await page.getByRole("button", { name: "Карта", exact: true }).click();
    await page.getByLabel("Подключать подложку").uncheck();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Настройки опубликованы на сайте",
    );
    const system = adminGroups.getByRole("tab", { name: "Система", exact: true });
    const design = adminGroups.getByRole("tab", { name: "Дизайн", exact: true });
    const catalog = adminGroups.getByRole("tab", { name: "Каталог", exact: true });
    const panel = page.locator("#admin-group-panel");
    await system.focus();
    // The sidebar is vertical and uses manual activation: arrows move focus,
    // while Enter/Space open a group. Moving focus must not discard its content.
    await page.keyboard.press("ArrowDown");
    await expect(design).toBeFocused();
    await expect(system).toHaveAttribute("aria-selected", "true");
    await expect(design).toHaveAttribute("aria-selected", "false");
    await expect(panel).toHaveAttribute("aria-labelledby", "admin-group-system");
    await expect(
      panel.getByRole("heading", { name: "Карта", exact: true, level: 1 }),
    ).toBeVisible();
    for (const [key, target] of [
      ["ArrowUp", system],
      ["End", catalog],
      ["ArrowDown", system],
      ["ArrowUp", catalog],
      ["Home", system],
      ["ArrowDown", design],
    ]) {
      await page.keyboard.press(key);
      await expect(target).toBeFocused();
      await expect(system).toHaveAttribute("aria-selected", "true");
    }
    await page.keyboard.press("Enter");
    await expect(design).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", "admin-group-design");
    await expect(
      panel.getByRole("heading", { name: "Внешний вид", exact: true, level: 1 }),
    ).toBeVisible();
    await page.keyboard.press("End");
    await expect(catalog).toBeFocused();
    await expect(design).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Space");
    await expect(catalog).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", "admin-group-catalog");
    await expect(
      panel.getByRole("heading", { name: "Справочники", exact: true, level: 1 }),
    ).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await expect(design).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(design).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("navigation", { name: "Разделы админки" })
      .getByRole("button", { name: "О проекте", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "О проекте", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "История AI-разработки", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("admin-groups.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/about");
    await expect(page.locator("#history,.about-actions")).toHaveCount(0);
    expect(
      (await page.locator(".global-header").boundingBox()).height,
    ).toBeLessThanOrEqual(80);
  } finally {
    test.setTimeout(info.timeout + 15000);
    if (original) await putSettings(original);
    await db.end();
  }
});
