import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import {
  areaName,
  chosenArea,
  nameArea,
  pickPlace,
  searchBox,
} from "../fixtures/ride-area.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #370: the area of an intent is one chosen thing — a name, a centre and a
// radius that describe one place — found by name, marked on the map or taken
// around the device's position, and confirmed. What is typed in the search is
// a question; it never renames the chosen area or leaves an old circle under
// a new name. Where the search, the map or the position is not there, the area
// is named by hand and the form is kept.
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function register(request, name = "Area Rider") {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "ride-area-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const zone = await request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
  expect(zone.status()).toBe(200);
}
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
test.beforeEach(async ({ page }) => {
  // The basemap needs no network here: the picker draws its circle over it.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await register(page.request);
});

test("a place found by name sets the name, the centre and the radius together; a new question changes nothing until a place is picked", async ({
  page,
}, info) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  const asked = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/geocode")) asked.push(new URL(r.url()));
  });
  // No question goes out before something is typed, and typing quickly asks once.
  await page.waitForTimeout(500);
  expect(asked).toHaveLength(0);
  await expect(searchBox(dialog)).toHaveValue("");
  await expect(chosenArea(dialog)).toHaveCount(0);
  await searchBox(dialog).pressSequentially("измайл");
  const found = dialog.getByRole("list", { name: "Найденные места" });
  await expect(found.getByRole("button")).toHaveCount(1);
  await expect(found).toContainText("Измайловский парк");
  await expect(found).toContainText("Москва, Россия");
  expect(asked).toHaveLength(1);
  expect(asked[0].searchParams.get("q")).toBe("измайл");
  await found.getByRole("button", { name: /^Измайловский парк/ }).click();

  // One area: the name, the radius of the place's size, a map with its circle.
  await expect(areaName(dialog)).toHaveValue("Измайловский парк");
  await expect(radius(dialog)).toHaveValue("3");
  await expect(chosenArea(dialog)).toContainText(
    "Измайловский парк · радиус 3 км",
  );
  await expect(chosenArea(dialog).getByRole("application")).toBeVisible();
  await expect(searchBox(dialog)).toHaveValue("");
  await expect(found).toHaveCount(0);

  // A new question is a question: the chosen area stays as it was.
  await searchBox(dialog).fill("сокол");
  await expect(
    found.getByRole("button", { name: /^Сокольники/ }),
  ).toBeVisible();
  await expect(areaName(dialog)).toHaveValue("Измайловский парк");
  await expect(radius(dialog)).toHaveValue("3");
  await expect(chosenArea(dialog)).toContainText(
    "Измайловский парк · радиус 3 км",
  );
  await page.screenshot({
    path: info.outputPath("area-search.png"),
    animations: "disabled",
  });
  // Until it is picked, then the whole area changes at once.
  await found.getByRole("button", { name: /^Сокольники/ }).click();
  await expect(areaName(dialog)).toHaveValue("Сокольники");
  await expect(chosenArea(dialog)).toContainText("Сокольники · радиус 2 км");
  // The radius is the person's to refine; the name, the circle stay together.
  await radius(dialog).selectOption("5");
  await expect(chosenArea(dialog)).toContainText("Сокольники · радиус 5 км");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  let [intent] = await intents(page);
  expect(intent.passport.area).toEqual({
    label: "Сокольники",
    center: [37.67, 55.79],
    radiusM: 5000,
  });

  // Opened again for an edit, it is the same area; a new place replaces all of it.
  const card = page.locator(`[data-intent-id="${intent.id}"]`);
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Изменить намерение" });
  await expect(areaName(editor)).toHaveValue("Сокольники");
  await expect(radius(editor)).toHaveValue("5");
  await pickPlace(editor, "коломен", "Коломенское");
  await expect(areaName(editor)).toHaveValue("Коломенское");
  await editor.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(editor).toHaveCount(0);
  [intent] = await intents(page);
  expect(intent.passport.area).toEqual({
    label: "Коломенское",
    center: [37.67, 55.67],
    radiusM: 2000,
  });
});

