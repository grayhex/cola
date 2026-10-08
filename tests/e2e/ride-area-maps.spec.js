import { test, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import {
  areaName,
  chosenArea,
  pickPlace,
  searchBox,
} from "../fixtures/ride-area.js";
import { drawn, span, yandexSdk } from "../fixtures/yandex-sdk.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #370: the area is chosen on the map the site is set to — a MapLibre style
// or the Yandex SDK — not only on a raster one. The picker draws the circle of
// the chosen area, puts the centre where the map is clicked or in the middle
// of the map, and when its engine cannot start (no WebGL, no SDK, a style that
// does not load, maps switched off) the area is still found by name and the
// form is kept. The Yandex SDK is a stand-in of tests/fixtures/yandex-sdk.js.
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const styleUrl = "https://tile.openstreetmap.org/area-test-style.json";
const blankStyle = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "ground",
      type: "background",
      paint: { "background-color": "#dfe7da" },
    },
  ],
};
const maps = {
  style: {
    enabled: true,
    provider: "style",
    tileUrl: "",
    styleUrl,
    publicKey: "",
    attribution: "Тестовая карта",
  },
  yandex: {
    enabled: true,
    provider: "yandex",
    tileUrl: "",
    styleUrl: "",
    publicKey: "test-browser-key",
    attribution: "",
  },
  off: {
    enabled: false,
    provider: "osm",
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    styleUrl: "",
    publicKey: "",
    attribution: "© OpenStreetMap contributors",
  },
};
let db, original;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  original = (await db.query("SELECT value FROM site_settings WHERE id=1"))
    .rows[0].value;
});
test.afterAll(async () => {
  // The map of the site is a setting shared by every spec: put it back.
  await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
  await db.end();
});
const useMap = (map) =>
  db.query(
    "UPDATE site_settings SET value=jsonb_set(value,'{map}',$1::jsonb) WHERE id=1",
    [JSON.stringify(map)],
  );
test.beforeEach(async ({ page }) => {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Map Rider",
      email: randomUUID() + "@example.test",
      password: "ride-area-maps-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const zone = await page.request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
  expect(zone.status()).toBe(200);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.request().url() === styleUrl
      ? route.fulfill({ json: blankStyle })
      : route.abort(),
  );
});
async function open(page) {
  await page.goto("/ride-intents");
  await expect(
    page.getByText("Пока нет намерений.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Новое намерение", exact: true });
}
async function windowAndPurpose(page, dialog) {
  await dialog
    .getByLabel("Окно 1: с", { exact: true })
    .fill(date(1) + "T10:00");
  await dialog
    .getByLabel("Окно 1: до", { exact: true })
    .fill(date(1) + "T15:00");
  await dialog.getByRole("button", { name: /^Цель:/ }).click();
  await page
    .getByRole("dialog", { name: "Цель поездки" })
    .getByRole("button", { name: "Общение", exact: true })
    .click();
}
const save = (dialog) =>
  dialog.getByRole("button", { name: "Сохранить намерение" }).click();
const intents = async (page) =>
  (await (await page.request.get("/api/ride-intents")).json()).items;
const radius = (scope) => chosenArea(scope).getByLabel("Радиус");
const mapButton = (dialog) =>
  dialog.getByRole("button", { name: "Отметить область на карте" });
const frame = (dialog) => dialog.locator("[data-map-provider]");
const canvas = (dialog) => frame(dialog).locator("[data-ready]");
const noWebGl = () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    if (String(type).includes("webgl")) return null;
    return getContext.call(this, type, ...args);
  };
};

test("a MapLibre style map: the centre is clicked, set from the middle, and follows a place found by name", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "WebGL support differs in headless WebKit; the fallback is covered below",
  );
  await useMap(maps.style);
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  // The map is offered, not reported unavailable, and nothing loads before it is opened.
  await expect(dialog).not.toContainText("Карта в настройках сайта недоступна");
  await expect(frame(dialog)).toHaveCount(0);
  await mapButton(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute("data-ready", "true");
  await expect(frame(dialog)).toHaveAttribute("data-map-provider", "style");
  await expect(canvas(dialog)).not.toHaveAttribute("data-area-center");

  // A click puts the centre (coarse) and the default radius; the name is still to give.
  await canvas(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute(
    "data-area-center",
    "37.62,55.75",
  );
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "3000");
  await expect(chosenArea(dialog)).toContainText("Назовите область");
  // The map is the same one: choosing on it did not build it again.
  await expect(canvas(dialog)).toHaveAttribute("data-ready", "true");
  await areaName(dialog).fill("Мой парк");
  await radius(dialog).selectOption("10");
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "10000");
  await expect(canvas(dialog)).toHaveAttribute(
    "data-area-center",
    "37.62,55.75",
  );

  // Dragging the map and putting the centre «here» moves the centre only.
  // The card above the map grew when the area was chosen: bring the map back
  // into view before moving the mouse by coordinates, or it presses the backdrop.
  await canvas(dialog).scrollIntoViewIfNeeded();
  const box = await canvas(dialog).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Поставить центр сюда" }).click();
  const moved = (await canvas(dialog).getAttribute("data-area-center")).split(
    ",",
  );
  expect(Number(moved[0])).toBeLessThan(37.62);
  await expect(areaName(dialog)).toHaveValue("Мой парк");
  await expect(radius(dialog)).toHaveValue("10");
  await page.screenshot({
    path: info.outputPath("area-style-map.png"),
    animations: "disabled",
  });

  // A place found by name replaces the whole area, and the map goes to it.
  await pickPlace(dialog, "сокол", "Сокольники");
  await expect(areaName(dialog)).toHaveValue("Сокольники");
  await expect(canvas(dialog)).toHaveAttribute(
    "data-area-center",
    "37.67,55.79",
  );
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "2000");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  const [intent] = await intents(page);
  expect(intent.passport.area).toEqual({
    label: "Сокольники",
    center: [37.67, 55.79],
    radiusM: 2000,
  });
});

