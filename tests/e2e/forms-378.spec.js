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
async function intentForm(page, touch = false) {
  await page.goto("/ride-intents");
  await expect(
    page.getByText("Пока нет намерений.", { exact: false }),
  ).toBeVisible();
  const opener = page.getByRole("button", {
    name: "Выбрать время",
    exact: true,
  });
  if (touch) await opener.tap();
  else await opener.click();
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

test("four intent windows and advanced fields remain reachable at desktop reflow and a small phone viewport", async ({
  page,
}) => {
  await member(page);
  await page.request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Asia/Yekaterinburg" } },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // CSS viewport at 200% of 1440×900, then a small 360px viewport (no OS keyboard).
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
    await expect(advanced).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.locator("details.intent-advanced")).toHaveAttribute(
      "open",
      "",
    );
    await expect(
      dialog.getByRole("combobox", {
        name: "Готовность знакомиться",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Готовность знакомиться", exact: true })
      .selectOption("true");
    await advanced.click();
    await advanced.click();
    await expect(
      dialog.getByRole("combobox", {
        name: "Готовность знакомиться",
        exact: true,
      }),
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

// #406: the native control's own box must fit, not only the document width.
async function nativeGeometry(dialog) {
  const boxes = await dialog
    .locator('input:is([type="date"],[type="time"],[type="datetime-local"])')
    .evaluateAll((inputs) =>
      inputs.map((input) => {
        const b = input.getBoundingClientRect(),
          label = input.closest("label").getBoundingClientRect();
        const card =
          input.closest('[class*="windowTimes"]')?.parentElement ||
          input.closest("fieldset");
        const c = card.getBoundingClientRect(),
          s = getComputedStyle(card);
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          labelLeft: label.left,
          labelRight: label.right,
          cardLeft: c.left + parseFloat(s.paddingLeft),
          cardRight: c.right - parseFloat(s.paddingRight),
        };
      }),
    );
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(b.labelLeft - 1);
    expect(b.right).toBeLessThanOrEqual(b.labelRight + 1);
    expect(b.left).toBeGreaterThanOrEqual(b.cardLeft - 1);
    expect(b.right).toBeLessThanOrEqual(b.cardRight + 1);
  }
  for (let i = 0; i < boxes.length; i++)
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i];
      expect(
        a.right <= b.left - 7 ||
          b.right <= a.left - 7 ||
          a.bottom <= b.top - 7 ||
          b.bottom <= a.top - 7,
      ).toBe(true);
    }
}

test.describe("native controls on touch screens", () => {
  test.use({ hasTouch: true });
  for (const width of [320, 360, 393, 430])
    test(`native date/time at ${width}: empty/filled, four windows, enlarged text and compact actions`, async ({
      page,
    }, info) => {
      await member(page);
      await bike(page);
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: width === 393 ? "dark" : "light",
      });
      await page.setViewportSize({ width, height: 800 });
      const intent = await intentForm(page, true);
      await expect(intent.getByRole("tooltip")).toBeHidden();
      await expect(intent.locator(".modal-head h2")).toBeFocused();
      const help = intent.getByRole("button", {
        name: "Подробнее: Намерение",
        exact: true,
      });
      await help.tap();
      await expect(intent.getByRole("tooltip")).toBeVisible();
      await help.tap();
      await expect(intent.getByRole("tooltip")).toBeHidden();
      await nativeGeometry(intent);
      for (let i = 1; i <= 4; i++) {
        if (i > 1)
          await intent
            .getByRole("button", { name: "Добавить окно", exact: true })
            .click();
        await intent
          .getByLabel(`Окно ${i}: с`, { exact: true })
          .fill("2026-12-10T10:00");
        await intent
          .getByLabel(`Окно ${i}: до`, { exact: true })
          .fill("2026-12-10T15:00");
      }
      await nativeGeometry(intent);
      await page.evaluate(() => {
        for (const [token, value] of [
          ["--text-sm", "20px"],
          ["--text-base", "22px"],
          ["--field-font-size", "22px"],
        ])
          document.documentElement.style.setProperty(token, value);
      });
      await nativeGeometry(intent);
      await page.setViewportSize({ width, height: 280 });
      await help.tap();
      const tip = await intent.getByRole("tooltip").boundingBox();
      expect(tip.x).toBeGreaterThanOrEqual(7);
      expect(tip.x + tip.width).toBeLessThanOrEqual(width - 7);
      expect(tip.y).toBeGreaterThanOrEqual(7);
      expect(tip.y + tip.height).toBeLessThanOrEqual(273);
      await page.keyboard.press("Escape");
      await expect(intent).toBeVisible();
      const last = intent.getByLabel("Окно 4: до", { exact: true });
      await last.focus();
      expect(
        (await last.boundingBox()).y + (await last.boundingBox()).height,
      ).toBeLessThanOrEqual(
        (await intent.locator(".planning-actions").boundingBox()).y + 1,
      );
      await page.setViewportSize({ width, height: 800 });
      await page.screenshot({
        path: info.outputPath(`intent-native-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Закрыть форму", exact: true })
        .click();
      // Reopening by a pointer must still leave help closed and focus on title.
      await page
        .getByRole("button", { name: "Выбрать время", exact: true })
        .tap();
      await expect(page.getByRole("dialog").getByRole("tooltip")).toBeHidden();
      await expect(page.locator("dialog .modal-head h2")).toBeFocused();
      await page.keyboard.press("Escape");
      const plan = await organizerForm(page);
      await nativeGeometry(plan);
      await plan.getByLabel("Дата", { exact: true }).fill("2026-12-10");
      await plan.getByLabel("Старт", { exact: true }).fill("10:00");
      await plan.getByLabel("Окончание", { exact: true }).fill("15:00");
      await nativeGeometry(plan);
      const date = await plan.getByLabel("Дата", { exact: true }).boundingBox();
      const start = await plan
        .getByLabel("Старт", { exact: true })
        .boundingBox();
      expect(start.y).toBeGreaterThan(date.y + date.height);
      const meeting = plan.getByRole("checkbox", {
        name: "Место определим вместе",
      });
      const label = meeting.locator("..");
      expect((await label.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await label.click();
      await expect(meeting).toBeChecked();
      // Enlarge the semantic font tokens, rather than claim OS text scaling.
      await page.evaluate(() => {
        for (const [token, value] of [
          ["--text-sm", "20px"],
          ["--text-base", "22px"],
          ["--field-font-size", "22px"],
        ])
          document.documentElement.style.setProperty(token, value);
      });
      await nativeGeometry(plan);
      const submit = plan.getByRole("button", {
        name: "Создать покатушку",
        exact: true,
      });
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport();
      expect(await pageOverflow(page)).toBeNull();
      await page.screenshot({
        path: info.outputPath(`plan-native-${width}-large-text.png`),
      });
    });
});
