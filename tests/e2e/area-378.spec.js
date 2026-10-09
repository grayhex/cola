import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import {
  areaName,
  chosenArea,
  pickPlace,
  searchBox,
  showSearch,
} from "../fixtures/ride-area.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #378: the «Где» block of an intent is compact — a search or a chip with the
// radius, «Изменить место», «Переименовать» and a cross, the map under them,
// the explanations behind an «i» — and the pickers of the passport open over
// the form they were opened from, in the middle of the window.
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function register(request) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Area 378 Rider",
      email: randomUUID() + "@example.test",
      password: "area-378-secret-123",
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
  const dialog = page.getByRole("dialog", {
    name: "Новое намерение",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
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
const box = async (locator) => {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found;
};
test.beforeEach(async ({ page }) => {
  // The basemap needs no network here: the picker draws its circle over it.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await register(page.request);
});

test("the area of an intent is compact: search, chip, change, rename, take the map off, clear", async ({
  page,
}) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  // Nothing chosen: one way in — a search, the position, the map. No empty
  // editor of the name, no paragraphs of explanation in the form.
  await expect(searchBox(dialog)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Использовать моё местоположение" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Отметить область на карте" }),
  ).toBeVisible();
  await expect(chosenArea(dialog)).toHaveCount(0);
  await expect(dialog.getByLabel("Название области")).toHaveCount(0);
  await expect(
    dialog.getByText("Приблизительный район или парк", { exact: false }),
  ).toBeHidden();
  await expect(
    dialog.getByText("Центр округляется", { exact: false }),
  ).toBeHidden();

  // A question: the results, and still no area.
  await searchBox(dialog).fill("сокол");
  const found = dialog.getByRole("list", { name: "Найденные места" });
  await expect(
    found.getByRole("button", { name: /^Сокольники/ }),
  ).toBeVisible();
  await expect(chosenArea(dialog)).toHaveCount(0);
  await found.getByRole("button", { name: /^Сокольники/ }).click();

  // Chosen: the chip says it in a line, the radius is beside it, and neither
  // the search nor a second field of the name takes the room.
  const area = chosenArea(dialog);
  await expect(area).toContainText("Сокольники · 2 км");
  await expect(area.getByLabel("Радиус")).toHaveValue("2");
  await expect(searchBox(dialog)).toHaveCount(0);
  await expect(areaName(dialog)).toHaveCount(0);
  await expect(area.getByRole("application")).toBeVisible();

  // «Изменить место»: the search is back and the area stays until another place
  // is picked; «Отмена» leaves it as it was.
  await area.getByRole("button", { name: "Изменить место" }).click();
  await expect(searchBox(dialog)).toBeFocused();
  await searchBox(dialog).fill("коломен");
  await expect(
    found.getByRole("button", { name: /^Коломенское/ }),
  ).toBeVisible();
  await expect(area).toContainText("Сокольники · 2 км");
  await dialog.getByRole("button", { name: "Не менять", exact: true }).click();
  await expect(searchBox(dialog)).toHaveCount(0);
  await expect(area).toContainText("Сокольники · 2 км");
  await expect(dialog).toBeVisible();

  // The name is edited in place; Enter settles it and does not send the form.
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/ride-intents")
    )
      sent++;
  });
  await area.getByRole("button", { name: "Переименовать" }).click();
  await expect(areaName(dialog)).toBeFocused();
  await expect(areaName(dialog)).toHaveValue("Сокольники");
  await areaName(dialog).fill("Мой парк");
  await page.keyboard.press("Enter");
  await expect(areaName(dialog)).toHaveCount(0);
  await expect(area).toContainText("Мой парк · 2 км");
  await expect(dialog).toBeVisible();
  expect(sent).toBe(0);

  // Taking the selection off the map keeps the name and drops the centre and
  // the radius; the control is not there when there is nothing to take off.
  const takeOff = area.getByRole("button", { name: "Снять выделение с карты" });
  await expect(takeOff).toBeVisible();
  await takeOff.click();
  await expect(area).toContainText("Мой парк · без карты");
  await expect(area.getByLabel("Радиус")).toHaveCount(0);
  await expect(takeOff).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // The cross clears the whole area and only it: the first mode is back, the
  // window and what was typed in it stay.
  await area.getByRole("button", { name: "Очистить область" }).click();
  await expect(chosenArea(dialog)).toHaveCount(0);
  await expect(searchBox(dialog)).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Окно 1: с", { exact: true })).not.toHaveValue(
    "",
  );
  // A required area is asked for again, at the search.
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Укажите район или парк",
  );
  await expect(searchBox(dialog)).toBeFocused();
  expect(sent).toBe(0);
});

