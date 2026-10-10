import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const label = "Мастер велосипеда, шаг «Поиск» · картинка или анимация";

// #374 (owner's comment): the search of the first step is wide and in the
// middle, not pressed to the top left corner, and the step can show a picture
// or an animation that the admin uploads.
async function openWizard(page) {
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  return wizard;
}
const rect = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

test("step 1: the search is wide and stands in the middle of the window, on a desktop and on a phone", async ({
  page,
}, info) => {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Centered " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "wizard-374-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [1280, 800],
    [1920, 1000],
    [390, 800],
    [360, 740],
  ]) {
    await page.setViewportSize({ width, height });
    const wizard = await openWizard(page);
    const field = wizard.getByLabel("Модель, год и комплектация", {
      exact: true,
    });
    // The window is a frame first and fills when the step is loaded.
    await expect(field).toBeVisible();
    await expect
      .poll(async () => (await rect(wizard)).width)
      .toBeGreaterThan(width >= 700 ? 900 : width - 40);
    const dialog = await rect(wizard);
    const input = await rect(field);
    const search = await rect(wizard.locator(".wizard-search"));
    if (width >= 700) {
      // Wider than the former reading width, and not on the left edge.
      expect(input.width).toBeGreaterThan(760);
      const dialogMiddle = dialog.x + dialog.width / 2;
      expect(Math.abs(input.x + input.width / 2 - dialogMiddle)).toBeLessThan(
        24,
      );
      expect(input.x - dialog.x).toBeGreaterThan(24);
    } else {
      // A phone: the field takes the width of the window less its margins.
      expect(input.width).toBeGreaterThan(width - 90);
      expect(input.x).toBeGreaterThanOrEqual(0);
    }
    expect(search.width).toBeLessThanOrEqual(880 + 1);
    expect(await pageOverflow(page)).toBeNull();
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`wizard-search-${width}.png`),
      animations: "disabled",
    });
  }
});

