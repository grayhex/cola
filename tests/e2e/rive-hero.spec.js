import { test, expect } from "@playwright/test";
import pg from "pg";
import { defaultSettings } from "../../lib/site-defaults.js";
let db, original;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
});
async function enabled(value) {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
    { ...defaultSettings, heroAnimationsEnabled: value },
  ]);
}
test.beforeEach(async () => enabled(true));
test.afterEach(async () =>
  db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]),
);
test.afterAll(async () => db.end());

const small = '[data-rive-art="transparent-bike"]';
const large = '[data-rive-art="riding-bike"]';
async function theme(page, value) {
  await page.addInitScript((theme) => {
    if (!localStorage.getItem("cola:theme"))
      localStorage.setItem("cola:theme", theme);
  }, value);
}
async function posters(page, value) {
  const image = page.locator(`${small} img[src$="-${value}.png"]`);
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((e) => e.complete && e.naturalWidth > 0))
    .toBe(true);
}

for (const color of ["light", "dark"])
  test(`Rive ${color}: lazy, animated, stable, local and stoppable without WebGL`, async ({
    page,
    isMobile,
  }, info) => {
    await theme(page, color);
    // Canvas2D assets work on devices without WebGL.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.startsWith("webgl")
          ? null
          : original.call(this, type, ...args);
      };
    });
    const requests = [],
      violations = [],
      errors = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.riveViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.riveViolations.push(e.violatedDirective),
      );
    });
    await enabled(false);
    await page.goto("/", { waitUntil: "networkidle" });
    await posters(page, color);
    expect(requests.some((url) => /\.(riv|wasm)$/.test(url))).toBe(false);
    await expect(
      page.getByRole("button", { name: "Оживить велосипеды" }),
    ).toHaveCount(0);
    const art = await page.locator(small).boundingBox(),
      heading = await page.locator("h1").boundingBox();
    expect(art.x + art.width).toBeLessThanOrEqual(heading.x);
    await expect(page.locator("footer summary")).toHaveText("Авторы графики");
    const initial = await page.locator("[data-home-search]").boundingBox();
    await enabled(true);
    await page.reload();
    await expect(page.locator(`${small} [data-rive-ready]`)).toBeVisible({
      timeout: 20000,
    });
    if (!isMobile)
      await expect(page.locator(`${large} [data-rive-ready]`)).toBeVisible();
    else
      expect(
        requests.some((url) => url.endsWith(`riding-bike-${color}.riv`)),
      ).toBe(false);
    const canvas = page.locator(`${small} canvas`);
    const first = await canvas.evaluate((e) => e.toDataURL());
    await expect
      .poll(() => canvas.evaluate((e) => e.toDataURL()))
      .not.toBe(first);
    // Actual rendered pixels, not just an initialized WASM runtime.
    expect(
      await canvas.evaluate((e) => {
        const pixels = e
          .getContext("2d")
          .getImageData(0, 0, e.width, e.height).data;
        let gold = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] > 180 &&
            pixels[i + 1] > 100 &&
            pixels[i + 2] < 80 &&
            pixels[i + 3] > 200
          )
            gold++;
        return gold;
      }),
    ).toBeGreaterThan(30);
    const after = await page.locator("[data-home-search]").boundingBox();
    expect(Math.abs(after.y - initial.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - initial.height)).toBeLessThanOrEqual(1);
    expect(
      requests
        .filter((url) => /\.(riv|wasm)$/.test(url))
        .every((url) => new URL(url).origin === new URL(page.url()).origin),
    ).toBe(true);
    violations.push(...(await page.evaluate(() => window.riveViolations)));
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`rive-${color}.png`),
      fullPage: false,
    });
    const other = color === "light" ? "dark" : "light";
    await page.getByRole("switch", { name: "Тёмная тема" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", other);
    await expect
      .poll(() =>
        requests.some((url) => url.endsWith(`transparent-bike-${other}.riv`)),
      )
      .toBe(true);
    await expect(page.locator(`${small} [data-rive-ready]`)).toBeVisible();
    await enabled(false);
    await page.reload();
    await expect(page.locator("[data-rive-art] canvas")).toHaveCount(0);
    await posters(page, other);
    await enabled(true);
    await page.reload();
    await expect(page.locator(`${small} [data-rive-ready]`)).toBeVisible();
    await page.locator("footer").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-rive-art] canvas")).toHaveCount(0);
  });

test("reduced motion never fetches Rive; changing the preference stops a running canvas", async ({
  page,
}) => {
  const assets = [];
  page.on("request", (r) => {
    if (/\.(riv|wasm)$/.test(r.url())) assets.push(r.url());
  });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await theme(page, "dark");
  await page.goto("/", { waitUntil: "networkidle" });
  await posters(page, "dark");
  await expect(
    page.getByRole("button", { name: "Оживить велосипеды" }),
  ).toHaveCount(0);
  expect(assets).toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(`${small} [data-rive-ready]`)).toBeVisible({
    timeout: 20000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-rive-art] canvas")).toHaveCount(0);
  await posters(page, "dark");
});

for (const failure of ["canvas", "wasm", "asset", "runtime"])
  test(`Rive ${failure} failure keeps the poster and search usable`, async ({
    page,
  }) => {
    await theme(page, "light");
    if (failure === "runtime")
      await page.emulateMedia({ reducedMotion: "reduce" });
    let blocked = 0;
    if (failure === "canvas")
      await page.addInitScript(() => {
        HTMLCanvasElement.prototype.getContext = () => null;
      });
    else if (failure !== "runtime")
      await page.route(
        failure === "wasm" ? "**/*.wasm" : "**/*.riv",
        (route) => {
          blocked++;
          return route.abort();
        },
      );
    await page.goto("/", { waitUntil: "networkidle" });
    if (failure === "runtime")
      await page.route("**/_next/static/chunks/*.js", (route) => {
        blocked++;
        return route.abort();
      });
    if (failure === "runtime")
      await page.emulateMedia({ reducedMotion: "no-preference" });
    if (failure !== "canvas")
      await expect.poll(() => blocked).toBeGreaterThan(0);
    await expect(page.locator("[data-rive-art] canvas")).toHaveCount(0, {
      timeout: 20000,
    });
    await posters(page, "light");
    await expect(page.locator("[data-rive-ready]")).toHaveCount(0);
    await page.locator("[data-home-search] input").fill("Cube");
    await expect(page.locator("[data-home-search] input")).toHaveValue("Cube");
    // The search remains independently usable after the decorative runtime fails.
    await page.locator("[data-home-search] input").press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("[data-rive-art] canvas")).toHaveCount(0);
  });