test("an area is needed, a name is needed, and removing it removes the circle with the name", async ({
  page,
}) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  // No area: the form says so and is kept.
  await save(dialog);
  await expect(dialog.getByRole("alert")).toContainText(
    "Укажите район или парк",
  );
  await expect(dialog).toBeVisible();
  await pickPlace(dialog, "парк горь", "Парк Горького");
  // The name is the area's own and may be edited; the circle stays with it.
  await areaName(dialog).fill("Мой парк");
  await expect(chosenArea(dialog)).toContainText("Мой парк · радиус 1 км");
  // A name that is nothing leaves an area that cannot be saved, said at the field.
  await areaName(dialog).fill("");
  await expect(chosenArea(dialog)).toContainText("Назовите область");
  await dialog
    .getByRole("button", { name: "Сохранить намерение" })
    .click({ force: true });
  await expect(dialog).toBeVisible();
  await areaName(dialog).fill("Мой парк");
  // Removing the area takes the name and the circle, together.
  await chosenArea(dialog)
    .getByRole("button", { name: "Убрать область" })
    .click();
  await expect(chosenArea(dialog)).toHaveCount(0);
  await expect(dialog.getByRole("application")).toHaveCount(0);
  await save(dialog);
  await expect(dialog.getByRole("alert")).toContainText(
    "Укажите район или парк",
  );
  expect(await intents(page)).toHaveLength(0);
});

test("the search says when there is nothing, and when it is off or fails; the area is named by hand and the form is kept", async ({
  page,
}) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  // Nothing found.
  await searchBox(dialog).fill("несуществующее место");
  await expect(dialog.getByText("Ничего не найдено")).toBeVisible();
  // The service fails (the test list fails on one word).
  await searchBox(dialog).fill("сбой поиска");
  await expect(
    dialog.getByText("Поиск мест временно недоступен"),
  ).toBeVisible();
  // Off on this site: said once, and not asked again key after key.
  let asked = 0;
  await page.route("**/api/geocode?**", (route) => {
    asked++;
    return route.fulfill({
      status: 503,
      json: { error: "Поиск мест не настроен" },
    });
  });
  await searchBox(dialog).fill("парк");
  await expect(dialog.getByText("Поиск мест не настроен")).toBeVisible();
  await searchBox(dialog).fill("парки");
  await searchBox(dialog).fill("парк победы");
  await page.waitForTimeout(700);
  expect(asked).toBe(1);
  // By hand: what is typed is taken as the name only when the person says so.
  await expect(chosenArea(dialog)).toHaveCount(0);
  await dialog
    .getByRole("button", {
      name: "Использовать «парк победы» как подпись без карты",
    })
    .click();
  await expect(areaName(dialog)).toHaveValue("парк победы");
  await expect(chosenArea(dialog)).toContainText("Без привязки к карте");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  const [intent] = await intents(page);
  expect(intent.passport.area).toEqual({ label: "парк победы" });
});

