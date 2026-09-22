import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const password = "backlog-browser-secret-123";
async function register(page) {
  const r = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Backlog rider",
      email: randomUUID() + "@example.test",
      password,
    },
  });
  expect(r.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
async function createBike(page, extra = {}) {
  const r = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Bike " + randomUUID(),
      brand: "Cube",
      model: "Travel",
      year: 2021,
      category: "road",
      description: "",
      color: "",
      size: "L",
      weight: 14,
      is_public: true,
      ...extra,
    },
  });
  expect(r.status()).toBe(201);
  return (
    await (await page.request.get("/api/bikes/" + (await r.json()).id)).json()
  ).bike;
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function saveSettings(page, value) {
  const before = await (await page.request.get("/api/admin/overview")).json();
  const result = await page.request.put("/api/admin/settings", {
    headers: { origin },
    data: { value, version: before.settingsVersion },
  });
  expect(result.status()).toBe(200);
}
// Teardown has its own runner-managed budget, so an action timeout cannot
// skip restoration or replace the original failure with a cleanup timeout.
const test = base.extend({
  assetLibrary: async ({ page }, use) => {
    const user = await register(page);
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const assets = [];
    let original;
    await db.connect();
    try {
      await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
      original = (await (await page.request.get("/api/admin/overview")).json()).settings;
      await use({ assets });
    } finally {
      try {
        if (original) await saveSettings(page, original);
        for (const id of assets) {
          const response = await page.request.delete("/api/admin/assets/" + id, { headers: { origin } });
          expect(response.status()).toBe(200);
        }
      } finally {
        await db.end();
      }
    }
  },
});

const c = (extra = {}) => ({
  category: "urban_touring",
  subtype: "commuter",
  suspension: null,
  construction: "folding",
  uses: ["commuting"],
  electric: true,
  fatbike: false,
  ...extra,
});

test("account SPA opens the three-step wizard repeatedly; only explicit X can discard a dirty draft", async ({
  page,
}, info) => {
  await register(page);
  await page.route("**/api/bikes/photo-search", (r) =>
    r.fulfill({ json: { photos: [] } }),
  );
  const native = [];
  page.on("dialog", async (d) => {
    native.push(d.type());
    await d.dismiss();
  });
  await page.goto("/account");
  const add = page.getByRole("button", {
    name: "Добавить велосипед",
    exact: true,
  });
  await add.click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  await expect(
    wizard
      .getByRole("navigation", { name: "Шаги добавления" })
      .getByRole("button"),
  ).toHaveCount(3);
  await wizard.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(wizard).not.toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await add.click();
  await expect(wizard.getByLabel("Модель, год и комплектация", { exact: true })).toBeVisible();
  await wizard
    .getByLabel("Модель, год и комплектация", { exact: true })
    .fill("Cube Travel SL 2021");
  await wizard
    .getByLabel("Название в гараже · необязательно")
    .fill("My folding commuter");
  // Click the actual modal backdrop, not a child or an internal whitespace area.
  await page.mouse.click(2, 2);
  await expect(wizard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(wizard).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await wizard.getByRole("button", { name: "Закрыть", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Закрыть мастер?" });
  await expect(confirm).toBeVisible();
  await expect(
    confirm.getByRole("button", { name: "Продолжить редактирование" }),
  ).toBeFocused();
  await confirm
    .getByRole("button", { name: "Продолжить редактирование" })
    .click();
  await expect(
    wizard.getByLabel("Модель, год и комплектация", { exact: true }),
  ).toHaveValue("Cube Travel SL 2021");
  await wizard
    .getByRole("button", { name: "Заполнить вручную", exact: true })
    .click();
  await wizard.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(wizard.getByLabel("Год", { exact: true })).toHaveValue("2021");
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("urban_touring");
  await wizard
    .getByLabel("Подтип велосипеда", { exact: true })
    .selectOption("commuter");
  await wizard
    .getByText("Классификация / Особенности", { exact: true })
    .click();
  await wizard
    .getByLabel("Конструкция", { exact: true })
    .selectOption("folding");
  await wizard
    .getByRole("checkbox", { name: "Electric · электропривод", exact: true })
    .check();
  for (const name of ["Commuting", "Touring", "Bikepacking"])
    await wizard.getByRole("checkbox", { name, exact: true }).check();
  await expect(
    wizard.getByRole("checkbox", { name: "Leisure", exact: true }),
  ).toBeDisabled();
  await wizard.getByLabel("Год", { exact: true }).fill("2020");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("wizard-classification.png"),
    fullPage: true,
    animations: "disabled",
  });
  await wizard
    .getByRole("button", { name: "Сохранить велосипед", exact: true })
    .click();
  await expect(wizard).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My folding commuter", exact: true }),
  ).toBeVisible();
  const bikes = (await (await page.request.get("/api/bikes")).json()).bikes;
  expect(bikes).toHaveLength(1);
  expect(bikes[0].year).toBe(2020);
  expect(bikes[0].classification).toMatchObject(
    c({ uses: ["commuting", "touring", "bikepacking"] }),
  );
  expect(native).toEqual([]);
});