test("the Yandex map: the circle is drawn by the SDK, clicks and the middle of the map set the centre, a place moves the view", async ({
  page,
}, info) => {
  await useMap(maps.yandex);
  let loads = 0;
  await page.route("https://api-maps.yandex.ru/v3/**", (route) => {
    loads++;
    return route.fulfill({ contentType: "text/javascript", body: yandexSdk });
  });
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  await expect(dialog).not.toContainText("Карта в настройках сайта недоступна");
  // The SDK is not asked for until the map is opened.
  expect(loads).toBe(0);
  await mapButton(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute("data-ready", "true");
  await expect(frame(dialog)).toHaveAttribute("data-map-provider", "yandex");
  expect(loads).toBe(1);
  expect((await drawn(page)).polygons).toHaveLength(0);

  await canvas(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute(
    "data-area-center",
    "37.62,55.75",
  );
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "3000");
  let now = await drawn(page);
  expect(now.polygons).toHaveLength(1);
  expect(now.markers).toBe(1);
  // 3 km around the centre: about 0.054° of latitude across.
  expect(span(now.polygons[0])).toBeGreaterThan(0.05);
  expect(span(now.polygons[0])).toBeLessThan(0.058);
  expect(
    await page.evaluate(() => window.__ymaps.maps.length),
    "choosing on the map did not build it again",
  ).toBe(1);

  await areaName(dialog).fill("Мой парк");
  await radius(dialog).selectOption("10");
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "10000");
  await expect
    .poll(async () => span((await drawn(page)).polygons[0]))
    .toBeGreaterThan(0.17);
  expect((await drawn(page)).polygons).toHaveLength(1);

  // «Centre here» takes what the map looks at now.
  await page.evaluate(() => {
    window.__ymaps.maps[0].center = [37.5, 55.7];
  });
  await dialog.getByRole("button", { name: "Поставить центр сюда" }).click();
  await expect(canvas(dialog)).toHaveAttribute("data-area-center", "37.5,55.7");
  await expect(areaName(dialog)).toHaveValue("Мой парк");
  await page.screenshot({
    path: info.outputPath("area-yandex-map.png"),
    animations: "disabled",
  });

  // A place found by name moves the view to it; the old circle is gone.
  await pickPlace(dialog, "коломен", "Коломенское");
  await expect(canvas(dialog)).toHaveAttribute(
    "data-area-center",
    "37.67,55.67",
  );
  now = await drawn(page);
  expect(now.polygons).toHaveLength(1);
  expect(now.center[0]).toBeCloseTo(37.67, 1);
  expect(now.center[1]).toBeCloseTo(55.67, 1);
  // Removing the area takes the circle with it.
  await chosenArea(dialog)
    .getByRole("button", { name: "Убрать область" })
    .click();
  await expect(chosenArea(dialog)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__ymaps.destroyed))
    .toBe(1);
  // Back to the start: the map is closed, offered again, and builds a new one.
  await expect(canvas(dialog)).toHaveCount(0);
  await mapButton(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute("data-ready", "true");
  await canvas(dialog).click();
  await expect(canvas(dialog)).toHaveAttribute("data-area-radius", "3000");
  await areaName(dialog).fill("Другой парк");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  const [intent] = await intents(page);
  expect(intent.passport.area.label).toBe("Другой парк");
  expect(intent.passport.area.radiusM).toBe(3000);
  expect(intent.passport.area.center).toHaveLength(2);
});

for (const [name, setup, message] of [
  [
    "the Yandex SDK does not load",
    async (page) => {
      await useMap(maps.yandex);
      await page.route("https://api-maps.yandex.ru/v3/**", (route) =>
        route.abort(),
      );
    },
    /Карта не загрузилась/,
  ],
  [
    "the style does not load",
    async (page) => {
      await useMap(maps.style);
      await page.route(styleUrl, (route) => route.abort());
    },
    /Карта не загрузилась/,
  ],
  [
    "the browser has no WebGL",
    async (page) => {
      await useMap(maps.style);
      await page.addInitScript(noWebGl);
    },
    /Карта не загрузилась/,
  ],
]) {
  test(`when ${name}, the area is still found by name and the form is kept`, async ({
    page,
  }) => {
    await setup(page);
    const dialog = await open(page);
    await windowAndPurpose(page, dialog);
    await mapButton(dialog).click();
    await expect(
      dialog.getByRole("status").filter({ hasText: message }),
    ).toBeVisible();
    // The map controls do nothing while there is no map.
    await expect(
      dialog.getByRole("button", { name: "Поставить центр сюда" }),
    ).toBeDisabled();
    // The rest of the form works: a place by name, saved with its centre.
    await pickPlace(dialog, "парк горь", "Парк Горького");
    await expect(areaName(dialog)).toHaveValue("Парк Горького");
    await expect(dialog).toBeVisible();
    await save(dialog);
    await expect(dialog).toHaveCount(0);
    const [intent] = await intents(page);
    expect(intent.passport.area).toEqual({
      label: "Парк Горького",
      center: [37.6, 55.73],
      radiusM: 1000,
    });
  });
}

test("with the maps switched off the form says so and the area is found by name", async ({
  page,
}) => {
  await useMap(maps.off);
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  await expect(dialog).toContainText("Карты на сайте отключены");
  await expect(mapButton(dialog)).toHaveCount(0);
  await pickPlace(dialog, "сокол", "Сокольники");
  await expect(searchBox(dialog)).toHaveValue("");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  expect((await intents(page))[0].passport.area.label).toBe("Сокольники");
});