test("around my position: asked only by a click, a rounded centre, named and confirmed before it counts; a refusal keeps the form", async ({
  page,
  context,
}, info) => {
  let asked = 0;
  await page.exposeFunction("positionAsked", () => asked++);
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(
      navigator.geolocation,
    );
    navigator.geolocation.getCurrentPosition = (...args) => {
      window.positionAsked();
      return original(...args);
    };
  });
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ longitude: 37.61734, latitude: 55.75581 });
  const nearby = async () =>
    (await page.request.get("/api/v1/me/nearby")).text();
  const nearbyBefore = await nearby();
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  // Nothing asks for the position until the button is pressed.
  await page.waitForTimeout(300);
  expect(asked).toBe(0);
  await dialog
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  const pending = dialog.getByRole("group", {
    name: "Область по вашему положению",
  });
  await expect(pending).toBeVisible();
  expect(asked).toBe(1);
  // It is a proposal: not the area yet, and it needs a name.
  await expect(chosenArea(dialog)).toHaveCount(0);
  const use = pending.getByRole("button", { name: "Использовать эту область" });
  await expect(use).toBeDisabled();
  await expect(pending.getByRole("application")).toBeVisible();
  await pending.getByLabel("Радиус").selectOption("5");
  await pending.getByLabel("Название области").fill("Рядом с домом");
  await expect(use).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("area-position.png"),
    animations: "disabled",
  });
  await use.click();
  await expect(pending).toHaveCount(0);
  await expect(areaName(dialog)).toHaveValue("Рядом с домом");
  await expect(chosenArea(dialog)).toContainText("Рядом с домом · радиус 5 км");
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  const [intent] = await intents(page);
  // A coarse centre only: the position that the device gave is not kept.
  expect(intent.passport.area).toEqual({
    label: "Рядом с домом",
    center: [37.62, 55.76],
    radiusM: 5000,
  });
  const everything = JSON.stringify(await intents(page));
  expect(everything).not.toContain("37.617");
  expect(everything).not.toContain("55.755");
  // The private «near me» settings are another thing: nothing in them changed.
  expect(await nearby()).toBe(nearbyBefore);

  // A cancelled proposal changes nothing; a refusal says so and keeps the form.
  await page
    .locator(`[data-intent-id="${intent.id}"]`)
    .getByRole("button", { name: "Изменить", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Изменить намерение" });
  await editor
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  await editor
    .getByRole("group", { name: "Область по вашему положению" })
    .getByRole("button", { name: "Отмена" })
    .click();
  await expect(areaName(editor)).toHaveValue("Рядом с домом");
  // A refusal, as the browser says it: code 1, PERMISSION_DENIED.
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (_done, fail) =>
      fail({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
  });
  await editor
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  await expect(
    editor
      .getByRole("status")
      .filter({ hasText: "Доступ к местоположению не получен" }),
  ).toBeVisible();
  await expect(areaName(editor)).toHaveValue("Рядом с домом");
  await expect(editor.getByLabel("Окно 1: с", { exact: true })).not.toHaveValue(
    "",
  );
  // The way by hand is still open.
  await pickPlace(editor, "парк побед", "Парк Победы");
  await expect(areaName(editor)).toHaveValue("Парк Победы");
});