test("journal menu offers only owned bikes and retains text when changing the selected bike", async ({
  page,
  browser,
}) => {
  await register(page);
  const first = await createBike(page, { name: "Journal first" });
  const second = await createBike(page, {
    name: "Journal second",
    is_public: false,
  });
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const other = await visitor.newPage();
    await register(other);
    const foreign = await createBike(other, { name: "Not my bike" });
    await page.goto("/j/new");
    const picker = page.getByLabel("Велосипед для записи", { exact: true });
    await expect(picker).toHaveValue("");
    await expect(picker.locator("option")).toHaveCount(3);
    await expect(picker.locator(`option[value="${foreign.id}"]`)).toHaveCount(
      0,
    );
    await picker.selectOption(first.id);
    await page
      .getByLabel("Заголовок записи", { exact: true })
      .fill("Bike-linked story");
    await page
      .getByLabel("Текст записи", { exact: true })
      .fill("This draft belongs to my own bike.");
    await picker.selectOption(second.id);
    await expect(page.getByLabel("Текст записи", { exact: true })).toHaveText(
      "This draft belongs to my own bike.",
    );
    await page
      .getByRole("button", { name: "Опубликовать запись", exact: true })
      .click();
    await expect(page).toHaveURL(/\/j\/[a-f0-9-]+$/);
    const share = new URL(page.url()).pathname.split("/").pop();
    const record = (
      await (await page.request.get("/api/journal/public/" + share)).json()
    ).entry;
    expect(record.bike.id).toBe(second.id);
    expect(record.bikePublic).toBe(false);
    expect(
      (await other.request.get("/api/journal/public/" + share)).status(),
    ).toBe(404);
    await page.goto("/j/new?bike=" + first.id);
    await expect(picker).toHaveValue(first.id);
    await page.goto("/j/new?bike=" + foreign.id);
    await expect(picker).toHaveValue("");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Велосипед недоступен");
  } finally {
    await visitor.close();
  }
});

test("a reader without a bike gets an actionable journal empty state", async ({
  page,
}) => {
  await register(page);
  await page.goto("/j/new");
  await expect(
    page.getByRole("heading", {
      name: "Добавьте велосипед, чтобы вести его журнал",
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Добавить велосипед", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Новый велосипед", exact: true }),
  ).toBeVisible();
});

