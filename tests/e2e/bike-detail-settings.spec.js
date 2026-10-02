import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { defaultBlocks } from "../../lib/garage-layout.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #291: the saved `detailBlocks` switch parts of one fixed composition
// (docs/modules/site-customization.md); the overview with the passport is
// always on, `summaryFields` decide what it may say.
test("bike detail settings, passport, anchors, guest rights and owner without photos", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  expect(
    (
      await registerVerified(page.request, {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Detail settings",
          email: randomUUID() + "@detail.test",
          password: "detail-settings-secret",
        },
      })
    ).status(),
  ).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  const original = await (await page.request.get("/api/admin/overview")).json();
  const put = async (patch) => {
    const current = await (
      await page.request.get("/api/admin/overview")
    ).json();
    const r = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: {
        value: { ...current.settings, ...patch },
        version: current.settingsVersion,
      },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  const input = {
    name: "Велосипед без фотографии",
    brand: "Cube",
    model: "Travel",
    year: 2021,
    category: "urban_touring",
    description: "Мой полный рассказ. ".repeat(60),
    color: "",
    size: "",
    weight: null,
    is_public: true,
    price: 998877,
    show_bike_price: false,
  };
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: input,
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
  const path = "/b/" + bike.share_id;
  const guest = await browser.newContext(info.project.use),
    reader = await guest.newPage();
  try {
    await put({
      detailBlocks: defaultBlocks.map((b) => ({
        ...b,
        enabled: true,
        open: true,
      })),
      summaryFields: {
        description: true,
        metadata: true,
        price: true,
        manufacturer: true,
      },
    });
    // An empty build is for the owner to fill; a visitor has no such section.
    await reader.goto(path);
    await expect(reader.locator("#specifications")).toHaveCount(0);
    await expect(
      reader
        .getByRole("navigation", { name: "Разделы велосипеда" })
        .getByRole("link", { name: "Комплектация", exact: true }),
    ).toHaveCount(0);
    await page.goto(path);
    await expect(page.locator("#specifications")).toBeVisible();
    expect(
      (
        await page.request.post(`/api/bikes/${id}/components`, {
          headers: { origin },
          data: {
            section: "build",
            category: "Рама",
            name: "Cube Aluminium",
            notes: "",
            price: null,
          },
        })
      ).status(),
    ).toBe(201);
    for (const tab of [page, reader]) {
      await tab.goto(path);
      await expect(tab.locator(".bike-about p")).toHaveText(input.description);
      await expect(tab.locator(".bike-passport")).toContainText(
        "Модельный год",
      );
      await expect(tab.locator(".bike-passport")).toContainText("Текущий");
      await expect(tab.locator(".bike-passport")).not.toContainText("998");
      await expect(
        tab
          .locator(".bike-passport dt")
          .filter({ hasText: /^(Вес|Размер рамы|Цвет)$/ }),
      ).toHaveCount(0);
      await expect(tab.locator(".bike-excerpt")).not.toHaveText(
        input.description,
      );
      const sections = tab.getByRole("navigation", {
        name: "Разделы велосипеда",
      });
      // The menu marks where the reader is: the top of the page is the overview.
      await expect(
        sections.getByRole("link", { name: "Обзор", exact: true }),
      ).toHaveAttribute("aria-current", "location");
      await sections
        .getByRole("link", { name: "Комплектация", exact: true })
        .click();
      await expect(tab).toHaveURL(/#specifications$/);
      expect(
        await tab
          .locator("#specifications")
          .evaluate((el) => el.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(60);
      for (const theme of ["light", "dark"]) {
        await tab.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        const results = await new AxeBuilder({ page: tab })
          .include(".bike-detail")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      }
      await tab.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      await tab.evaluate(
        () => (document.documentElement.dataset.theme = "system"),
      );
      expect(
        await tab.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await expect(
      reader.getByRole("group", { name: "Управление велосипедом" }),
    ).toHaveCount(0);
    expect(
      (
        await reader.request.put("/api/bikes/" + id, {
          headers: { origin },
          data: { ...input, name: "Unauthorized" },
        })
      ).status(),
    ).toBe(401);
    await expect(
      page.getByRole("button", { name: "Добавить фото", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Приватность", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Доступ к велосипеду" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Приватность", exact: true }),
    ).toBeFocused();
    // The settings own what the overview may say: nothing public, nothing
    // drawn, and the menu does not point at it.
    await put({
      summaryFields: {
        description: false,
        metadata: false,
        price: false,
        manufacturer: false,
      },
    });
    await page.goto(path);
    await expect(page.locator(".bike-about")).toHaveCount(0);
    await expect(page.locator(".bike-passport")).toHaveCount(0);
    await expect(page.locator(".bike-excerpt")).toHaveCount(0);
    const menu = page.getByRole("navigation", { name: "Разделы велосипеда" });
    await expect(
      menu.getByRole("link", { name: "Обзор", exact: true }),
    ).toHaveCount(0);
    // Blocks saved by an older default (summary off, everything folded) do
    // not hide the overview; every block that is off hides its own part.
    await put({
      detailBlocks: defaultBlocks.map((b) => ({
        ...b,
        enabled: false,
        open: false,
      })),
      summaryFields: {
        description: true,
        metadata: true,
        price: true,
        manufacturer: true,
      },
    });
    await page.goto(path);
    await expect(page.locator(".bike-about")).toBeVisible();
    await expect(page.locator(".bike-passport")).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Обзор", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".photo-stage")).toHaveCount(0);
    await expect(page.locator(".gallery")).toHaveCount(0);
    await expect(page.locator(".bike-metrics")).toHaveCount(0);
    await expect(page.locator(".bike-quote")).toHaveCount(0);
    await expect(page.locator("#specifications")).toHaveCount(0);
    await expect(
      menu.getByRole("link", { name: "Комплектация", exact: true }),
    ).toHaveCount(0);
    // Owner tools do not depend on the picture or any other block.
    for (const name of ["Редактировать", "Добавить фото", "Приватность", "Ещё"])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await page.goto("/account?tab=bikes&bike=" + id);
    await expect(page.locator(".bike-detail")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Приватность", exact: true }),
    ).toBeVisible();
    // An administrator viewing another owner's bike still has no owner controls.
    expect(
      (
        await registerVerified(reader.request, {
          headers: { origin },
          data: {
            ...testConsents,
            name: "Other owner",
            email: randomUUID() + "@detail.test",
            password: "other-owner-secret",
          },
        })
      ).status(),
    ).toBe(201);
    const otherResponse = await reader.request.post("/api/bikes", {
      headers: { origin },
      data: { ...input, name: "Чужой велосипед" },
    });
    const other = await otherResponse.json();
    const otherBike = (
      await (await reader.request.get("/api/bikes/" + other.id)).json()
    ).bike;
    await page.goto("/b/" + otherBike.share_id);
    await expect(
      page.getByRole("group", { name: "Управление велосипедом" }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.put("/api/bikes/" + other.id, {
          headers: { origin },
          data: input,
        })
      ).status(),
    ).toBe(404);
  } finally {
    await put(original.settings);
    await guest.close();
    await db.end();
  }
});