test("visibility is in view: a new intent is for the community, an existing private one stays private", async ({
  page,
}) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  await nameArea(dialog, "Видимость");
  // Not folded away: «Дополнительно» holds the rest and says nothing more.
  const community = dialog.getByLabel("Сообществу ColaBike", { exact: true });
  await expect(community).toBeVisible();
  await expect(community).toBeChecked();
  await expect(dialog.locator("details.intent-advanced > summary")).toHaveText(
    "Дополнительно",
  );
  await save(dialog);
  await expect(dialog).toHaveCount(0);
  const [created] = await intents(page);
  expect(created.visibility).toBe("community");

  // A private intent made earlier (by the API) is edited without being published.
  const private_ = await page.request.post("/api/ride-intents", {
    headers: { origin },
    data: {
      readiness: "ready",
      timeZone: "Europe/Moscow",
      windows: [
        { startLocal: date(2) + "T10:00", endLocal: date(2) + "T15:00" },
      ],
      passport: { area: { label: "Закрытое" }, purpose: "social" },
      visibility: "private",
      requestId: randomUUID(),
    },
  });
  expect(private_.status()).toBe(201);
  await page.reload();
  const id = (await private_.json()).intent.id;
  await page
    .locator(`[data-intent-id="${id}"]`)
    .getByRole("button", { name: "Изменить", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Изменить намерение" });
  await expect(
    editor.getByLabel("Только мне — для подбора", { exact: true }),
  ).toBeChecked();
  await expect(
    editor.getByLabel("Сообществу ColaBike", { exact: true }),
  ).not.toBeChecked();
  await editor.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(editor).toHaveCount(0);
  const stored = (await intents(page)).find((i) => i.id === id);
  expect(stored.visibility).toBe("private");
  // An old client that leaves the field out is never published by it.
  const bare = await page.request.post("/api/ride-intents", {
    headers: { origin },
    data: {
      readiness: "ready",
      timeZone: "Europe/Moscow",
      windows: [
        { startLocal: date(3) + "T10:00", endLocal: date(3) + "T15:00" },
      ],
      passport: { area: { label: "Без поля" }, purpose: "social" },
      requestId: randomUUID(),
    },
  });
  expect(bare.status()).toBe(201);
  expect((await bare.json()).intent.visibility).toBe("private");
});

test("a record with a name only still opens, edits and saves; the map can be added to it", async ({
  page,
}) => {
  const made = await page.request.post("/api/ride-intents", {
    headers: { origin },
    data: {
      readiness: "ready",
      timeZone: "Europe/Moscow",
      windows: [
        { startLocal: date(2) + "T10:00", endLocal: date(2) + "T15:00" },
      ],
      passport: { area: { label: "Старый парк" }, purpose: "social" },
      visibility: "community",
      requestId: randomUUID(),
    },
  });
  expect(made.status()).toBe(201);
  const id = (await made.json()).intent.id;
  await page.goto("/ride-intents");
  const card = page.locator(`[data-intent-id="${id}"]`);
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Изменить намерение" });
  await expect(areaName(editor)).toHaveValue("Старый парк");
  await expect(chosenArea(editor)).toContainText("Без привязки к карте");
  // Saved as it is: still no map, nothing invented.
  await editor.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(editor).toHaveCount(0);
  expect((await intents(page)).find((i) => i.id === id).passport.area).toEqual({
    label: "Старый парк",
  });
  // The map is an addition: the centre and the radius come together.
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  await chosenArea(editor)
    .getByRole("button", { name: "Отметить область на карте" })
    .click();
  const map = editor.getByRole("application");
  await map.focus();
  await page.keyboard.press("Enter");
  await expect(chosenArea(editor)).toContainText("Старый парк · радиус 5 км");
  await editor.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(editor).toHaveCount(0);
  const area = (await intents(page)).find((i) => i.id === id).passport.area;
  expect(area.label).toBe("Старый парк");
  expect(area.radiusM).toBe(5000);
  expect(area.center).toHaveLength(2);
});

test("the planner takes the same area; axe and no overflow in both themes", async ({
  page,
}) => {
  const bike = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Area bike",
      brand: "Trek",
      model: "Checkpoint",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    },
  });
  expect(bike.status()).toBe(201);
  await page.goto("/account?tab=rides&action=plan");
  const plan = page.getByRole("dialog", { name: "Организовать покатушку" });
  await expect(plan.getByLabel("Дата", { exact: true })).toBeVisible();
  await plan.getByLabel("Дата", { exact: true }).fill(date(5));
  await plan.getByLabel("Старт", { exact: true }).fill("09:00");
  await plan.getByLabel("Название", { exact: true }).fill("Круг по парку");
  await pickPlace(plan, "парк горь", "Парк Горького");
  await expect(areaName(plan)).toHaveValue("Парк Горького");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    expect(await pageOverflow(page)).toBeNull();
  }
  await plan
    .getByRole("button", { name: "Создать покатушку", exact: true })
    .click();
  await expect(plan).toHaveCount(0);
  const [ride] = (await (await page.request.get("/api/rides?own=1")).json())
    .rides;
  const detail = (
    await (await page.request.get("/api/rides/owner/" + ride.shareId)).json()
  ).ride;
  expect(detail.passport.area).toEqual({
    label: "Парк Горького",
    center: [37.6, 55.73],
    radiusM: 1000,
  });
});