test("independent classification filters survive URL reload and find electric folding commuters", async ({
  page,
}, info) => {
  await register(page);
  const bike = await createBike(page, {
    name: "Facet commuter",
    classification: c(),
  });
  await createBike(page, {
    name: "Unpowered commuter",
    classification: c({ electric: false }),
  });
  await createBike(page, {
    name: "Hidden commuter",
    is_public: false,
    classification: c(),
  });
  await page.goto(
    "/bikes?category=urban_touring&construction=folding&electric=1&use=commuting",
  );
  await expect(page.locator(".bike-card")).toHaveCount(1);
  await expect(page.locator(".bike-card")).toContainText("Facet commuter");
  await expect(
    page.locator(".bike-card").getByLabel("Классификация", { exact: true }),
  ).toHaveText("CommuterFoldingE-bike");
  await page.reload();
  await expect(page.locator(".bike-card")).toHaveCount(1);
  await page.goto(
    "/search?type=bikes&category=urban_touring&construction=folding&electric=1",
  );
  await expect(page.getByRole("link", { name: /Facet commuter/ })).toHaveCount(
    1,
  );
  await expect(page.getByRole("link", { name: /Hidden commuter/ })).toHaveCount(
    0,
  );
  const facets = page
    .locator("details")
    .filter({ has: page.getByText(/^Классификация/) })
    .first();
  await facets.locator("summary").click();
  await expect(facets.getByRole("combobox", { name: "Электропривод", exact: true })).toBeVisible();
  await facets.getByLabel("Электропривод", { exact: true }).selectOption("0");
  await expect(
    page.getByRole("link", { name: /Unpowered commuter/ }),
  ).toHaveCount(1);
  await expect(page).toHaveURL(/electric=0/);
  await page.goto("/b/" + bike.share_id);
  const labels = page.locator(".bike-labels");
  await expect(labels).toContainText("L");
  expect(
    await labels
      .locator(".hf-label")
      .first()
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeLessThanOrEqual(12);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("bike-compact-labels.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("admin backgrounds are independent per theme; native local SVG file upload preserves raster animation", async ({
  page,
  assetLibrary,
}, info) => {
  const { assets } = assetLibrary;
  await test.step("configure backgrounds and upload a local SVG file", async () => {
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Дизайн", exact: true }).click();
    const section = (name) =>
      page
        .getByRole("navigation", { name: "Разделы админки" })
        .getByRole("button", { name: new RegExp("^" + name + "(?: |$)") });
    await section("Графика").click();
    const graphics = page.getByRole("region", { name: "Графика сайта" });
    await expect(graphics.getByRole("combobox", { name: "Группа", exact: true })).toBeVisible();
    await graphics.getByLabel("Группа", { exact: true }).selectOption("Фон сайта");
    await expect(graphics.locator(".asset-picker")).toHaveCount(2);
    await graphics.getByLabel("Найти графику", { exact: true }).fill("светлая");
    await expect(graphics.locator(".asset-picker")).toHaveCount(1);
    await graphics.getByLabel("Найти графику", { exact: true }).fill("");
    for (const [kind, color] of [
      ["светлая", "#e8ddd0"],
      ["тёмная", "#27333f"],
    ]) {
      const file = await sharp({
        create: { width: 64, height: 64, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      const input = page.getByLabel("Файл: Фон сайта · " + kind + " тема", {
        exact: true,
      });
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes("/api/admin/assets?"),
      );
      await input.setInputFiles({
        name: kind + ".png",
        mimeType: "image/png",
        buffer: file,
      });
      const r = await response;
      expect(r.status()).toBe(201);
      // Verify the ID actually applied by the UI. Browser response bodies can
      // be evicted after fetch has consumed them; the selected value is durable.
      const picker = page.getByLabel("Фон сайта · " + kind + " тема", { exact: true });
      await expect(picker).toHaveValue(/^[0-9a-f-]{36}$/);
      assets.push(await picker.inputValue());
    }
    await section("Внешний вид").click();
    for (const [label, target] of [
      ["светлая", 65],
      ["тёмная", 85],
    ]) {
      const slider = page.getByLabel("Прозрачность фона · " + label + " тема", {
        exact: true,
      });
      await slider.focus();
      await slider.press("End");
      for (let i = 100; i > target; i--) await slider.press("ArrowLeft");
      await expect(slider).toHaveValue(String(target));
    }
    await page
      .getByLabel("Размещение фона · тёмная тема", { exact: true })
      .selectOption("tile");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    await section("Главная").click();
    const png = await sharp({
      create: { width: 80, height: 80, channels: 4, background: "#f43030" },
    })
      .png()
      .toBuffer();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><image href="data:image/png;base64,${png.toString("base64")}" width="80" height="80"><animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite"/></image></svg>`;
    const filename = info.outputPath("local-embedded-raster.svg");
    await writeFile(filename, svg);
    const upload = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/admin/assets?"),
    );
    await page
      .getByLabel("Файл: Анимация · светлая тема", { exact: true })
      .setInputFiles(filename);
    const r = await upload;
    expect(r.status()).toBe(201);
    const animationPicker = page.getByLabel("Анимация · светлая тема", { exact: true });
    await expect(animationPicker).toHaveValue(/^[0-9a-f-]{36}$/);
    const animation = await animationPicker.inputValue();
    assets.push(animation);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Настройки опубликованы",
    );
    const response = await page.request.get("/api/assets/" + animation);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/svg+xml");
    expect(response.headers()["content-security-policy"]).toContain("img-src data:");
    expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers()["content-security-policy"]).toContain("sandbox");
    const savedSvg = await response.text();
    expect(savedSvg).toContain("data:image/png;base64,");
    expect(savedSvg).toContain('<animate attributeName="opacity"');
    for (const id of assets)
      expect(
        (
          await page.request.delete("/api/admin/assets/" + id, {
            headers: { origin },
          })
        ).status(),
      ).toBe(409);
    const malicious = await page.request.post(
      "/api/admin/assets?name=bad.svg",
      {
        headers: { origin, "content-type": "image/svg+xml" },
        data: '<svg><image href="https://example.test/tracker.png"/></svg>',
      },
    );
    expect(malicious.status()).toBe(400);
    await page.goto("/");
    const toggle = page.getByRole("switch", {
      name: "Тёмная тема",
      exact: true,
    });
    await expect(toggle).toBeEnabled();
    if ((await toggle.getAttribute("aria-checked")) === "true")
      await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const background = () =>
      page.locator(".site-root").evaluate((e) => {
        const s = getComputedStyle(e, "::before");
        return {
          image: s.backgroundImage,
          opacity: s.opacity,
          repeat: s.backgroundRepeat,
        };
      });
    await expect.poll(background).toMatchObject({
      image: `url("${origin}/api/assets/${assets[0]}")`,
      opacity: "0.35",
      repeat: "no-repeat",
    });
    const stage = page.locator("[data-hero-animation]");
    const art = stage.locator(`img[src="/api/assets/${animation}"]`).first();
    const viewport = page.viewportSize();
    const compact = viewport && viewport.width <= 700;
    // The existing compact homepage omits the decorative stage. Validate
    // its upload/rendering in touch landscape without changing that layout.
    if (compact) {
      await expect(stage).toBeHidden();
      await page.setViewportSize({ width: 844, height: 390 });
    }
    await expect(art).toBeVisible();
    await expect.poll(() => art.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await noOverflow(page);
    if (compact) await page.setViewportSize(viewport);
    await toggle.click();
    await expect.poll(background).toMatchObject({
      image: `url("${origin}/api/assets/${assets[1]}")`,
      opacity: "0.15",
      repeat: "repeat",
    });
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("background-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/account?tab=appearance");
    await page
      .getByRole("combobox", { name: "Тема", exact: true })
      .selectOption("system");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("switch", { name: "Тёмная тема", exact: true })
      .focus();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test("market covers bound tall and wide uploaded photos without covering title or price", async ({
  page,
}, info) => {
  await register(page);
  for (const [width, height, title] of [
    [120, 5000, "Tall component"],
    [5000, 120, "Wide component"],
  ]) {
    const r = await page.request.post("/api/market", {
      headers: { origin },
      data: {
        title,
        description: "Test image bounds",
        category: "components",
        condition: "used",
        price: 100,
        currency: "RUB",
        location: "Test city",
        contact: "",
        status: "active",
      },
    });
    expect(r.status()).toBe(201);
    const id = (await r.json()).id;
    const image = await sharp({
      create: { width, height, channels: 3, background: "#6b848e" },
    })
      .png()
      .toBuffer();
    expect(
      (
        await page.request.post(`/api/market/${id}/photos`, {
          headers: { origin, "content-type": "image/png" },
          data: image,
        })
      ).status(),
    ).toBe(201);
  }
  await page.goto("/market");
  for (const title of ["Tall component", "Wide component"]) {
    const card = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    const image = card.locator("img");
    await expect(image).toBeVisible();
    const a = await image.boundingBox(),
      cover = await image.locator("..").boundingBox(),
      heading = await card
        .getByRole("heading", { name: title, exact: true })
        .boundingBox();
    expect(a.height).toBeLessThanOrEqual(cover.height + 1);
    expect(a.width).toBeLessThanOrEqual(cover.width + 1);
    expect(a.y + a.height).toBeLessThanOrEqual(heading.y);
    expect(cover.height).toBeLessThanOrEqual(210);
  }
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("market-photo-bounds.png"),
    fullPage: true,
    animations: "disabled",
  });
});
