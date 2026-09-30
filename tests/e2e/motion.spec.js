import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { gpx, loop } from "../ride-fixtures.js";
import { publicPath } from "../../lib/public-urls.ts";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const marker = "motion-" + randomUUID().slice(0, 8);
let author, reader, cookies, bike, entry, ride;
async function post(request, path, data, extra = {}) {
  const response = await request.post("/api/" + path, {
    headers: { origin },
    data,
    ...extra,
  });
  expect(response.ok(), path + " " + (await response.text())).toBe(true);
  return response.json();
}
test.beforeAll(async ({ browser }) => {
  author = await browser.newContext({ baseURL: origin });
  reader = await browser.newContext({ baseURL: origin });
  for (const [context, suffix] of [
    [author, "author"],
    [reader, "reader"],
  ]) {
    const response = await registerVerified(context.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Motion " + suffix,
        email: `${marker}-${suffix}@example.test`,
        password: "motion-browser-secret-123",
      },
    });
    expect(response.status()).toBe(201);
  }
  cookies = (await reader.storageState()).cookies;
  for (let i = 0; i < 9; i++) {
    const created = await post(author.request, "bikes", {
      name: `${marker} bicycle ${i}`,
      brand: "Cube",
      model: "Travel",
      year: 2026,
      category: "road",
      description: "",
      color: "",
      size: "L",
      weight: 12,
      is_public: true,
    });
    if (i === 0) bike = created;
  }
  const photo = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#94c5bc" },
  })
    .png()
    .toBuffer();
  const upload = await author.request.post(`/api/bikes/${bike.id}/photos`, {
    headers: { origin, "content-type": "image/png" },
    data: photo,
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  bike = (await (await author.request.get("/api/bikes")).json()).bikes.find(
    (b) => b.id === bike.id,
  );
  entry = await post(author.request, "journal", {
    bikeId: bike.id,
    kind: "story",
    title: marker + " story",
    body: "Public story for navigation and save feedback.",
    status: "published",
    isPublic: true,
  });
  entry = (
    await (
      await author.request.get("/api/journal/public/" + entry.shareId)
    ).json()
  ).entry;
  const preview = await post(author.request, "rides/preview", gpx([loop]), {
    headers: { origin, "content-type": "application/gpx+xml" },
  });
  ride = await post(author.request, "rides", {
    previewId: preview.previewId,
    bikeId: bike.id,
    title: marker + " ride",
    description: "",
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
  });
  ride = (
    await (await author.request.get("/api/rides/public/" + ride.shareId)).json()
  ).ride;
});
test.afterAll(async () => {
  await author?.close();
  await reader?.close();
});
test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.addInitScript(() => {
    window.motionTransitions = [];
    window.motionEffects = [];
    const names = () =>
      [...document.querySelectorAll("[style]")]
        .map((el) => el.style.viewTransitionName)
        .filter((name) => name?.startsWith("cola-"));
    const start = document.startViewTransition?.bind(document);
    if (start)
      document.startViewTransition = (...args) => {
        const record = { old: names(), next: [], error: null };
        window.motionTransitions.push(record);
        const transition = start(...args);
        transition.ready.then(
          () => {
            record.next = names();
          },
          (error) => {
            record.error = error.message;
          },
        );
        return transition;
      };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.matches(".motion-feedback-icon, [data-motion-panel]"))
        window.motionEffects.push({
          target: this.className,
          duration: args[1]?.duration,
        });
      return animate.apply(this, args);
    };
  });
});
async function paired(page, name) {
  try {
    await expect
      .poll(() =>
        page.evaluate(
          (name) =>
            window.motionTransitions.some(
              (r) => r.old.includes(name) && r.next.includes(name) && !r.error,
            ),
          name,
        ),
      )
      .toBe(true);
  } catch (error) {
    await test.info().attach("view-transitions", {
      body: JSON.stringify(await page.evaluate(() => window.motionTransitions)),
      contentType: "application/json",
    });
    throw error;
  }
}
async function theme(page, value) {
  await page.addInitScript(
    (value) => localStorage.setItem("cola:theme", value),
    value,
  );
}
async function readyCard(page) {
  const card = page.locator(`[data-bike-id="${bike.id}"]`);
  await expect(card).toBeVisible();
  // A menu state change proves that hydration and reduced-motion subscription
  // have completed before we exercise the native transition.
  const menu = page.getByRole("button", { name: "Порядок витрины" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  return card;
}

for (const color of ["light", "dark"]) {
  test(`bike shared photo, keyboard navigation and back/forward preserve context (${color})`, async ({
    page,
  }, info) => {
    await theme(page, color);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/bikes?q=${marker}`, { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", color);
    const card = await readyCard(page);
    const link = card.getByRole("link", { name: bike.name, exact: true });
    await link.focus();
    const scroll = await page.evaluate(() => scrollY);
    const clock = await page.evaluate(() => performance.timeOrigin);
    // Hover lets Next finish its normal prefetch; there is no custom router.
    await link.hover();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(publicPath("bike", bike) + "$"));
    await expect(page.locator("main h1")).toHaveText(bike.name);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
    await paired(page, `cola-bike-photo-${bike.id}`);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`motion-bike-${color}.png`),
      fullPage: true,
    });
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/bikes\\?q=${marker}$`));
    await expect(card).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThanOrEqual(Math.max(0, scroll - 80));
    await page.goForward();
    await expect(page.locator("main h1")).toHaveText(bike.name);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
    expect(errors).toEqual([]);
  });
}

