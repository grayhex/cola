import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #378: the three forms — the new bike's wizard, the intent and the organizer of
// a ride — are about 36 % wider than their former 1120 px on a wide screen and
// use the room: on 1440×900 and 1920×1080 the usual content needs no vertical
// scroll; on a phone they are one column with no sideways scroll.
const wide = [
  [1440, 900],
  [1920, 1080],
];
async function member(page) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Forms " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "forms-378-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  await page.request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
}
async function bike(page) {
  const made = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Forms bike",
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: 9.8,
      is_public: true,
    },
  });
  expect(made.status()).toBe(201);
}
// What the window shows is all there is: nothing is hidden under a scroll.
const needsScroll = (dialog) =>
  dialog.evaluate((d) => {
    const step = d.querySelector(".wizard-content");
    return (
      d.scrollHeight > d.clientHeight + 1 ||
      (!!step && step.scrollHeight > step.clientHeight + 1)
    );
  });
// A window of the form's own, as high as its content: not cut by the viewport.
async function inside(page, dialog) {
  const box = await dialog.boundingBox();
  const { width, height } = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  return box;
}
async function wizardStepTwo(page) {
  await page.goto("/account?tab=bikes&action=add");
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Продолжить вручную" }).click();
  await expect(
    wizard.getByRole("heading", { name: /Сведения и фото/ }),
  ).toBeVisible();
  await wizard.getByLabel("Марка", { exact: true }).fill("Cube");
  await wizard.getByLabel("Модель", { exact: true }).fill("Nuroad");
  await wizard.getByLabel("Год", { exact: true }).fill("2024");
  return wizard;
}
async function intentForm(page) {
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
async function organizerForm(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Организовать покатушку", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Организовать покатушку",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Дата", { exact: true })).toBeVisible();
  return dialog;
}

for (const [width, height] of wide)
  test(`on ${width}×${height} the three forms are wider and need no scroll for their usual content`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the wide screen is the desktop's");
    await member(page);
    await bike(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height });
    // The former limit was 1120 px; the window may use 1520 and never goes
    // past the screen (with the margins of the page).
    const room = Math.min(1520, width - 2 * 24);
    for (const [name, open, columns] of [
      ["wizard step 2", wizardStepTwo, 4],
      ["intent", intentForm, 2],
      ["organizer", organizerForm, 2],
    ]) {
      const dialog = await open(page);
      await page.waitForTimeout(500);
      const box = await inside(page, dialog);
      expect(box.width, name).toBeGreaterThan(1120 * 1.2);
      expect(box.width, name).toBeLessThanOrEqual(room + 1);
      expect(await needsScroll(dialog), name + " needs no scroll").toBe(false);
      // The room is used by columns: sections stand side by side.
      const tops = await dialog
        .locator(
          name === "wizard step 2"
            ? ".wizard-details > .wizard-card, .wizard-details > section"
            : ".planning-side-layout > .planning-side-column",
        )
        .evaluateAll((items) =>
          items
            .filter((item) => item.getBoundingClientRect().height > 0)
            .map((item) => Math.round(item.getBoundingClientRect().top)),
        );
      const first = tops.filter((top) => Math.abs(top - tops[0]) < 8).length;
      expect(first, name + " columns").toBeGreaterThanOrEqual(columns);
      // The main action is on the screen without scrolling.
      const action = dialog
        .getByRole("button", {
          name: /^(Далее|Сохранить намерение|Создать покатушку)$/,
        })
        .first();
      await expect(action, name).toBeInViewport();
      expect(await pageOverflow(page), name).toBeNull();
      expect(
        (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
        name,
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await page.reload();
    }
  });

test("on a phone the three forms are one column, nothing scrolls sideways and the main action is reachable", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone profile");
  await member(page);
  await bike(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { width } = page.viewportSize();
  for (const [name, open] of [
    ["wizard step 2", wizardStepTwo],
    ["intent", intentForm],
    ["organizer", organizerForm],
  ]) {
    const dialog = await open(page);
    await page.waitForTimeout(400);
    const box = await dialog.boundingBox();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(width + 1);
    // One column: the sections stand one under another.
    const lefts = await dialog
      .locator(
        name === "wizard step 2"
          ? ".wizard-details > .wizard-card, .wizard-details > section"
          : ".planning-side-layout > .planning-side-column",
      )
      .evaluateAll((items) =>
        items
          .filter((item) => item.getBoundingClientRect().height > 0)
          .map((item) => Math.round(item.getBoundingClientRect().left)),
      );
    expect(new Set(lefts).size, name).toBe(1);
    expect(await pageOverflow(page), name).toBeNull();
    const action = dialog
      .getByRole("button", {
        name: /^(Далее|Сохранить намерение|Создать покатушку)$/,
      })
      .first();
    await expect(action, name).toBeInViewport();
    await page.keyboard.press("Escape");
    await page.reload();
  }
});

test("four intent windows and advanced fields remain reachable at 200 percent desktop reflow and with a phone keyboard", async ({
  page,
}) => {
  await member(page);
  await page.request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Asia/Yekaterinburg" } },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The CSS viewport at 200% of 1440×900, then a 360px phone with keyboard space.
  for (const viewport of [
    { width: 720, height: 450 },
    { width: 360, height: 420 },
  ]) {
    await page.setViewportSize(viewport);
    const dialog = await intentForm(page);
    const hint = dialog.getByRole("button", {
      name: "Подробнее: Временные окна",
      exact: true,
    });
    await hint.click();
    await expect(dialog.getByRole("tooltip")).toContainText(
      "Asia/Yekaterinburg из профиля",
    );
    await expect(dialog.getByRole("tooltip")).toContainText(
      "до 4 окон по 24 ч",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    for (let i = 1; i < 4; i++)
      await dialog
        .getByRole("button", { name: "Добавить окно", exact: true })
        .click();
    const last = dialog.getByLabel("Окно 4: до", { exact: true });
    await last.focus();
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    const bottom =
      (await last.boundingBox()).y + (await last.boundingBox()).height;
    expect(bottom).toBeLessThanOrEqual(
      (await dialog.locator(".planning-actions").boundingBox()).y + 1,
    );
    const advanced = dialog.locator("summary", { hasText: "Дополнительно" });
    await advanced.focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByLabel("Готовность знакомиться", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("Готовность знакомиться", { exact: true })
      .selectOption("true");
    await advanced.click();
    await advanced.click();
    await expect(
      dialog.getByLabel("Готовность знакомиться", { exact: true }),
    ).toHaveValue("true");
    await expect(
      dialog.getByRole("button", { name: "Сохранить намерение", exact: true }),
    ).toBeInViewport();
    expect(await needsScroll(dialog)).toBe(true);
    expect(await pageOverflow(page)).toBeNull();
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await page.reload();
  }
});
