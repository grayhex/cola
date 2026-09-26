import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #121: what a reader and the owner can do with a bike sits in one place:
// small outlined buttons with labels, counts in their own segment, nothing
// on top of the photo. Under the photo on a phone, one row on wide screens.
test("bike actions: labelled compact buttons in one place, none on the photo", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const nonce = randomUUID().slice(0, 8);
  const register = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Действия " + nonce,
      email: `actions-${nonce}@example.test`,
      password: "bike-actions-secret-123",
    },
  });
  expect(register.status()).toBe(201);
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Гравийник " + nonce,
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: 9.4,
      is_public: true,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#6f7768" },
  })
    .jpeg()
    .toBuffer();
  expect(
    (
      await page.request.post(`/api/bikes/${id}/photos`, {
        headers: { origin, "Content-Type": "image/jpeg" },
        data: photo,
      })
    ).status(),
  ).toBe(201);
  const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
  const path = "/b/" + bike.share_id;

  // Every control is small but still easy to hit, and says what it does.
  async function compact(bar) {
    const sizes = await bar
      .locator("button, a")
      .evaluateAll((els) =>
        els.map((el) => [el.getBoundingClientRect().height, el.textContent.trim()]),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const [height, text] of sizes) {
      expect(height, text).toBeGreaterThanOrEqual(24);
      expect(height, text).toBeLessThanOrEqual(40);
      expect(text.length, "a visible label").toBeGreaterThan(1);
    }
  }
  const tops = (bar) =>
    bar
      .locator("button, a")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));

  const readerContext = await browser.newContext(info.project.use);
  const reader = await readerContext.newPage();
  try {
    await reader.goto(path);
    const bar = reader.locator("[data-bike-actions]");
    const reactions = bar.getByRole("group", { name: "Реакции" });
    await expect(
      reactions.getByRole("button", { name: "Нравится: 0", exact: true }),
    ).toContainText("Нравится");
    await expect(
      reactions.getByRole("button", {
        name: "Подписаться на велосипед",
        exact: true,
      }),
    ).toContainText("Подписаться");
    await expect(
      reactions.getByRole("link", { name: /^Обсуждение/ }),
    ).toHaveAttribute("href", "#discussion");
    await expect(
      reactions.getByRole("button", { name: "Поделиться", exact: true }),
    ).toContainText("Поделиться");
    await expect(
      bar.getByRole("group", { name: "Управление велосипедом" }),
    ).toHaveCount(0);
    // The follow button lives here only, not in the journal as well.
    await expect(
      reader.getByRole("button", { name: "Подписаться на велосипед" }),
    ).toHaveCount(1);
    // The photo carries nothing but itself.
    await expect(reader.locator(".photo-stage button")).toHaveCount(1);
    await compact(bar);
    const stage = await reader.locator(".photo-stage").boundingBox(),
      box = await bar.boundingBox();
    if (isMobile) expect(box.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    else {
      expect(box.y + box.height).toBeLessThanOrEqual(stage.y + 1);
      expect(new Set(await tops(bar)).size, "one row").toBe(1);
    }
    expect(
      await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
  } finally {
    await readerContext.close();
  }

  await page.goto(path);
  const bar = page.locator("[data-bike-actions]");
  const tools = bar.getByRole("group", { name: "Управление велосипедом" });
  for (const name of ["Добавить фото", "Найти фото", "Доступ", "Редактировать", "Удалить"])
    await expect(tools.getByRole("button", { name, exact: true })).toBeVisible();
  const access = tools.getByRole("button", { name: "Доступ", exact: true });
  await expect(access).toHaveAccessibleDescription("Все");
  await expect(access).toContainText("Все");
  // Owners count their likes but do not follow their own bike.
  await expect(
    bar.getByRole("button", { name: "Нравится: 0", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Подписаться на велосипед" }),
  ).toHaveCount(0);
  await expect(page.locator(".bike-heading .detail-actions button")).toHaveCount(0);
  await compact(bar);
  if (!isMobile) expect(new Set(await tops(bar)).size, "one row").toBe(1);
  await page.screenshot({
    path: info.outputPath("bike-actions-owner.png"),
    fullPage: true,
    animations: "disabled",
  });

  // Each tool still does its job.
  const chooser = page.waitForEvent("filechooser");
  await tools.getByRole("button", { name: "Добавить фото", exact: true }).click();
  await chooser;
  for (const [name, title] of [
    ["Найти фото", "Выбор фотографий"],
    ["Доступ", "Доступ к велосипеду"],
    ["Удалить", "Удалить велосипед?"],
  ]) {
    await tools.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await tools.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