test("an area from the position is not the form's until it is named and confirmed; saving does not keep the old one in its place", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ longitude: 37.61734, latitude: 55.75581 });
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  await pickPlace(dialog, "сокол", "Сокольники");
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/ride-intents")
    )
      sent++;
  });
  await (await showSearch(dialog)).waitFor();
  await dialog
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  const pending = dialog.getByRole("group", {
    name: "Область по вашему положению",
  });
  await expect(pending).toBeVisible();
  // The reason stands beside the field, and the field has the focus.
  const name = pending.getByLabel("Название области");
  await expect(name).toBeFocused();
  await expect(pending).toContainText("Укажите название района или парка");

  // Left empty it says so at the field, and the form is not sent (the field is
  // required: the browser keeps it).
  await page.keyboard.press("Tab");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(pending).toContainText("Назовите область: подпись обязательна");
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(name).toBeFocused();
  expect(sent).toBe(0);

  // Named but not confirmed it is still a proposal: saving does not take the
  // old area in its place in silence, the form says what is left to do and
  // goes to the field.
  await name.fill("Рядом с домом");
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Подтвердите область по вашему положению",
  );
  await expect(name).toBeFocused();
  expect(sent).toBe(0);

  // Confirmed, it is the area, and that is what is saved.
  await pending
    .getByRole("button", { name: "Использовать эту область" })
    .click();
  await expect(pending).toHaveCount(0);
  await expect(chosenArea(dialog)).toContainText("Рядом с домом · 3 км");
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog).toHaveCount(0);
  const [intent] = (await (await page.request.get("/api/ride-intents")).json())
    .items;
  expect(intent.passport.area.label).toBe("Рядом с домом");
  expect(intent.passport.area.center).toEqual([37.62, 55.76]);
});

test("the hints behind «i»: hover, keyboard focus and tap open them; Escape closes only the hint; they do not grow the form", async ({
  page,
  isMobile,
}) => {
  const dialog = await open(page);
  const tip = dialog.getByRole("button", { name: "Подробнее: поиск места" });
  const text = dialog.getByRole("tooltip").filter({
    hasText: "Приблизительный район или парк, без домашнего адреса.",
  });
  await expect(tip).toBeVisible();
  await expect(text).toBeHidden();
  // The text is the description of the button: a screen reader has it without
  // opening anything.
  await expect(tip).toHaveAccessibleDescription(
    /Приблизительный район или парк, без домашнего адреса\./,
  );
  const before = await dialog.evaluate((el) => el.scrollHeight);
  const frame = page.viewportSize();

  if (isMobile) {
    await tip.tap();
    await expect(text).toBeVisible();
    // A tap elsewhere closes it.
    await dialog.getByRole("heading", { name: "Новое намерение" }).tap();
    await expect(text).toBeHidden();
    await tip.tap();
    await expect(text).toBeVisible();
    await tip.tap();
    await expect(text).toBeHidden();
    await tip.tap();
  } else {
    // A mouse: it opens on hover and goes when the pointer leaves.
    await tip.hover();
    await expect(text).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(text).toBeHidden();
    // The keyboard focus opens it.
    await searchBox(dialog).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(tip).toBeFocused();
    await expect(text).toBeVisible();
    // Escape closes the hint and leaves the window.
    await page.keyboard.press("Escape");
    await expect(text).toBeHidden();
    await expect(dialog).toBeVisible();
    await tip.click();
    await expect(text).toBeVisible();
    await tip.click();
    await expect(text).toBeHidden();
    await page.mouse.move(2, 2);
    await tip.hover();
  }
  await expect(text).toBeVisible();
  // It floats over the form: neither the form nor the page got taller, and the
  // hint is wholly inside the window.
  expect(await dialog.evaluate((el) => el.scrollHeight)).toBe(before);
  const bubble = await box(text);
  expect(bubble.x).toBeGreaterThanOrEqual(0);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(frame.width);
  expect(bubble.y).toBeGreaterThanOrEqual(0);
  expect(bubble.y + bubble.height).toBeLessThanOrEqual(frame.height);
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(await pageOverflow(page)).toBeNull();
});

