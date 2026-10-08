import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #366: the actions of the bike page and of the four forms use the shared
// SiteIcon slots: the administrator's colour and emoji reach them, and they
// answer to hover and to the keyboard in the same way as the other icons.
const colors = {
  edit: "#d946ef",
  addPhoto: "#0ea5e9",
  public: "#16a34a",
  private: "#dc2626",
  save: "#ca8a04",
  publish: "#7c3aed",
  next: "#0d9488",
  plan: "#b45309",
  addListing: "#2563eb",
};
async function admin(page) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Icons " + suffix.slice(0, 6),
      email: suffix + "@example.test",
      password: "action-icons-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  await db.end();
  const read = async () =>
    (await page.request.get("/api/admin/overview")).json();
  const original = await read();
  const put = async (patch) => {
    const current = await read();
    const response = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: {
        value: { ...current.settings, ...patch },
        version: current.settingsVersion,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  return { put, original: original.settings };
}
const color = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
// What the shared rule turns the configured colour into, in the page's theme.
const highlight = (page, hex) =>
  page.evaluate((value) => {
    const dark = document.documentElement.dataset.theme === "dark";
    const probe = document.createElement("span");
    probe.style.color = `color-mix(in srgb, ${value} 80%, ${dark ? "#ffffff" : "#182230"})`;
    document.body.append(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  }, hex);
// A button's icon is the slot's own, coloured only when pointed at or focused.
async function reacts(page, button, slot) {
  const icon = button.locator(`.site-icon[data-icon="${slot}"]`);
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("data-highlight", "true");
  await page.mouse.move(0, 0);
  const rest = await color(icon);
  await button.hover();
  await expect
    .poll(() => color(icon))
    .toBe(await highlight(page, colors[slot]));
  expect(rest).not.toBe(await highlight(page, colors[slot]));
  await page.mouse.move(0, 0);
  await expect.poll(() => color(icon)).toBe(rest);
  // The keyboard: focus arrives by Tab from the previous control.
  await button.evaluate((el) => {
    const stops = [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      ),
    ].filter((node) => node.offsetParent !== null || node === el);
    const index = stops.indexOf(el);
    stops[Math.max(0, index - 1)]?.focus();
  });
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect
    .poll(() => color(icon))
    .toBe(await highlight(page, colors[slot]));
}
const slotOf = (scope, slot) =>
  scope.locator(`.site-icon[data-icon="${slot}"]`);

test("bike page: edit, add photo and privacy use the icon slots, colours, emoji and keyboard", async ({
  page,
}, info) => {
  const { put, original } = await admin(page);
  try {
    await put({
      iconColors: colors,
      emojis: { ...original.emojis, addPhoto: "" },
    });
    const created = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Иконки · велосипед",
        brand: "Cube",
        model: "Nuroad",
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/b/" + bike.share_id);
    const tools = page.getByRole("group", { name: "Управление велосипедом" });
    const button = (name) => tools.getByRole("button", { name, exact: true });
    // «Add photo» is in the photo control under the gallery (#370).
    const photos = page.getByRole("group", { name: "Фотографии велосипеда" });
    const addPhoto = photos.getByRole("button", {
      name: "Добавить фото",
      exact: true,
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      await reacts(page, button("Редактировать"), "edit");
      await reacts(page, addPhoto, "addPhoto");
      await reacts(page, button("Приватность"), "public");
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: info.outputPath(`bike-actions-icons-${theme}.png`),
        clip: await tools.boundingBox(),
        animations: "disabled",
      });
      expect(
        (
          await new AxeBuilder({ page })
            .include("[data-bike-actions=owner]")
            .include("[data-photo-control]")
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    // No direct icon of the library is left in the three buttons: each holds
    // exactly one SiteIcon.
    for (const locator of [
      button("Редактировать"),
      addPhoto,
      button("Приватность"),
    ]) {
      await expect(locator.locator("svg")).toHaveCount(1);
      await expect(locator.locator(".site-icon")).toHaveCount(1);
    }

    // The label, the busy state and the access name stay as they were.
    await expect(button("Приватность")).toContainText("Все");
    expect(
      (
        await page.request.patch("/api/bikes/" + id, {
          headers: { origin },
          data: { is_public: false },
        })
      ).status(),
    ).toBeLessThan(300);
    await page.reload();
    await expect(slotOf(button("Приватность"), "private")).toBeVisible();
    await expect(button("Приватность")).toContainText("Только вы");
    await reacts(page, button("Приватность"), "private");

    // An emoji chosen for the slot takes the icon's place and its highlight.
    await put({ emojis: { ...original.emojis, addPhoto: "📸", edit: "🖋️" } });
    await page.reload();
    const photo = slotOf(addPhoto, "addPhoto");
    await expect(photo).toHaveClass(/custom/);
    await expect(photo).toHaveText("📸");
    await expect(photo).toHaveAttribute("aria-hidden", "true");
    await expect(addPhoto).toBeVisible();
    await expect(slotOf(button("Редактировать"), "edit")).toHaveText("🖋️");
    await addPhoto.hover();
    await expect
      .poll(() => photo.evaluate((el) => getComputedStyle(el).boxShadow))
      .not.toBe("none");
    await expect(addPhoto).toBeEnabled();
  } finally {
    await put({ iconColors: original.iconColors, emojis: original.emojis });
  }
});

test("the four forms: the wizard, an ad, an article and a ride carry the slots of their actions", async ({
  page,
}) => {
  const { put, original } = await admin(page);
  try {
    await put({ iconColors: colors });
    await page.emulateMedia({ reducedMotion: "reduce" });
    // A ride belongs to a current bike: the planner needs one.
    expect(
      (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name: "Иконки · планы",
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
        })
      ).status(),
    ).toBe(201);
    // The wizard: search, the steps, adding a photo or a part, saving.
    await page.route("**/api/bikes/resolve-stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            type: "result",
            result: {
              status: "not_found",
              query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
              cached: false,
            },
          }) + "\n",
      }),
    );
    await page.goto("/account?tab=bikes");
    await page
      .getByRole("button", { name: "Добавить велосипед", exact: true })
      .click();
    const wizard = page.getByRole("dialog", { name: "Новый велосипед" });
    const field = wizard.getByLabel("Модель, год и комплектация", {
      exact: true,
    });
    await expect(field).toBeVisible();
    await field.fill("Cube Aim 2020");
    const find = wizard.getByRole("button", { name: /^Найти комплектацию/ });
    await expect(slotOf(find, "search")).toBeVisible();
    await expect(
      slotOf(
        wizard.getByRole("button", {
          name: "Распознать по странице магазина",
        }),
        "link",
      ),
    ).toBeVisible();
    await find.click();
    // The forward button is «Далее» after a found bike and «Продолжить
    // вручную» otherwise (#370): the same button, the same icon slot.
    const next = wizard.getByRole("button", {
      name: /^(Далее|Продолжить вручную)$/,
    });
    await expect(next).toBeEnabled();
    await expect(slotOf(next, "next")).toBeVisible();
    await expect(
      slotOf(
        wizard.getByRole("button", { name: "Назад", exact: true }),
        "back",
      ),
    ).toBeVisible();
    await reacts(page, next, "next");
    await next.click();
    await expect(
      slotOf(wizard.locator("[data-photo-control]"), "addPhoto"),
    ).toBeVisible();
    await wizard
      .getByLabel("Категория велосипеда", { exact: true })
      .selectOption("mtb");
    await next.click();
    await expect(slotOf(wizard.locator("summary"), "addPart")).toBeVisible();
    const save = wizard.getByRole("button", {
      name: "Сохранить велосипед",
      exact: true,
    });
    await reacts(page, save, "save");
    await page.keyboard.press("Escape");
    await wizard.getByRole("button", { name: "Закрыть", exact: true }).click();
    const leave = page.getByRole("alertdialog", { name: "Закрыть мастер?" });
    await leave
      .getByRole("button", { name: /Закрыть/ })
      .last()
      .click();

    // An ad.
    await page.goto("/market");
    await reacts(
      page,
      page.getByRole("link", { name: "Добавить объявление", exact: true }),
      "addListing",
    );
    await page.goto("/market/new");
    const ad = page.locator("form").filter({ hasText: "Фотографии" });
    await expect(slotOf(ad, "addPhoto")).toBeVisible();
    await reacts(
      page,
      ad.getByRole("button", { name: "Опубликовать", exact: true }),
      "publish",
    );
    await expect(
      slotOf(ad.getByRole("button", { name: "Сохранить черновик" }), "save"),
    ).toBeVisible();
    await expect(
      slotOf(ad.getByRole("button", { name: "Отмена", exact: true }), "no"),
    ).toBeVisible();

    // An article: «Опубликовать» waits for a title and a text, the draft does not.
    await page.goto("/articles/new");
    await expect(slotOf(page.locator("form"), "addPhoto")).toBeVisible();
    await expect(
      slotOf(
        page.getByRole("button", { name: "Опубликовать", exact: true }),
        "publish",
      ),
    ).toBeVisible();
    await reacts(
      page,
      page.getByRole("button", { name: "Сохранить черновик" }),
      "save",
    );

    // A ride: the planner, and the intent of the same family.
    await page.goto("/account?tab=rides&action=plan");
    const plan = page.getByRole("dialog", { name: "Организовать покатушку" });
    await expect(plan).toBeVisible();
    await reacts(
      page,
      plan.getByRole("button", { name: "Создать покатушку", exact: true }),
      "plan",
    );
    await expect(
      slotOf(plan.getByRole("button", { name: "Отмена", exact: true }), "no"),
    ).toBeVisible();
  } finally {
    await put({ iconColors: original.iconColors });
  }
});
