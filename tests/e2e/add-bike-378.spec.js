import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #378: «Добавить велосипед» opens the wizard over the page the rider is on —
// from the showcase, the menu, the planner — with no trip to the account; the
// address and the scroll stay, a failed load is told in place, a saved bike is
// said and offered; the picture above the search never covers it.
async function member(page, label = "Adder") {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "add-bike-378-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
const wizardOf = (page) =>
  page.getByRole("dialog", { name: "Новый велосипед", exact: true });
const forward = (wizard) =>
  wizard.getByRole("button", { name: /^(Далее|Продолжить вручную)$/ });
// A tall page scrolled a little, the button still in view (a click scrolls
// to its target first): the scroll the rider left it at has to come back.
async function scrolled(page, top = 48) {
  await page.evaluate((to) => {
    const spacer = document.createElement("div");
    spacer.setAttribute("data-spacer", "");
    spacer.style.height = "3000px";
    document.body.append(spacer);
    window.scrollTo(0, to);
  }, top);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(top - 5);
}
// A trip to the account: a page load or a client navigation. The links of the
// page that Next fetches ahead (they carry the prefetch header) are not trips.
function accountRequests(page) {
  const seen = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/account") return;
    if (request.headers()["next-router-prefetch"]) return;
    seen.push(request.url());
  });
  return seen;
}
async function createBike(wizard, brand = "Kona", model = "Rove") {
  await forward(wizard).click();
  await wizard.getByLabel("Марка", { exact: true }).fill(brand);
  await wizard.getByLabel("Модель", { exact: true }).fill(model);
  await wizard.getByLabel("Год", { exact: true }).fill("2022");
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");
  await forward(wizard).click();
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
}

