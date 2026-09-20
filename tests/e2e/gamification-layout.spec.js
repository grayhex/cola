import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { recordDefinitions, defaultGamification, achievements } from "../../lib/gamification-definitions.js";
const imageId = "00000000-0000-4000-8000-000000000001";
const brokenId = "00000000-0000-4000-8000-000000000002";
const records = recordDefinitions.map((r, i) => ({
  ...r, eligible: i, imageId: i === 0 ? brokenId : imageId,
  holder: i % 3 === 0 ? null : {
    id: "fixture-bike", shareId: "fixture-share", name: "Canyon Grail CF SLX 8 AXS 2026 · очень длинное название сборки",
    category: "gravel", cover: imageId, value: r.metric === "price" ? 1234567 : 8.2,
    author: { username: "long_username_for_layout_test", name: "Владелец" },
  },
}));

test("all records and oversized illustrations fit a compact desktop overview, mobile has no overflow", async ({ page, isMobile }, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1366, height: 900 });
  const large = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 36, g: 43, b: 47, alpha: .8 } } }).png().toBuffer();
  await page.route("**/api/assets/" + imageId, (route) => route.fulfill({ contentType: "image/png", body: large }));
  await page.route("**/api/assets/" + brokenId, (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.route("**/api/photos/" + imageId, (route) => route.fulfill({ contentType: "image/png", body: large }));
  await page.route("**/api/game/records", (route) => route.fulfill({ json: { records, settings: defaultGamification, asOf: "2026-09-20T12:00:00Z" } }));
  await page.goto("/records");
  await expect(page.locator(".record-card")).toHaveCount(12);
  await expect(page.locator(".record-card").first().locator(`.game-art img[src$="${brokenId}"]`)).toHaveCount(0);
  await expect(page.locator(".hall-rules")).not.toHaveAttribute("open", "");
  const boxes = await page.locator(".record-card .game-art").evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const child = el.firstElementChild.getBoundingClientRect();
    return { width: r.width, height: r.height, childWidth: child.width, childHeight: child.height };
  }));
  for (const b of boxes) {
    expect(b.width).toBeLessThanOrEqual(40);
    expect(b.height).toBeLessThanOrEqual(40);
    expect(b.childWidth).toBeLessThanOrEqual(40);
    expect(b.childHeight).toBeLessThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (!isMobile) {
    const grid = await page.locator(".record-grid").boundingBox();
    expect(grid.y + grid.height).toBeLessThan(900);
    expect(await page.locator(".record-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(4);
  }
  await page.screenshot({ path: info.outputPath("compact-records.png"), fullPage: true });
});

test("achievement admin exposes every image slot and retains uploaded draft through moderation paging", async ({ page }) => {
  // Stub only data requests: the page and controls are the real application UI.
  const user = { id: "fixture-admin", role: "admin", name: "Admin", preferences: {} };
  let saved = { ...defaultGamification, recordImages: {}, achievementImages: {} };
  await page.route("**/api/admin/overview", async (route) => {
    // The guest overview is protected. Use public settings as a safe fixture.
    const site = await (await page.request.get("/api/site")).json();
    await route.fulfill({ json: { ...site, user, stats: {}, participation: [] } });
  });
  await page.route("**/api/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/game/admin/settings", async (route) => {
    if (route.request().method() === "PUT") saved = route.request().postDataJSON();
    await route.fulfill({ json: saved });
  });
  await page.route("**/api/admin/assets*", (route) => route.fulfill({ json: route.request().method() === "POST" ? { id: imageId, name: "art.png" } : { assets: [{ id: imageId, name: "art.png" }] } }));
  await page.route("**/api/game/admin/bikes*", (route) => route.fulfill({ json: { bikes: route.request().url().endsWith("page=1") ? Array.from({ length: 25 }, (_, i) => ({ id: "bike-" + i, share_id: "bike-" + i, name: "Bike " + i, leaderboard_excluded: false })) : [] } }));
  await page.route("**/api/assets/*", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#333"/></svg>' }));
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Механики" }).click();
  await page.getByRole("button", { name: "Награды и рекорды", exact: true }).click();
  await expect(page.locator("[data-record-setting]")).toHaveCount(recordDefinitions.length);
  await expect(page.locator("[data-achievement-setting]")).toHaveCount(achievements.length);
  const slot = page.locator('[data-record-setting="expensive"]');
  await slot.locator("input[type=file]").setInputFiles({ name: "art.png", mimeType: "image/png", buffer: Buffer.from("upload fixture") });
  await expect(slot.locator("select")).toHaveValue(imageId);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(slot.locator("select")).toHaveValue(imageId);
  await page.getByRole("button", { name: "Сохранить правила и иллюстрации", exact: true }).click();
  await expect.poll(() => saved.recordImages.expensive).toBe(imageId);
  await slot.getByRole("button", { name: "Сбросить" }).click();
  await page.getByRole("button", { name: "Сохранить правила и иллюстрации", exact: true }).click();
  await expect.poll(() => saved.recordImages.expensive).toBe(null);
});