test("journal title continues into the entry without a document reload", async ({
  page,
}, info) => {
  await page.goto("/journal", { waitUntil: "networkidle" });
  const link = page
    .locator(".journal-card h2")
    .getByRole("link", { name: entry.title, exact: true });
  await expect(link).toBeVisible();
  await link.hover();
  const clock = await page.evaluate(() => performance.timeOrigin);
  await link.click();
  await expect(page.locator("main h1")).toHaveText(entry.title);
  await paired(page, `cola-journal-title-${entry.id}`);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
  await page.goBack();
  await expect(link).toBeVisible();
  await page.goForward();
  await expect(page.locator("main h1")).toHaveText(entry.title);
  await page.screenshot({
    path: info.outputPath("motion-journal.png"),
    fullPage: true,
  });
});

test("SVG map preview opens the ride, preserves attribution links and works without tiles", async ({
  page,
}, info) => {
  // Exercise the SVG fallback even when MapLibre can load without its tiles.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type.includes("webgl")) return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto(`/rides?bikeId=${bike.id}`, { waitUntil: "networkidle" });
  const card = page.locator(".ride-card").filter({ hasText: ride.title });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator("h3")).toBeInViewport();
  const link = card.getByRole("link", { name: "Открыть покатушку по карте" });
  await expect(link).toBeVisible();
  await expect(card.locator('a[href*="openstreetmap"]')).not.toHaveCount(0);
  await expect(link.locator("a")).toHaveCount(0);
  await expect(link.locator("image")).toHaveCount(0);
  await link.hover();
  const clock = await page.evaluate(() => performance.timeOrigin);
  await link.click();
  await expect(page.locator("main h1")).toHaveText(ride.title);
  await paired(page, `cola-ride-title-${ride.id}`);
  await paired(page, `cola-ride-map-${ride.id}`);
  await expect(
    page.locator(".ride-page .ride-route path").first(),
  ).toBeVisible();
  await expect(page.locator(".ride-page .ride-route image")).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
  await page.screenshot({
    path: info.outputPath("motion-ride-fallback.png"),
    fullPage: true,
  });
});

test("like/save feedback is lazy, respects live reduced motion and keeps state", async ({
  page,
}) => {
  await page.goto(`/bikes?q=${marker}`, { waitUntil: "networkidle" });
  const card = await readyCard(page);
  const like = card.getByRole("button", { name: /^Нравится:/ });
  const before = await like.getAttribute("aria-pressed");
  await page.evaluate(() => {
    window.motionEffects = [];
  });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", String(before !== "true"));
  await expect(like).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(() => page.evaluate(() => window.motionEffects.length))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      like
        .locator(".motion-feedback-icon")
        .evaluate((el) => el.style.transform),
    )
    .toBe("");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.motionEffects = [];
  });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", before);
  await expect(like).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => window.motionEffects)).toEqual([]);
  await page.goto("/journal", { waitUntil: "networkidle" });
  const save = page
    .locator(".journal-card")
    .filter({ hasText: entry.title })
    .getByRole("button", { name: /Сохранить запись|Убрать из сохранённого/ });
  const saved = await save.getAttribute("aria-pressed");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", String(saved !== "true"));
  await expect(save).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => window.motionEffects)).toEqual([]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(save).toHaveAttribute("aria-pressed", String(saved !== "true"));
});

test("navigation works without View Transitions and controls survive an unavailable Motion chunk", async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.startViewTransition = undefined;
  });
  await page.goto(`/bikes?q=${marker}`, { waitUntil: "networkidle" });
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  const card = await readyCard(page);
  const like = card.getByRole("button", { name: /^Нравится:/ });
  const before = await like.getAttribute("aria-pressed");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", String(before !== "true"));
  await expect(like).toHaveAttribute("aria-busy", "false");
  await page.unroute("**/_next/static/**/*.js");
  await card.getByRole("link", { name: bike.name, exact: true }).click();
  await expect(page.locator("main h1")).toHaveText(bike.name);
  expect(await page.evaluate(() => window.motionTransitions)).toEqual([]);
});