// #382: a hint is read, not caught. It stays while the pointer or the focus is
// on the icon or on the hint, neither a scroll of something else, nor the
// window being resized, nor the form being updated closes it, and only a
// press of the icon, a press elsewhere or Escape does.
test("a hint stays open while it is read: no timer, the pointer may go to its text, other scrolls and resizes do not close it, only the icon, a press elsewhere or Escape do", async ({
  page,
  isMobile,
}) => {
  const dialog = await open(page);
  const tip = dialog.getByRole("button", { name: "Подробнее: поиск места" });
  const text = dialog.getByRole("tooltip").filter({
    hasText: "Приблизительный район или парк, без домашнего адреса.",
  });
  const heading = dialog.getByRole("heading", { name: "Новое намерение" });
  // The text is read for five seconds without a move of the pointer.
  const stays = async (ms = 5000) => {
    await page.waitForTimeout(ms);
    await expect(text).toBeVisible();
  };
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") sent++;
  });
  if (isMobile) {
    await tip.tap();
    await stays();
    // A tap on the text of the hint keeps it.
    await text.tap();
    await expect(text).toBeVisible();
    // A scroll of something that is not the icon's box and a resize keep it.
    await heading.evaluate((el) => el.dispatchEvent(new Event("scroll")));
    await page.setViewportSize({
      width: page.viewportSize().width,
      height: page.viewportSize().height - 40,
    });
    await stays(500);
    await tip.tap();
    await expect(text).toBeHidden();
  } else {
    // The pointer stays on the icon.
    await tip.hover();
    await stays();
    // It goes over the gap to the text, slowly and fast, and the text stays.
    const icon = await box(tip);
    const bubble = await box(text);
    await page.mouse.move(
      icon.x + icon.width / 2,
      bubble.y + bubble.height / 2,
      { steps: 12 },
    );
    await stays(1500);
    // Pressing the text pins it: the pointer may leave and it is still there.
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await stays(1500);
    // Escape closes the hint with the pointer and the focus elsewhere, and
    // not the window.
    await page.keyboard.press("Escape");
    await expect(text).toBeHidden();
    await expect(dialog).toBeVisible();
    // Open again by the keyboard: the focus on the icon keeps it open, a
    // scroll of something else and a resize of the window do not close it.
    await searchBox(dialog).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(tip).toBeFocused();
    await stays();
    await heading.evaluate((el) => el.dispatchEvent(new Event("scroll")));
    await page.setViewportSize({
      width: page.viewportSize().width,
      height: page.viewportSize().height - 40,
    });
    await stays(500);
    // The hint is still inside the window after the resize.
    const frame = page.viewportSize();
    const again = await box(text);
    expect(again.x).toBeGreaterThanOrEqual(0);
    expect(again.x + again.width).toBeLessThanOrEqual(frame.width);
    expect(again.y + again.height).toBeLessThanOrEqual(frame.height);
    // Leaving the icon by the keyboard closes it.
    await page.keyboard.press("Tab");
    await expect(text).toBeHidden();
  }
  expect(sent).toBe(0);
  await expect(dialog).toBeVisible();
});