test("from the showcase the wizard opens over the page: no trip to the account, the address and the scroll stay, closing gives the focus back", async ({
  page,
}) => {
  await member(page);
  const seen = accountRequests(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bikes?sort=popular");
  const url = page.url();
  const add = page
    .locator("main")
    .getByRole("link", { name: "Добавить велосипед" })
    .first();
  await expect(add).toBeVisible();
  await scrolled(page);
  await add.click();
  const wizard = wizardOf(page);
  await expect(wizard).toBeVisible();
  // The page under the window is the one the rider was on.
  expect(page.url()).toBe(url);
  expect(seen).toEqual([]);
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await wizard.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(wizard).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(43);
  await expect(add).toBeFocused();
  expect(seen).toEqual([]);

  // Again, and again: one window each time, the same wizard.
  await add.click();
  await expect(wizard).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await wizard.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(wizard).toHaveCount(0);
});

test("the menu «Добавить велосипед» opens the wizard over the page", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the drawer of the phone is covered by navigation");
  await member(page);
  const seen = accountRequests(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rides");
  const url = page.url();
  await page.getByRole("button", { name: "Подразделы: Велосипеды" }).click();
  await page
    .getByRole("link", { name: "Добавить велосипед", exact: true })
    .click();
  await expect(wizardOf(page)).toBeVisible();
  expect(page.url()).toBe(url);
  expect(seen).toEqual([]);
  // Where it is a link it is still one: a middle click or a new window goes to
  // the address, and an old bookmark keeps working.
  await wizardOf(page)
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  await page.goto("/account?tab=bikes&action=add");
  await expect(wizardOf(page)).toBeVisible();
});

test("a slow or failed load of the wizard is told in place; a second click waits; retry opens it, the page stays", async ({
  page,
}) => {
  await member(page);
  const seen = accountRequests(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bikes?sort=new");
  const url = page.url();
  const add = page
    .locator("main")
    .getByRole("link", { name: "Добавить велосипед" })
    .first();
  await expect(add).toBeVisible();

  // The code of the window is slow: a small bar says so, the link is busy, a
  // second click starts nothing.
  let release = () => {};
  const gate = new Promise((resolve) => (release = resolve));
  let asked = 0;
  await page.route("**/_next/static/chunks/**", async (route) => {
    asked++;
    await gate;
    await route.continue();
  });
  await add.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Открываем мастер" }),
  ).toBeVisible();
  await expect(add).toHaveAttribute("aria-busy", "true");
  const before = asked;
  await add.click();
  expect(asked).toBe(before);
  release();
  await expect(wizardOf(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await wizardOf(page)
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  await page.unroute("**/_next/static/chunks/**");
  expect(page.url()).toBe(url);

  // A reload, so the chunk is not in memory; now it fails.
  await page.reload();
  await page.route("**/_next/static/chunks/**", (route) => route.abort());
  await add.click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Не удалось открыть мастер" });
  await expect(alert).toBeVisible();
  expect(page.url()).toBe(url);
  // The way back in place: retry once the connection is back.
  await page.unroute("**/_next/static/chunks/**");
  await alert.getByRole("button", { name: "Повторить" }).click();
  await expect(wizardOf(page)).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(page.url()).toBe(url);
  expect(seen).toEqual([]);
});

test("a saved bike is said and offered: the rider stays or opens it; nothing is forced", async ({
  page,
}) => {
  await member(page);
  const seen = accountRequests(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bikes?sort=new");
  const url = page.url();
  const add = page
    .locator("main")
    .getByRole("link", { name: "Добавить велосипед" })
    .first();
  await add.click();
  let wizard = wizardOf(page);
  await createBike(wizard);
  const saved = page.getByRole("dialog", {
    name: "Велосипед сохранён",
    exact: true,
  });
  await expect(saved).toBeVisible();
  await expect(saved).toContainText("Kona Rove 2022");
  // Not sent to an empty account: the page under the window is still the same.
  expect(page.url()).toBe(url);
  expect(seen).toEqual([]);
  await saved.getByRole("button", { name: "Остаться здесь" }).click();
  await expect(saved).toHaveCount(0);
  expect(page.url()).toBe(url);
  const { bikes } = await (await page.request.get("/api/bikes")).json();
  expect(bikes).toHaveLength(1);

  // The other answer: open the bike.
  await add.click();
  wizard = wizardOf(page);
  await createBike(wizard, "Trek", "Domane");
  await page
    .getByRole("dialog", { name: "Велосипед сохранён" })
    .getByRole("button", { name: "Открыть велосипед" })
    .click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.locator("h1").first()).toContainText("Trek Domane");
});

test("from the planner the wizard opens over it, and the planner goes on with the new bike", async ({
  page,
}) => {
  await member(page);
  await page.request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Организовать покатушку", exact: true })
    .first()
    .click();
  const planner = page.getByRole("dialog", {
    name: "Организовать покатушку",
    exact: true,
  });
  await expect(planner).toBeVisible();
  const url = page.url();
  await planner.getByRole("link", { name: "Добавить велосипед" }).click();
  // Two windows, one over the other, each named by its own title.
  const wizard = wizardOf(page);
  await expect(wizard).toBeVisible();
  expect(page.url()).toBe(url);
  await createBike(wizard);
  await page
    .getByRole("dialog", { name: "Велосипед сохранён" })
    .getByRole("button", { name: "Остаться здесь" })
    .click();
  // The garage was read again: the form is there, with no reload.
  await expect(planner.getByLabel("Дата", { exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
});

test("the picture above the search is limited, reserved and never covers it: a slow, wide, portrait, small or missing one", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  try {
    const user = await member(page, "Picture");
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    async function upload(width, height, color) {
      const buffer = await sharp({
        create: { width, height, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      const response = await page.request.post(
        "/api/admin/assets?name=" +
          encodeURIComponent(`pic-${width}x${height}.png`),
        { headers: { origin, "Content-Type": "image/png" }, data: buffer },
      );
      expect(response.status()).toBe(201);
      return (await response.json()).id;
    }
    const use = async (assetId) => {
      await db.query(
        "UPDATE site_settings SET value=jsonb_set(value,'{wizardSearchGraphic}',$1::jsonb) WHERE id=1",
        [JSON.stringify({ kind: "image", assetId })],
      );
    };
    const pictures = {
      wide: await upload(3000, 200, "#ccd"),
      portrait: await upload(200, 3000, "#cdc"),
      small: await upload(40, 40, "#dcc"),
      big: await upload(1600, 1600, "#cdd"),
    };
    const rect = async (locator) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      return box;
    };
    for (const [width, height] of [
      [1440, 900],
      [390, 800],
    ]) {
      await page.setViewportSize({ width, height });
      for (const [kind, assetId] of Object.entries(pictures)) {
        await use(assetId);
        // Slow: the file is held until the box has been measured.
        let release = () => {};
        const gate = new Promise((resolve) => (release = resolve));
        await page.route("**/api/assets/" + assetId, async (route) => {
          await gate;
          await route.continue();
        });
        await page.goto("/account?tab=bikes");
        await page
          .getByRole("button", { name: "Добавить велосипед", exact: true })
          .click();
        const wizard = wizardOf(page);
        await expect(wizard).toBeVisible();
        const graphic = wizard.locator("[data-planning-graphic]");
        await expect(graphic, kind).toBeVisible();
        const field = wizard.getByLabel("Модель, год и комплектация", {
          exact: true,
        });
        const reserved = await rect(graphic);
        const fieldBefore = await rect(field);
        // The room is kept before the picture arrives and is limited.
        expect(reserved.height, kind).toBeLessThanOrEqual(141);
        expect(reserved.width, kind).toBeLessThanOrEqual(480);
        expect(reserved.y + reserved.height, kind).toBeLessThanOrEqual(
          fieldBefore.y,
        );
        release();
        await expect
          .poll(() =>
            graphic
              .locator("img")
              .evaluate((e) => e.complete && e.naturalWidth > 0),
          )
          .toBe(true);
        // The picture itself, not only its box, stays inside the box: a taller
        // or wider file is fitted into it whole, never grown past it over the
        // search below.
        const art = await rect(graphic.locator("img"));
        expect(art.height, kind + " picture height").toBeLessThanOrEqual(
          reserved.height + 1,
        );
        expect(art.width, kind + " picture width").toBeLessThanOrEqual(
          reserved.width + 1,
        );
        expect(
          art.y + art.height,
          kind + " picture bottom",
        ).toBeLessThanOrEqual(fieldBefore.y);
        // Arrived: nothing moved, nothing covers the search, and a click on it
        // reaches it.
        const after = await rect(graphic);
        const fieldAfter = await rect(field);
        expect(after, kind).toEqual(reserved);
        expect(fieldAfter.y, kind).toBe(fieldBefore.y);
        expect(
          await field.evaluate((input) => {
            const box = input.getBoundingClientRect();
            const top = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return top === input;
          }),
          kind,
        ).toBe(true);
        await field.fill("Cube Aim");
        await expect(field).toHaveValue("Cube Aim");
        expect(await pageOverflow(page), kind).toBeNull();
        expect(
          (await new AxeBuilder({ page }).include("dialog").analyze())
            .violations,
          kind,
        ).toEqual([]);
        if (kind === "wide" || kind === "portrait")
          await page.screenshot({
            path: info.outputPath(`wizard-picture-${kind}-${width}.png`),
            animations: "disabled",
          });
        await page.unroute("**/api/assets/" + assetId);
      }
    }

    // Missing: the file is gone — the picture leaves, the search stays at hand.
    await use(pictures.wide);
    await page.route("**/api/assets/" + pictures.wide, (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/account?tab=bikes");
    await page
      .getByRole("button", { name: "Добавить велосипед", exact: true })
      .click();
    const wizard = wizardOf(page);
    await expect(wizard).toBeVisible();
    await expect(wizard.locator("[data-planning-graphic]")).toHaveCount(0);
    await wizard
      .getByLabel("Модель, год и комплектация", { exact: true })
      .fill("Cube Aim");
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    await db.end();
  }
});