test("step 1: a picture or an animation uploaded in the admin stands beside the search; an unset slot leaves no gap", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  let user;
  const ids = [];
  try {
    const suffix = randomUUID();
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Wizard picture " + suffix.slice(0, 8),
        email: suffix + "@example.test",
        password: "wizard-374-secret-123",
      },
    });
    expect(registered.status()).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user.id;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user]);
    await page.addInitScript(() =>
      localStorage.setItem("cola:theme", "system"),
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

    // Nothing is set: the step is as before, no space is kept for art.
    const screen = page.viewportSize();
    let wizard = await openWizard(page);
    await expect(page.locator("[data-planning-graphic]")).toHaveCount(0);
    // The distance from the top of the step to its first line: a picture above
    // it would add to it.
    const gap = async () =>
      (await rect(wizard.locator(".wizard-search .help"))).y -
      (await rect(wizard.locator(".wizard-search"))).y;
    const without = await gap();
    await page.keyboard.press("Escape");

    // The admin uploads a picture into the slot and publishes it.
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Графика", exact: true }).click();
    await page
      .getByRole("button", { name: "Системные иллюстрации", exact: true })
      .click();
    async function upload(file) {
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().includes("/api/admin/assets?") &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("Файл: " + label, { exact: true })
        .setInputFiles(file);
      const response = await uploaded;
      expect(response.status()).toBe(201);
      const id = (await response.json()).id;
      ids.push(id);
      await expect(
        page.getByRole("combobox", { name: label, exact: true }),
      ).toHaveValue(id);
      await page
        .getByRole("button", { name: "Сохранить", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Настройки опубликованы на сайте", { exact: true }),
      ).toBeVisible();
      return id;
    }
    const picture = await upload({
      name: "wizard.png",
      mimeType: "image/png",
      buffer: await sharp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180"><rect width="480" height="180" fill="#eef"/><circle cx="130" cy="110" r="52" fill="none" stroke="#223" stroke-width="10"/><circle cx="350" cy="110" r="52" fill="none" stroke="#223" stroke-width="10"/><path d="M130 110 L220 50 L300 50 L350 110 M220 50 L250 110 L130 110" stroke="#223" stroke-width="9" fill="none"/></svg>',
        ),
      )
        .png()
        .toBuffer(),
    });
    let saved = (await db.query("SELECT value FROM site_settings WHERE id=1"))
      .rows[0].value;
    expect(saved.wizardSearchGraphic).toEqual({
      kind: "image",
      assetId: picture,
    });
    // The file is protected while it is in use, and named by its place.
    const library = await (
      await page.request.get("/api/admin/assets/library")
    ).json();
    expect(library.assets.find((a) => a.id === picture).usage).toContain(label);
    expect(
      (
        await page.request.delete("/api/admin/assets/" + picture, {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
    // A format that does not match the file, a video and a remote address are
    // refused by the server.
    const version = (
      await db.query("SELECT version FROM site_settings WHERE id=1")
    ).rows[0].version;
    for (const graphic of [
      { kind: "rive", assetId: picture },
      { kind: "video", assetId: picture },
      { kind: "image", assetId: "https://example.test/remote.png" },
    ])
      expect(
        (
          await page.request.put("/api/admin/settings", {
            headers: { origin },
            data: {
              version,
              value: { ...saved, wizardSearchGraphic: graphic },
            },
          })
        ).status(),
      ).toBe(400);

    // The wizard shows it above the search, and the search stays wide.
    for (const [width, height, theme] of [
      [1280, 800, "light"],
      [1280, 800, "dark"],
      [390, 800, "light"],
      [390, 800, "dark"],
    ]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      wizard = await openWizard(page);
      const graphic = wizard.locator(
        "[data-planning-graphic='wizardSearchGraphic']",
      );
      await expect(graphic).toBeVisible();
      const image = graphic.locator("img");
      await expect(image).toHaveAttribute(
        "src",
        new RegExp("/api/assets/" + picture + "$"),
      );
      await expect
        .poll(() => image.evaluate((e) => e.complete && e.naturalWidth > 0))
        .toBe(true);
      expect(await image.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
        "contain",
      );
      const art = await rect(graphic);
      const help = await rect(wizard.locator(".wizard-search .help"));
      expect(Math.abs(art.width - art.height)).toBeLessThan(2);
      const field = await rect(
        wizard.getByLabel("Модель, год и комплектация", { exact: true }),
      );
      const dialog = await rect(wizard);
      if (width >= 900) {
        expect(art.width).toBeGreaterThan(300);
        expect(field.x).toBeGreaterThan(art.x + art.width);
        expect(field.width).toBeGreaterThan(600);
      } else {
        expect(art.y + art.height).toBeLessThanOrEqual(help.y + 1);
        expect(art.width).toBeLessThanOrEqual(100);
      }
      expect(await pageOverflow(page)).toBeNull();
      expect(dialog.height).toBeLessThanOrEqual(height);
      expect(
        (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`wizard-picture-${width}-${theme}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }

    // An animation: nothing of it loads before the step is shown; with reduced
    // motion it is a still mark, otherwise it plays.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    await page.getByRole("button", { name: "Графика", exact: true }).click();
    await page
      .getByRole("button", { name: "Системные иллюстрации", exact: true })
      .click();
    const animation = await upload({
      name: "wizard.riv",
      mimeType: "application/octet-stream",
      buffer: await readFile(
        new URL(
          "../../assets/rive/transparent-bike.source.riv",
          import.meta.url,
        ),
      ),
    });
    saved = (await db.query("SELECT value FROM site_settings WHERE id=1"))
      .rows[0].value;
    expect(saved.wizardSearchGraphic).toEqual({
      kind: "rive",
      assetId: animation,
    });
    const requests = [];
    page.on("request", (r) => {
      if (r.url().includes(".wasm") || r.url().includes(animation))
        requests.push(r.url());
    });
    await page.goto("/account?tab=bikes");
    await expect(
      page.getByRole("button", { name: "Добавить велосипед" }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    wizard = await openWizard(page);
    await expect(
      wizard.locator("[data-planning-graphic='wizardSearchGraphic']"),
    ).toBeVisible();
    await expect(wizard.locator("canvas")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(wizard.locator("[data-rive-ready='true']")).toBeVisible();
    expect(requests.some((u) => u.includes(animation))).toBe(true);
    expect(await pageOverflow(page)).toBeNull();
    await page.screenshot({
      path: info.outputPath("wizard-animation-active.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(wizard.locator("canvas")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Unset again: the step is as it was, no gap is left.
    await db.query(
      "UPDATE site_settings SET value=value || $1::jsonb WHERE id=1",
      [JSON.stringify({ wizardSearchGraphic: null })],
    );
    await page.setViewportSize(screen);
    wizard = await openWizard(page);
    await expect(page.locator("[data-planning-graphic]")).toHaveCount(0);
    expect(await gap()).toBe(without);
  } finally {
    await db.query(
      "UPDATE site_settings SET value=$1,version=version+1 WHERE id=1",
      [original],
    );
    for (const id of ids)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