test("a picker opens in the middle of the window over its form, closes alone, returns the focus and does not send the form", async ({
  page,
  isMobile,
}) => {
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/ride-intents")
    )
      sent++;
  });
  const tile = (label) => dialog.getByRole("button", { name: label });
  const centered = async (picker) => {
    // The opening movement of the sheet is over before it is measured.
    await page.evaluate(() =>
      Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => null)),
      ),
    );
    const parent = await box(dialog);
    const child = await box(picker);
    const frame = page.viewportSize();
    // Inside the window, not bigger than a set of options, and in its middle.
    expect(child.width).toBeLessThanOrEqual(420);
    expect(child.width).toBeLessThan(parent.width / 2);
    expect(child.x).toBeGreaterThanOrEqual(0);
    expect(child.x + child.width).toBeLessThanOrEqual(frame.width);
    expect(child.y).toBeGreaterThanOrEqual(0);
    expect(child.y + child.height).toBeLessThanOrEqual(frame.height);
    expect(
      Math.abs(child.x + child.width / 2 - (parent.x + parent.width / 2)),
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(child.y + child.height / 2 - frame.height / 2),
    ).toBeLessThanOrEqual(3);
    expect(child.y).toBeGreaterThan(parent.y);
    expect(child.y + child.height).toBeLessThan(parent.y + parent.height);
  };
  for (const [label, title] of [
    ["Темп", "Темп поездки"],
    ["Покрытие", "Покрытие"],
    ["Компания", "Размер компании, чел."],
  ]) {
    await tile(new RegExp("^" + label + ":")).click();
    const picker = page.getByRole("dialog", { name: title });
    await expect(picker).toBeVisible();
    if (isMobile) {
      // A bottom sheet within the screen (its opening movement is over first).
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((a) => a.finished.catch(() => null)),
        ),
      );
      const child = await box(picker);
      const frame = page.viewportSize();
      expect(child.x).toBeGreaterThanOrEqual(0);
      expect(child.x + child.width).toBeLessThanOrEqual(frame.width);
      expect(child.y + child.height).toBeLessThanOrEqual(frame.height + 1);
    } else {
      await centered(picker);
    }
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    // Only it closed: the form is there, and the tile has the focus again.
    await expect(dialog).toBeVisible();
    await expect(tile(new RegExp("^" + label + ":"))).toBeFocused();
  }

  if (!isMobile) {
    // After the form was scrolled and the window resized the picker is still
    // in the middle of what is seen.
    await dialog.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.setViewportSize({ width: 1100, height: 720 });
    await tile(/^Темп:/).click();
    await centered(page.getByRole("dialog", { name: "Темп поездки" }));
    // A press on the backdrop of the picker closes it alone.
    await page.mouse.click(8, 8);
    await expect(
      page.getByRole("dialog", { name: "Темп поездки" }),
    ).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(tile(/^Темп:/)).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // The choice fills its tile and closes the picker; Enter in a range applies
  // it there and does not send the intent.
  await tile(/^Темп:/).click();
  await page
    .getByRole("dialog", { name: "Темп поездки" })
    .getByRole("button", { name: "Умеренный", exact: true })
    .click();
  await expect(tile(/^Темп: Умеренный/)).toBeVisible();
  await tile(/^Дистанция:/).click();
  const range = page.getByRole("dialog", { name: "Дистанция, км" });
  await range.getByLabel("Дистанция, км: от").fill("30");
  await range.getByLabel("Дистанция, км: от").press("Enter");
  // One border is not enough; the picker stays and says so.
  await expect(range.getByRole("alert")).toContainText("Укажите обе границы");
  await expect(dialog).toBeVisible();
  await range.getByLabel("Дистанция, км: до").fill("60");
  await range.getByLabel("Дистанция, км: до").press("Enter");
  await expect(range).toHaveCount(0);
  await expect(tile(/^Дистанция: 30–60 км/)).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(sent).toBe(0);
});

test("the other sheets of the site stay where they were: the filters open under the header at the right", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a bottom sheet on the phone, covered above");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/bikes");
  await page.getByRole("button", { name: "Фильтры" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Фильтры" });
  await expect(sheet).toBeVisible();
  const found = await box(sheet);
  expect(found.y).toBeLessThan(120);
  expect(found.x + found.width).toBeGreaterThan(1440 - 60);
  expect(found.x).toBeGreaterThan(1440 / 2);
});

test("a position that the device has not answered yet is not skipped: saving waits for it and does not take the old area in its place", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"], { origin });
  await context.setGeolocation({ longitude: 37.61734, latitude: 55.75581 });
  const dialog = await open(page);
  await windowAndPurpose(page, dialog);
  await pickPlace(dialog, "сокол", "Сокольники");
  // The device answers late: the request is held until the test lets it go.
  await page.evaluate(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(
      navigator.geolocation,
    );
    navigator.geolocation.getCurrentPosition = (done, fail, options) => {
      window.__answer = () => original(done, fail, options);
    };
  });
  let sent = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/ride-intents")
    )
      sent++;
  });
  await (await showSearch(dialog)).waitFor();
  const locate = dialog.getByRole("button", {
    name: "Использовать моё местоположение",
  });
  await locate.click();
  await expect(locate).toHaveAttribute("aria-busy", "true");

  // Saving while it is out: the form says what it waits for, and keeps the
  // window; the old area is not saved in silence.
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Определяем местоположение",
  );
  await expect(dialog).toBeVisible();
  expect(sent).toBe(0);

  // The device answers: it is a proposal like any other, named and confirmed.
  await page.evaluate(() => window.__answer());
  const pending = dialog.getByRole("group", {
    name: "Область по вашему положению",
  });
  await expect(pending).toBeVisible();
  await pending.getByLabel("Название области").fill("Рядом с домом");
  await pending
    .getByRole("button", { name: "Использовать эту область" })
    .click();
  await dialog.getByRole("button", { name: "Сохранить намерение" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toBe(1);
  const [intent] = (await (await page.request.get("/api/ride-intents")).json())
    .items;
  expect(intent.passport.area.label).toBe("Рядом с домом");
});
