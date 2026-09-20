import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("component change offers an explicit draft, never automatic publication", async ({
  page,
}) => {
  const nonce = randomUUID();
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          name: "Builder",
          email: nonce + "@builder.test",
          password: "builder-browser-secret",
        },
      })
    ).status(),
  ).toBe(201);
  const bike = await (
    await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Build diary",
        brand: "Cube",
        model: "Travel",
        year: 2026,
        category: "road",
        description: "",
        color: "",
        size: "",
        weight: null,
      },
    })
  ).json();
  expect(
    (
      await page.request.post("/api/bikes/" + bike.id + "/components", {
        headers: { origin },
        data: {
          section: "build",
          category: "Седло",
          name: "Original saddle",
          notes: "",
          price: null,
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/account?tab=bikes&bike=" + bike.id);
  await expect(
    page.getByRole("heading", { name: "Журнал велосипеда", exact: true }),
  ).toBeVisible();
  await page.locator('summary[aria-label="Действия: Original saddle"]').click();
  await page
    .getByRole("button", { name: "Изменить Original saddle", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Изменить деталь",
    exact: true,
  });
  await editor
    .getByLabel("Компонент или модель", { exact: true })
    .fill("New saddle");
  await editor
    .getByRole("button", { name: "Сохранить деталь", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Рассказать об изменении", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/journal?bikeId=" + bike.id)).json())
      .entries,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Рассказать об изменении", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Редактировать запись", exact: true }),
  ).toBeVisible();
  const entries = (
    await (await page.request.get("/api/journal?bikeId=" + bike.id)).json()
  ).entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "build",
    status: "draft",
    isPublic: false,
    body: "",
  });
  expect(entries[0].components[0].name).toBe("New saddle");
});
test("journal: draft, publication, photo, discussion and inherited privacy", async ({
  page,
  browser,
}, info) => {
  const nonce = randomUUID();
  const register = async (request, suffix) =>
    expect(
      (
        await request.post("/api/auth/register", {
          headers: { origin },
          data: {
            name: "Journal " + suffix,
            email: nonce + suffix + "@journal.test",
            password: "journal-browser-secret-123",
          },
        })
      ).status(),
    ).toBe(201);
  await register(page.request, "owner");
  const bike = await (
    await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Journal bicycle",
        brand: "Cube",
        model: "Travel",
        year: 2026,
        category: "road",
        description: "",
        color: "blue",
        size: "M",
        weight: 12,
        is_public: true,
      },
    })
  ).json();
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    await page.goto("/j/new?bike=" + bike.id);
    await page
      .getByLabel("Заголовок записи", { exact: true })
      .fill("Первое обслуживание");
    await page
      .getByLabel("Текст записи", { exact: true })
      .fill("Заменил цепь и настроил переключение.");
    await page
      .getByLabel("Тип записи", { exact: true })
      .selectOption("service");
    const photo = await sharp({
      create: { width: 500, height: 180, channels: 3, background: "#94c5bc" },
    })
      .png()
      .toBuffer();
    await page.locator("input[type=file]").setInputFiles({
      name: "journal.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await page
      .getByRole("button", { name: "Сохранить черновик", exact: true })
      .click();
    await expect(page).toHaveURL(/\/j\/[a-f0-9-]+$/);
    await expect(page.locator(".journal-entry-meta")).toContainText("Черновик");
    const path = new URL(page.url()).pathname;
    const share = path.split("/").pop();
    const entry = (
      await (await page.request.get("/api/journal/public/" + share)).json()
    ).entry;
    const media = entry.photos[0].url;
    expect(
      (await visitor.request.get("/api/journal/public/" + share)).status(),
    ).toBe(404);
    expect((await visitor.request.get(media)).status()).toBe(404);
    await page
      .getByRole("button", { name: "Редактировать запись", exact: true })
      .click();
    await page.getByLabel("Публичная запись", { exact: true }).check();
    await page
      .getByRole("button", { name: "Опубликовать запись", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Первое обслуживание", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".journal-entry-meta")).not.toContainText(
      "Черновик",
    );
    expect((await visitor.request.get(media)).status()).toBe(200);
    await register(visitor.request, "visitor");
    const other = await visitor.newPage();
    await other.goto(path);
    await other
      .getByRole("button", { name: "Нравится запись: 0", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "Нравится запись: 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await other
      .getByLabel("Ваш комментарий", { exact: true })
      .fill("Как ведёт себя новая цепь?");
    await other
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(other.locator(".comment-body")).toHaveText(
      "Как ведёт себя новая цепь?",
    );
    await page.reload();
    await page.getByRole("button", { name: "Ответить", exact: true }).click();
    await page
      .getByLabel("Ваш ответ", { exact: true })
      .fill("Переключение стало тише.");
    await page
      .getByRole("button", { name: "Отправить ответ", exact: true })
      .click();
    await expect(page.getByLabel("Ваш ответ", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("journal-entry.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      (
        await page.request.patch("/api/bikes/" + bike.id + "/share", {
          headers: { origin },
          data: { is_public: false },
        })
      ).status(),
    ).toBe(200);
    for (const url of [
      "/api/journal/public/" + share,
      media,
      "/api/journal/" + entry.id + "/comments",
    ])
      expect((await visitor.request.get(url)).status()).toBe(404);
    await other.reload();
    await expect(other.getByRole("alert")).toBeVisible();
    await expect(
      other.locator(".journal-body,.journal-photos img"),
    ).toHaveCount(0);
    expect((await page.request.get(media)).status()).toBe(200);
    await page.reload();
    await expect(page.locator(".journal-entry-meta")).toContainText(
      "Приватная запись",
    );
    await page
      .getByRole("button", { name: "Удалить запись", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Да, удалить запись", exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\?tab=bikes&bike=/);
    expect((await page.request.get(media)).status()).toBe(404);
  } finally {
    await visitor.close();
  }
});
