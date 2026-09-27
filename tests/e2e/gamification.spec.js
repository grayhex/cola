import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { test, expect, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(request, name) {
  const r = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: name + "@example.test",
      password: "gamification-browser-123",
    },
  });
  expect(r.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function create(request, name, weight) {
  const input = {
    name,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight,
    is_public: true,
  };
  const r = await request.post("/api/bikes", {
    headers: { origin },
    data: input,
  });
  expect(r.status()).toBe(201);
  const id = (await r.json()).id;
  // Real PNG meets the bike-photo minimum and is decoded by safe photo upload.
  const upload = await request.post("/api/bikes/" + id + "/photos", {
    headers: { origin, "Content-Type": "image/png" },
    data: await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#e7482f" },
    })
      .png()
      .toBuffer(),
  });
  expect(upload.status()).toBe(201);
  return {
    input,
    ...(await (await request.get("/api/bikes/" + id)).json()).bike,
  };
}
test("Hall of Fame changes its current record holder, with profile awards and mobile reactions", async ({
  page,
  browser,
  isMobile,
}) => {
  const suffix = randomUUID().slice(0, 8),
    a = await register(page.request, "record-a-" + suffix),
    first = await create(page.request, "Feather " + suffix, 3.2);
  const context = await browser.newContext({
    ...(isMobile ? devices["iPhone 13"] : {}),
    baseURL: origin,
  });
  try {
    const visitor = await context.newPage();
    await register(visitor.request, "record-b-" + suffix);
    await page.goto("/records");
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      first.name,
    );
    const second = await create(visitor.request, "Lighter " + suffix, 3.1);
    await page.reload();
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      second.name,
    );
    await expect(
      page.locator('[data-record="lightest_road"]'),
    ).not.toContainText(first.name);
    await visitor.request.patch("/api/bikes/" + second.id, {
      headers: { origin },
      data: { ...second.input, is_public: false },
    });
    await page.reload();
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      first.name,
    );
    await visitor.goto("/b/" + first.share_id);
    await visitor
      .getByRole("button", { name: "Безумие 0", exact: true })
      .click();
    await expect(
      visitor.getByRole("button", { name: "Безумие 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // Records held now and awards kept for good are separate blocks (#106).
    // Exercise both real decoded artwork and an unavailable image, not only icon-only fixtures.
    const artId = "11111111-1111-4111-8111-111111111111";
    const missingId = "22222222-2222-4222-8222-222222222222";
    const artBytes = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#22aa88" },
    })
      .webp()
      .toBuffer();
    await page.route("**/api/assets/" + artId, (route) =>
      route.fulfill({ contentType: "image/webp", body: artBytes }),
    );
    await page.route("**/api/assets/" + missingId, (route) =>
      route.fulfill({ status: 404 }),
    );
    await page.route("**/api/game/profiles/**", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.records[0].imageId = artId;
      json.awards[0].imageId = missingId;
      await route.fulfill({ response, json });
    });
    await page.goto("/u/" + a.username);
    const held = page.locator(".badge-shelf", {
      has: page.getByRole("heading", { name: "Рекорды", exact: true }),
    });
    const kept = page.locator(".badge-shelf", {
      has: page.getByRole("heading", { name: "Награды", exact: true }),
    });
    await expect(held).toContainText("Легче ветра");
    await expect(held).not.toContainText("Первый выход");
    await expect(kept).toContainText("Первый выход");
    await expect(kept).not.toContainText("Легче ветра");
    await expect
      .poll(() =>
        held
          .locator(".game-art img")
          .first()
          .evaluate((e) => e.naturalWidth),
      )
      .toBe(100);
    await expect(
      kept.locator(".game-art").first().locator("svg"),
    ).toBeVisible();
    await expect(kept.locator(".game-art").first().locator("img")).toHaveCount(
      0,
    );
    const shelf = await page.locator(".profile-awards").boundingBox();
    const tabs = await page
      .locator(".profile-collection .ui-tabs")
      .boundingBox();
    expect(tabs.y - (shelf.y + shelf.height)).toBeGreaterThanOrEqual(20);
    const art = await kept.locator(".game-art").first().boundingBox();
    expect(art.width).toBe(56);
    expect(art.height).toBe(56);
    const caption = await kept
      .locator(".award > span:not(.game-art)")
      .first()
      .boundingBox();
    expect(caption.y).toBeGreaterThanOrEqual(art.y + art.height);
    const editButton = await page
      .getByRole("link", { name: "Изменить профиль", exact: true })
      .boundingBox();
    const shareButton = await page
      .locator(".profile-hero .share-button")
      .boundingBox();
    expect(shareButton.height).toBe(editButton.height);
    expect(
      await kept
        .locator(".award")
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeLessThanOrEqual(12);

    await page.goto("/account?tab=achievements");
    await expect(page.locator(".game-shelves")).toContainText(
      "Следующая вершина",
    );
    await expect(page.locator(".game-shelves")).toContainText("Сотка");
    await visitor.goto("/records");
    await expect(visitor.locator('[data-record="wild"]')).toContainText(
      first.name,
    );
    // The second tab lists every award with how many people have it.
    await visitor.getByRole("button", { name: "Награды", exact: true }).click();
    await expect(visitor).toHaveURL(/\/records\?tab=awards$/);
    await expect(visitor.locator("[data-record]")).toHaveCount(0);
    const debut = visitor.locator('[data-award="first_public"]');
    await expect(debut).toContainText("Первый выход");
    await expect(debut).toContainText(/Получили? \d+ человека?/);
    await visitor.reload();
    await expect(
      visitor.getByRole("button", { name: "Награды", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(visitor.locator('[data-award="racer"]')).toBeVisible();
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    for (const request of [page.request, context.request]) {
      const result = await request.get("/api/bikes");
      for (const b of (await result.json()).bikes || [])
        await request.delete("/api/bikes/" + b.id, { headers: { origin } });
    }
    await context.close();
  }
});
