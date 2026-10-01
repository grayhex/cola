import { test, expect } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
let db, original, id, filename;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
  id = randomUUID();
  filename = id + ".webp";
  const buffer = process.env.HOME_HERO_FIXTURE
    ? await sharp(await readFile(process.env.HOME_HERO_FIXTURE))
        .resize(2400)
        .webp({ quality: 82 })
        .toBuffer()
    : await sharp({
        create: {
          width: 2400,
          height: 1030,
          channels: 3,
          background: "#19304a",
        },
      })
        .webp()
        .toBuffer();
  await mkdir(process.env.UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(process.env.UPLOAD_DIR, filename), buffer);
  await db.query(
    "INSERT INTO site_assets(id,name,filename) VALUES($1,'new_hero1.png',$2)",
    [id, filename],
  );
  await db.query(
    "UPDATE site_settings SET value=value || $1::jsonb WHERE id=1",
    [{ heroBackgroundImageId: id, heroAnimationsEnabled: true }],
  );
});
test.afterAll(async () => {
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  await db.query("DELETE FROM site_assets WHERE id=$1", [id]);
  await rm(path.join(process.env.UPLOAD_DIR, filename), {
    force: true,
  });
  await db.end();
});
for (const theme of ["light", "dark", "system"])
  test(`static hero ${theme}: responsive LCP preload, no runtime or stage, global search`, async ({
    page,
  }, info) => {
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.addInitScript(
      (theme) => localStorage.setItem("cola:theme", theme),
      theme,
    );
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    for (const width of [390, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/", { waitUntil: "networkidle" });
      const img = page.locator("[data-hero-background]");
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0))
        .toBe(true);
      await expect(img).toHaveAttribute("fetchpriority", "high");
      await expect(img).not.toHaveAttribute("loading", "lazy");
      await expect(
        page.locator('link[rel="preload"][as="image"][imagesrcset]'),
      ).toHaveCount(1);
      await expect(
        page.locator("main canvas, [data-hero-animation], [data-home-search]"),
      ).toHaveCount(0);
      expect(requests.filter((u) => /\.(riv|wasm)(\?|$)/.test(u))).toEqual([]);
      expect(
        requests
          .filter((u) => u.includes("/api/assets/" + id))
          .every((u) => /width=(640|1280|1920|2400)$/.test(u)),
      ).toBe(true);
      const preload = page.locator(
        'link[rel="preload"][as="image"][imagesrcset]',
      );
      expect(await preload.getAttribute("imagesrcset")).toBe(
        await img.getAttribute("srcset"),
      );
      expect(await preload.getAttribute("imagesizes")).toBe(
        await img.getAttribute("sizes"),
      );
      if (width >= 1440) {
        expect(await img.evaluate((e) => e.currentSrc)).toMatch(
          /width=(1920|2400)$/,
        );
        if (await page.evaluate(() => devicePixelRatio > 1))
          expect(await img.evaluate((e) => e.currentSrc)).toMatch(
            /width=2400$/,
          );
      }
      expect(
        await page
          .locator("main > .frame")
          .evaluateAll((frames) =>
            frames.every(
              (frame) =>
                getComputedStyle(frame).borderBottomWidth === "0px" &&
                getComputedStyle(frame.querySelector(".frame-inner"))
                  .borderBottomWidth === "1px",
            ),
          ),
      ).toBe(true);
      const pulse = page.locator("[data-ride-pulse]");
      await expect(pulse.locator("li .site-icon")).toHaveCount(4);
      await expect(pulse.locator("li svg.site-icon")).toHaveCount(4);
      if (width === 390 || width === 1920)
        expect(
          (await new AxeBuilder({ page }).include("main").analyze()).violations,
        ).toEqual([]);
      const sources = await img.evaluate(
        (e) =>
          performance
            .getEntriesByType("resource")
            .filter((r) => r.name === e.currentSrc).length,
      );
      expect(sources).toBe(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`static-home-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    await page.keyboard.press("/");
    await expect(
      page
        .getByRole("dialog", { name: "Поиск ColaBike" })
        .getByRole("combobox"),
    ).toBeFocused();
  });
test("desktop retina uses the largest hero without a duplicate preload", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    baseURL: process.env.TEST_ORIGIN || "http://localhost:3100",
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    for (const width of [1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/", { waitUntil: "networkidle" });
      const img = page.locator("[data-hero-background]");
      await expect
        .poll(() =>
          img.evaluate(
            (e) => e.complete && e.currentSrc.endsWith("width=2400"),
          ),
        )
        .toBe(true);
      expect(
        await img.evaluate(
          (e) =>
            performance
              .getEntriesByType("resource")
              .filter((r) => r.name === e.currentSrc).length,
        ),
      ).toBe(1);
    }
    await page.screenshot({
      path: info.outputPath("hero-retina-1920.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
