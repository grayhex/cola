import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "../fixtures/legal.js";
import { defaultGamification } from "../../lib/gamification-definitions.js";
import { metricByKey } from "../../lib/game-metrics.js";
const imageId = "00000000-0000-4000-8000-000000000001";
const brokenId = "00000000-0000-4000-8000-000000000002";
const author = { id: "fixture-owner", username: "long_username_for_layout_test", name: "Владелец" };
const bike = { id: "fixture-bike", shareId: "fixture-share", name: "Canyon Grail CF SLX 8 AXS 2026 · очень длинное название сборки" };
// Records as /api/game/records returns them (#106): held by a bike, a ride or a rider.
const vacant = new Set(["expensive", "lightest_gravel", "complete", "marathon", "wild"]);
const records = [
  ["expensive", "price", "max"], ["budget", "price", "min"],
  ["lightest_mtb", "weight", "min"], ["lightest_gravel", "weight", "min"], ["lightest_road", "weight", "min"], ["heavy", "weight", "max"],
  ["veteran", "year", "min"], ["upgrade", "upgrade", "max"], ["complete", "completeness", "max"],
  ["marathon", "ride_distance", "max"], ["climber", "ride_elevation", "max"], ["turtle", "ride_avg_speed", "min"], ["mileage_30d", "distance_30d", "max"],
  ["popular", "likes", "max"], ["wild", "wild", "max"], ["clean", "clean", "max"], ["dream", "dream", "max"], ["community", "community", "max"],
].map(([key, metric, direction], i) => {
  const { subject, group } = metricByKey[metric];
  const holder = vacant.has(key) ? null
    : subject === "ride" ? { kind: "ride", id: "fixture-ride", shareId: "fixture-ride", name: "Длинная покатушка вдоль реки до самого заката", bike, author, value: 123.4 }
    : subject === "user" ? { kind: "profile", id: author.id, name: author.name, author, value: 456 }
    : { kind: "bike", ...bike, cover: imageId, category: "gravel", author, value: metric === "price" ? 1234567 : metric === "year" ? 1998 : 8.2 };
  return { key, name: "Рекорд " + key, description: "Описание рекорда " + key, imageId: i === 0 ? brokenId : imageId, group, metric, subject, direction, category: null, eligible: i, holder };
});
const awards = [
  ["first_public", "public_bikes", 12], ["full_build", "build_parts", 0], ["century", "ride_distance", 3], ["racer", "ride_max_speed", 1], ["chronicler", "journal_entries", 2],
].map(([key, metric, earners]) => ({ key, name: "Награда " + key, description: "Описание награды " + key, imageId, group: metricByKey[metric].group, metric, subject: metricByKey[metric].subject, comparison: "gte", threshold: 1, earners }));
async function mockRecords(page, hall = { records, awards }) {
  const large = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 36, g: 43, b: 47, alpha: .8 } } }).png().toBuffer();
  await page.route("**/api/assets/" + imageId, (route) => route.fulfill({ contentType: "image/png", body: large }));
  await page.route("**/api/assets/" + brokenId, (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.route("**/api/game/records", (route) => route.fulfill({ json: { ...hall, settings: defaultGamification, asOf: "2026-09-20T12:00:00Z" } }));
}

test("grouped records have large bounded artwork, linked holders and compact metrics without bike photos", async ({ page, isMobile }, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRecords(page);
  await page.goto("/records");
  await expect(page.locator(".record-card")).toHaveCount(18);
  await expect(page.locator("[data-record-group]")).toHaveCount(6);
  for (const [group, count] of [["price", 2], ["weight", 4], ["bike", 1], ["build", 2], ["rides", 4], ["community", 5]])
    await expect(page.locator(`[data-record-group="${group}"] .record-card`)).toHaveCount(count);
  await expect(page.locator('.record-card img[src^="/api/photos/"]')).toHaveCount(0);
  await expect(page.locator(".record-card").first().locator(`.game-art img[src$="${brokenId}"]`)).toHaveCount(0);
  await expect(page.locator(".hall-rules")).not.toHaveAttribute("open", "");
  // A ride links to the ride and its bike; a rider links to the profile.
  const ride = page.locator('[data-record="climber"]');
  await expect(ride.locator(".record-bike-name")).toHaveAttribute("href", /^\/r\//);
  await expect(ride.locator(".record-meta a").first()).toHaveAttribute("href", /^\/b\//);
  await expect(ride.locator(".record-value")).toHaveText("123 м");
  const rider = page.locator('[data-record="mileage_30d"]');
  await expect(rider.locator(".record-bike-name")).toHaveText("Владелец");
  await expect(rider.locator(".record-bike-name")).toHaveAttribute("href", /long_username_for_layout_test/);
  await expect(rider.locator(".record-value")).toHaveText("456 км");
  await expect(page.locator('[data-record="veteran"] .record-value')).toHaveText("1998");
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
  // The awards tab: the same art and groups, with how many people have each.
  await page.getByRole("button", { name: "Награды", exact: true }).click();
  await expect(page.locator(".award-card")).toHaveCount(5);
  await expect(page.locator(".record-card:not(.award-card)")).toHaveCount(0);
  await expect(page.locator('[data-award="first_public"] .record-meta')).toHaveText("Получили 12 человек");
  await expect(page.locator('[data-award="century"] .record-meta')).toHaveText("Получили 3 человека");
  await expect(page.locator('[data-award="racer"] .record-meta')).toHaveText("Получил 1 человек");
  await expect(page.locator('[data-award="full_build"] .record-meta')).toHaveText("Пока никто не получил");
  for (const art of await page.locator(".award-card .game-art").all()) {
    const box = await art.boundingBox();
    expect(box.width).toBe(160);
    expect(box.height).toBe(160);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("awards.png"), fullPage: true });
});

test("record illustration reacts to hover and keyboard focus, but reduced motion stops transforms", async ({ page, isMobile }) => {
  test.skip(isMobile, "Hover is only enabled for a fine pointer");
  await page.setViewportSize({width:1366,height:900});
  await page.emulateMedia({reducedMotion:"no-preference"});
  await mockRecords(page);
  await page.goto("/records");
  const card = page.locator('[data-record="budget"]');
  const art = card.locator(".record-illustration");
  await expect(art).toBeVisible();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).toBe("none");
  await card.hover();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  await page.mouse.move(0,0);
  // Finish the hover transition before testing keyboard focus independently.
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).toBe("none");
  await card.locator(".record-bike-name").focus();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).not.toBe("none");
  await page.emulateMedia({reducedMotion:"reduce"});
  await card.hover();
  await expect.poll(() => art.evaluate(el => getComputedStyle(el).transform)).toBe("none");
});

