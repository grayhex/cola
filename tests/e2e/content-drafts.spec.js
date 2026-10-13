import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const headers = { origin };
const password = "content-draft-fixture-408";

async function member(page) {
  const email = randomUUID() + "@example.test";
  const response = await registerVerified(page.request, {
    headers,
    data: { ...testConsents, name: "Draft fixture", email, password },
  });
  expect(response.status()).toBe(201);
  const bike = await page.request.post("/api/bikes", {
    headers,
    data: {
      name: "Fixture bicycle",
      brand: "Cube",
      model: "Nuroad",
      year: 2026,
      category: "gravel",
      is_public: true,
      description: "",
      color: "",
      size: "",
      weight: null,
    },
  });
  expect(bike.status(), await bike.text()).toBe(201);
  return { email, bike: await bike.json() };
}
const scenes = [
  { kind: "journal", path: "/j/new", title: "Заголовок записи" },
  { kind: "article", path: "/articles/new", title: "Заголовок статьи" },
  { kind: "market", path: "/market/new", title: "Название" },
];
async function write(page, scene, text) {
  await page
    .getByRole("textbox", { name: scene.title, exact: true })
    .fill(text);
  if (scene.kind !== "market")
    await page
      .locator('[contenteditable="true"]')
      .fill("Синтетический длинный текст: история велосипеда и поездки.");
  if (scene.kind === "journal")
    await page
      .getByRole("combobox", { name: "Велосипед для записи", exact: true })
      .selectOption({ label: "Fixture bicycle" });
}
async function returnToDraft(page) {
  await page.locator("a.brand").click();
  await expect(page).toHaveURL(origin + "/");
  await page.goBack();
}
for (const scene of scenes) {
  test(`${scene.kind}: SPA Back restores text, successful save clears the new form`, async ({
    page,
    browserName,
  }, info) => {
    await member(page);
    for (const width of browserName === "chromium" ? [393, 1440] : [393]) {
      await page.setViewportSize({ width, height: width > 393 ? 900 : 852 });
      for (const theme of ["light", "dark"]) {
        await page.goto(scene.path);
        await page.evaluate(
          (value) => localStorage.setItem("cola:theme", value),
          theme,
        );
        await page.reload();
        await write(page, scene, "Несохранённая история " + theme);
        await page.screenshot({
          path: info.outputPath(
            `${scene.kind}-${width}-${theme}-before-navigation.png`,
          ),
          fullPage: true,
        });
        await returnToDraft(page);
        await expect(
          page.getByRole("textbox", { name: scene.title, exact: true }),
        ).toHaveValue("Несохранённая история " + theme);
        if (scene.kind !== "market")
          await expect(page.locator('[contenteditable="true"]')).toContainText(
            "Синтетический длинный текст",
          );
        await expect(
          page.getByRole("status").filter({ hasText: "Черновик восстановлен" }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`${scene.kind}-${width}-${theme}-restored.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Сохранить черновик", exact: true })
          .click();
        await expect(page).not.toHaveURL(origin + scene.path);
        await expect(
          page.getByRole("heading", {
            name: "Несохранённая история " + theme,
            exact: true,
          }),
        ).toBeVisible();
        // A new client-side visit, not a reload that would erase any memory cache.
        await page.locator("a.brand").click();
        if (width < 1276) {
          await page
            .getByRole("button", { name: "Открыть меню", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "Меню ColaBike", exact: true })
            .locator(`a[href='${scene.path}']`)
            .click();
        } else {
          const section =
            scene.kind === "journal"
              ? "Журнал"
              : scene.kind === "article"
                ? "Статьи"
                : "Рынок";
          await page
            .getByRole("button", {
              name: "Подразделы: " + section,
              exact: true,
            })
            .click();
          await page
            .locator("header .primary-navigation")
            .locator(`a[href='${scene.path}']`)
            .click();
        }
        await expect(
          page.getByRole("textbox", { name: scene.title, exact: true }),
        ).toHaveValue("");
      }
    }
  });
}

for (const scene of [scenes[0], scenes[2]]) {
  test(`${scene.kind}: pending save freezes all fields; failure preserves text and permits retry`, async ({
    page,
  }, info) => {
    await member(page);
    await page.goto(scene.path);
    await write(page, scene, "Версия отправленного текста");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const target = "/api/" + scene.kind;
    await page.route("**" + target, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await held;
      await route.fulfill({
        status: 503,
        json: { error: "Сохранение временно недоступно. Повторите." },
      });
    });
    await page
      .getByRole("button", { name: "Сохранить черновик", exact: true })
      .click();
    const title = page.getByRole("textbox", { name: scene.title, exact: true });
    await expect(title).toBeDisabled();
    const editable = page.locator(
      "form input:not([type=file]), form select, form textarea",
    );
    for (const field of await editable.all())
      await expect(field).toBeDisabled();
    await page.screenshot({
      path: info.outputPath(`${scene.kind}-pending.png`),
      fullPage: true,
    });
    release();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Сохранение временно недоступно" }),
    ).toBeVisible();
    await expect(title).toBeEnabled();
    await expect(title).toHaveValue("Версия отправленного текста");
    await title.fill("Версия после ошибки");
    await page.unroute("**" + target);
    await page
      .getByRole("button", { name: "Сохранить черновик", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Версия после ошибки", exact: true }),
    ).toBeVisible();
  });
}

test("journal: partial upload retains record identity and pending file across navigation", async ({
  page,
}) => {
  await member(page);
  await page.goto("/j/new");
  await write(page, scenes[0], "Черновик с фотографией");
  const buffer = await sharp({
    create: { width: 120, height: 90, channels: 3, background: "#bac5d5" },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer });
  let creations = 0;
  page.on("request", (request) => {
    if (
      request.url() === origin + "/api/journal" &&
      request.method() === "POST"
    )
      creations++;
  });
  await page.route("**/api/journal/*/photos", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Фото временно не загрузилось" },
    }),
  );
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Фото временно не загрузилось" }),
  ).toContainText("Фото временно не загрузилось");
  expect(creations).toBe(1);
  await returnToDraft(page);
  await expect(
    page.getByText("К загрузке: fixture.png", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/journal/*/photos");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Черновик с фотографией", exact: true }),
  ).toBeVisible();
  expect(creations).toBe(1);
});

test("market: cancelled discard retains text; confirmed discard clears recovered draft", async ({
  page,
}) => {
  await member(page);
  await page.goto("/market/new");
  await write(page, scenes[2], "Несохранённое объявление");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Отменить редактирование?",
  });
  await expect(
    confirmation.getByRole("button", { name: "Продолжить редактирование" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Несохранённое объявление");
  await returnToDraft(page);
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Не сохранять", exact: true })
    .click();
  await expect(page).not.toHaveURL(origin + "/market/new");
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("");
});

test("market: returning during a pending save waits for its identity, without a duplicate POST", async ({
  page,
}) => {
  await member(page);
  await page.goto("/market/new");
  await write(page, scenes[2], "Один сохранённый материал");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route("**/api/market", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await gate;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toBeDisabled();
  await returnToDraft(page);
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(origin + "/market/new");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Один сохранённый материал",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

for (const scene of scenes) {
  test(`${scene.kind}: existing material asks before discard and clears only after confirmation`, async ({
    page,
  }) => {
    const { bike } = await member(page);
    const body =
      scene.kind === "journal"
        ? {
            bikeId: bike.id,
            kind: "story",
            title: "Исходный материал",
            body: "Исходный текст",
            status: "draft",
            isPublic: true,
            eventDate: null,
            mileage: null,
            rideId: null,
            componentIds: [],
          }
        : scene.kind === "article"
          ? {
              title: "Исходный материал",
              body: "Исходный текст",
              topicId: "equipment",
              status: "draft",
            }
          : {
              title: "Исходный материал",
              listingType: "sale",
              category: "accessories",
              condition: "used",
              description: "Исходный текст",
              price: null,
              currency: "RUB",
              location: "",
              contact: "",
              status: "draft",
            };
    const endpoint = scene.kind === "article" ? "articles" : scene.kind;
    const response = await page.request.post("/api/" + endpoint, {
      headers,
      data: body,
    });
    expect(response.status(), await response.text()).toBe(201);
    const saved = await response.json();
    const route =
      (scene.kind === "journal" ? "/j/" : "/" + endpoint + "/") + saved.shareId;
    await page.goto(route);
    const edit = page.getByRole("button", {
      name:
        scene.kind === "journal"
          ? "Редактировать запись"
          : scene.kind === "article"
            ? "Редактировать"
            : "Изменить",
      exact: true,
    });
    await edit.click();
    const field = page.getByRole("textbox", { name: scene.title, exact: true });
    await field.fill("Не потерять эту правку");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Отменить редактирование?",
    });
    await dialog
      .getByRole("button", { name: "Продолжить редактирование", exact: true })
      .click();
    await expect(field).toHaveValue("Не потерять эту правку");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Не сохранять", exact: true })
      .click();
    await expect(field).toHaveCount(0);
    await edit.click();
    await expect(field).toHaveValue("Исходный материал");
  });
}
