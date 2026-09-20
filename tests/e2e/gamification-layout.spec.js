import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { recordDefinitions, defaultGamification, achievements } from "../../lib/gamification-definitions.js";
import { withGameDescriptions } from "../../lib/gamification-presentation.js";
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
async function mockRecords(page) {
  const large = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 36, g: 43, b: 47, alpha: .8 } } }).png().toBuffer();
  await page.route("**/api/assets/" + imageId, (route) => route.fulfill({ contentType: "image/png", body: large }));
  await page.route("**/api/assets/" + brokenId, (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.route("**/api/game/records", (route) => route.fulfill({ json: { records, settings: defaultGamification, asOf: "2026-09-20T12:00:00Z" } }));
}

test("grouped records have large bounded artwork, linked names and compact metrics without bike photos", async ({ page, isMobile }, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRecords(page);
  await page.goto("/records");
  await expect(page.locator(".record-card")).toHaveCount(12);
  await expect(page.locator("[data-record-group]")).toHaveCount(4);
  await expect(page.locator('[data-record-group="price"] .record-card')).toHaveCount(2);
  await expect(page.locator('[data-record-group="weight"] .record-card')).toHaveCount(3);
  await expect(page.locator('[data-record-group="build"] .record-card')).toHaveCount(2);
  await expect(page.locator('[data-record-group="community"] .record-card')).toHaveCount(5);
  await expect(page.locator('.record-card img[src^="/api/photos/"]')).toHaveCount(0);
  await expect(page.locator(".record-card").first().locator(`.game-art img[src$="${brokenId}"]`)).toHaveCount(0);
  await expect(page.locator(".hall-rules")).not.toHaveAttribute("open", "");
  for (const card of await page.locator(".record-card").all()) {
    await expect(card.locator(".record-description")).not.toBeEmpty();
    const art = await card.locator(".game-art").boundingBox();
    expect(art.width).toBe(160);
    expect(art.height).toBe(160);
  }
  const childBoxes = await page.locator(".record-card .game-art > *").evaluateAll(els => els.map(el => {
    const b = el.getBoundingClientRect(); return [b.width, b.height];
  }));
  for (const [width, height] of childBoxes) { expect(width).toBeLessThanOrEqual(160); expect(height).toBeLessThanOrEqual(160); }
  const hierarchy = await page.locator(".record-card:not(.vacant)").first().evaluate(el => ({
    name: parseFloat(getComputedStyle(el.querySelector(".record-bike-name")).fontSize),
    metric: parseFloat(getComputedStyle(el.querySelector(".record-value")).fontSize),
  }));
  expect(hierarchy.name).toBeGreaterThan(hierarchy.metric);
  for (const el of await page.locator(".record-empty").all()) {
    expect(await el.evaluate(node => getComputedStyle(node).whiteSpace)).toBe("nowrap");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (!isMobile) {
    expect(await page.locator(".record-grid").first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(3);
    expect((await page.locator(".record-card").first().boundingBox()).height).toBeGreaterThanOrEqual(248);
  }
  expect(await page.locator(".record-card").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.screenshot({ path: info.outputPath("grouped-records.png"), fullPage: true });
});

test("record illustration reacts to hover and keyboard focus, but reduced motion stops transforms", async ({ page, isMobile }) => {
  test.skip(isMobile, "Hover is only enabled for a fine pointer");
  await page.setViewportSize({width:1366,height:900});
  await page.emulateMedia({reducedMotion:"no-preference"});
  await mockRecords(page);
  await page.goto("/records");
  const card = page.locator('[data-record="budget"]');
  const art = card.locator(".record-illustration");
  await card.hover();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  await page.mouse.move(0,0);
  await card.locator(".record-bike-name").focus();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  await page.emulateMedia({reducedMotion:"reduce"});
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).toBe("none");
});

test("achievement admin preserves illustrations and edited descriptions through paging, save and reload", async ({ page }) => {
  const user = { id: "fixture-admin", role: "admin", name: "Admin", preferences: {} };
  let saved = { ...defaultGamification, recordImages: {}, achievementImages: {}, recordDescriptions: {}, achievementDescriptions: {} };
  await page.route("**/api/admin/overview", async (route) => {
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
  async function openSettings() {
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Механики" }).click();
    await page.getByRole("button", { name: "Награды и рекорды", exact: true }).click();
  }
  await openSettings();
  await expect(page.locator("[data-record-setting]")).toHaveCount(recordDefinitions.length);
  await expect(page.locator("[data-achievement-setting]")).toHaveCount(achievements.length);
  await expect(page.locator(".game-art-slot textarea")).toHaveCount(22);
  const slot = page.locator('[data-record-setting="expensive"]');
  const text = "Самый дорогой байк <b>без HTML</b>";
  await slot.locator("textarea").fill(text);
  await page.locator('[data-achievement-setting="first_public"] textarea').fill("Дебют на витрине.");
  await slot.locator("input[type=file]").setInputFiles({ name: "art.png", mimeType: "image/png", buffer: Buffer.from("upload fixture") });
  await expect(slot.locator("select")).toHaveValue(imageId);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(slot.locator("select")).toHaveValue(imageId);
  await expect(slot.locator("textarea")).toHaveValue(text);
  await page.getByRole("button", { name: "Сохранить правила и иллюстрации", exact: true }).click();
  await expect.poll(() => saved.recordDescriptions.expensive).toBe(text);
  expect(saved.achievementDescriptions.first_public).toBe("Дебют на витрине.");
  await openSettings();
  await expect(slot.locator("textarea")).toHaveValue(text);
  await slot.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить правила и иллюстрации", exact: true }).click();
  await expect.poll(() => saved.recordImages.expensive).toBe(null);
  expect(saved.recordDescriptions.expensive).toBe(text);
  await page.route("**/api/game/records", route => route.fulfill({json: withGameDescriptions({records,settings:saved,asOf:"2026-09-20T12:00:00Z"},saved)}));
  await page.goto("/records");
  await expect(page.locator('[data-record="expensive"] .record-description')).toHaveText(text);
  await expect(page.locator('[data-record="expensive"] .record-description b')).toHaveCount(0);
  await openSettings();
  await slot.getByRole("button", {name:"Стандартное описание «Без компромиссов»"}).click();
  await page.getByRole("button", { name: "Сохранить правила и иллюстрации", exact: true }).click();
  await expect.poll(() => saved.recordDescriptions.expensive).toBe("");
});