// The admin builds awards and records from catalog metrics (#106).
const rule = (key, kind, metric, extra = {}) => ({
  key, kind, subject: metricByKey[metric].subject, metric, comparison: "gte",
  threshold: kind === "award" ? 1 : null, direction: kind === "record" ? "max" : null,
  category: null, minDistanceKm: null, keywords: [], name: "Правило " + key, description: "",
  imageId: null, enabled: true, builtin: true, position: 10, awarded: 0, ...extra,
});
const fixtureRules = [
  rule("first_public", "award", "public_bikes", { name: "Первый выход", awarded: 12 }),
  rule("century", "award", "ride_distance", { name: "Сотка", threshold: 100 }),
  rule("expensive", "record", "price", { name: "Без компромиссов" }),
  rule("turtle", "record", "ride_avg_speed", { name: "Черепаха", direction: "min", minDistanceKm: 10 }),
];
test("the rule editor builds «Гонщик» and «Черепаха», keeps art and words through paging, save and reload", async ({ page }, info) => {
  // The admin page trusts the reader from the server layout (#74), so the
  // administrator is a real account; the admin API itself stays mocked.
  const email = `layout-admin-${randomUUID()}@example.test`;
  expect((await page.request.post("/api/auth/register", {
    headers: { origin: process.env.TEST_ORIGIN || "http://localhost:3100" },
    data: { ...testConsents, name: "Admin", email, password: "layout-admin-secret-123" },
  })).status()).toBe(201);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE users SET role='admin' WHERE email=$1", [email]);
  } finally {
    await db.end();
  }
  const user = { id: "fixture-admin", role: "admin", name: "Admin", preferences: {} };
  let saved = fixtureRules,
    puts = 0,
    recalculations = 0;
  await page.route("**/api/admin/overview", async (route) => {
    const site = await (await page.request.get("/api/site")).json();
    await route.fulfill({ json: { ...site, user, stats: {}, participation: [] } });
  });
  await page.route("**/api/game/admin/rules", async (route) => {
    if (route.request().method() === "PUT") {
      puts++;
      const old = new Map(saved.map((r) => [r.key, r]));
      saved = route.request().postDataJSON().rules.map((r) => ({
        builtin: false, position: 0, awarded: 0, ...old.get(r.key), ...r, subject: metricByKey[r.metric].subject,
      }));
    }
    await route.fulfill({ json: { rules: saved, settings: defaultGamification } });
  });
  await page.route("**/api/game/admin/recalculate", (route) => {
    recalculations++;
    return route.fulfill({ json: { awarded: 3 } });
  });
  await page.route("**/api/admin/assets*", (route) => route.fulfill({ json: route.request().method() === "POST" ? { id: imageId, name: "art.png" } : { assets: [{ id: imageId, name: "art.png" }] } }));
  // The shell loads nested usage metadata separately from the legacy list.
  await page.route("**/api/admin/assets/library", (route) => route.fulfill({ json: { assets: [{ id: imageId, name: "art.png", usage: [] }] } }));
  await page.route("**/api/game/admin/bikes*", (route) => route.fulfill({ json: { bikes: route.request().url().endsWith("page=1") ? Array.from({ length: 25 }, (_, i) => ({ id: "bike-" + i, share_id: "bike-" + i, name: "Bike " + i, leaderboard_excluded: false })) : [] } }));
  await page.route("**/api/assets/*", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#333"/></svg>' }));
  async function openRules() {
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Механики" }).click();
    await page.getByRole("button", { name: "Награды и рекорды", exact: true }).click();
    await expect(page.locator("[data-rule]")).toHaveCount(saved.length);
  }
  const save = page.getByRole("button", { name: "Сохранить награды и рекорды", exact: true });
  const recalculate = page.getByRole("button", { name: "Пересчитать награды", exact: true });
  await openRules();
  await expect(page.locator('[data-rules="award"] [data-rule]')).toHaveCount(2);
  await expect(page.locator('[data-rules="record"] [data-rule]')).toHaveCount(2);
  await expect(page.locator('[data-rule="turtle"] summary')).toContainText("Минимум: средняя скорость покатушки · от 10 км");
  await expect(save).toBeDisabled();
  // Words and an illustration of a built-in record.
  const expensive = page.locator('[data-rule="expensive"]');
  await expensive.locator("summary").click();
  const text = "Самый дорогой байк <b>без HTML</b>";
  await expensive.getByLabel("Короткое описание").fill(text);
  await expensive.locator("input[type=file]").setInputFiles({ name: "art.png", mimeType: "image/png", buffer: Buffer.from("upload fixture") });
  await expect(expensive.locator(".asset-picker select")).toHaveValue(imageId);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(expensive.locator(".asset-picker select")).toHaveValue(imageId);
  await expect(expensive.getByLabel("Короткое описание")).toHaveValue(text);
  await expect(recalculate).toBeDisabled();
  // «Гонщик»: an award from the maximum speed.
  await page.getByRole("button", { name: "Добавить награду", exact: true }).click();
  const racer = page.locator('[data-rules="award"] [data-rule]').last();
  await expect(racer).toHaveAttribute("open", "");
  await expect(racer.locator(".error")).toHaveText("Укажите название");
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "Исправьте" })).toHaveText("Исправьте: «Без названия»");
  expect(puts).toBe(0);
  await racer.getByLabel("Название").fill("Гонщик");
  await racer.getByLabel("Метрика").selectOption("ride_max_speed");
  await racer.getByLabel(/^Порог/).fill("50");
  await expect(racer.locator("summary")).toContainText("≥ 50 км/ч");
  // «Черепаха»: a record held by the slowest ride from 10 km.
  await page.getByRole("button", { name: "Добавить рекорд", exact: true }).click();
  const turtle = page.locator('[data-rules="record"] [data-rule]').last();
  await turtle.getByLabel("Название").fill("Черепаха");
  await turtle.getByLabel("Метрика").selectOption("ride_avg_speed");
  await turtle.getByLabel("Рекорд держит").selectOption("min");
  await turtle.getByLabel("Только покатушки от, км").fill("10");
  await expect(turtle.getByLabel("Тип велосипеда")).toBeVisible();
  // Open rules and the save bar fit a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('[data-rules="award"]').screenshot({ path: info.outputPath("rule-editor.png") });
  await save.click();
  await expect.poll(() => puts).toBe(1);
  const sent = saved.filter((r) => !fixtureRules.some((f) => f.key === r.key));
  expect(sent).toHaveLength(2);
  expect(sent[0]).toMatchObject({ kind: "award", metric: "ride_max_speed", comparison: "gte", threshold: 50, name: "Гонщик", enabled: true });
  expect(sent[1]).toMatchObject({ kind: "record", metric: "ride_avg_speed", direction: "min", minDistanceKm: 10, threshold: null, name: "Черепаха" });
  for (const r of sent) expect(r.key).toMatch(/^rule_[0-9a-f]{10}$/);
  expect(saved.find((r) => r.key === "expensive")).toMatchObject({ description: text, imageId });
  await expect(page.getByRole("status").filter({ hasText: "Награды и рекорды сохранены" })).toBeVisible();
  // Recalculation issues the new award for what people have already done.
  await expect(recalculate).toBeEnabled();
  await recalculate.click();
  await expect(page.getByRole("status").filter({ hasText: "Пересчитано. Выдано наград: 3" })).toBeVisible();
  expect(recalculations).toBe(1);
  await openRules();
  await expect(page.locator('[data-rule] summary', { hasText: "Гонщик" })).toBeVisible();
  await expensive.locator("summary").click();
  await expect(expensive.getByLabel("Короткое описание")).toHaveValue(text);
  await expect(expensive.locator(".asset-picker select")).toHaveValue(imageId);
  // Resetting the art keeps the words; a built-in rule has no delete button.
  const resetArtwork = expensive.getByRole("button", { name: "Сбросить: Иллюстрация «Без компромиссов»", exact: true });
  await resetArtwork.click();
  await expect(expensive.locator(".asset-picker select")).toHaveValue("");
  await expect(expensive.getByRole("button", { name: "Удалить" })).toHaveCount(0);
  await save.click();
  await expect.poll(() => saved.find((r) => r.key === "expensive").imageId).toBe(null);
  expect(saved.find((r) => r.key === "expensive").description).toBe(text);
  // The description is text on the page, never markup.
  await mockRecords(page, { records: records.map((r) => (r.key === "expensive" ? { ...r, description: text } : r)), awards });
  await page.goto("/records");
  await expect(page.locator('[data-record="expensive"] .record-description')).toHaveText(text);
  await expect(page.locator('[data-record="expensive"] .record-description b')).toHaveCount(0);
});
