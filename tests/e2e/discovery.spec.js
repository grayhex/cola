import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("journal discovery: no-bike reader subscribes, saves, searches and returns; privacy revokes every surface", async ({
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
            name: "Reader " + suffix,
            email: nonce + suffix + "@discovery.test",
            password: "discovery-browser-secret",
          },
        })
      ).status(),
    ).toBe(201);
  await register(page.request, "owner");
  const bike = await (
    await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Discovery bike " + nonce,
        brand: "Cube",
        model: "Travel",
        year: 2020,
        category: "road",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
        purposes: ["travel"],
      },
    })
  ).json();
  const entry = await (
    await page.request.post("/api/journal", {
      headers: { origin },
      data: {
        bikeId: bike.id,
        kind: "question",
        title: "Выбор седла " + nonce,
        body: "Как установить седло для путешествий?",
        status: "published",
        isPublic: true,
      },
    })
  ).json();
  const publicBike = (
    await (await page.request.get("/api/bikes/" + bike.id)).json()
  ).bike;
  const photoBytes = await sharp({
    create: { width: 900, height: 300, channels: 3, background: "#d4d8dc" },
  })
    .png()
    .toBuffer();
  const uploaded = await page.request.post(
    "/api/journal/" + entry.id + "/photos",
    { headers: { origin, "content-type": "image/png" }, data: photoBytes },
  );
  expect(uploaded.status()).toBe(201);
  const photo = await uploaded.json();
  const reader = await browser.newContext(info.project.use),
    other = await reader.newPage();
  try {
    await register(reader.request, "reader");
    await other.goto("/b/" + publicBike.share_id);
    await other
      .getByRole("button", { name: "Подписаться на велосипед", exact: true })
      .click();
    await expect(
      other.getByRole("button", {
        name: "Вы подписаны на велосипед",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await other.goto("/journal?mode=following");
    const card = other.locator(".journal-card").filter({ hasText: nonce });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByRole("img", { name: "Фотография записи" }),
    ).toBeVisible();
    await card
      .getByRole("button", { name: "Сохранить запись", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Убрать из сохранённого", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await other.goto("/saved");
    await expect(other.locator(".journal-card")).toHaveCount(1);
    await other
      .getByRole("heading", { name: "Выбор седла " + nonce, exact: true })
      .getByRole("link")
      .click();
    await other
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill("Установил без доработок");
    await other
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(other.locator(".comment-body")).toContainText(
      "Установил без доработок",
    );
    await page.goto("/j/" + entry.shareId);
    await page
      .getByRole("button", { name: "Отметить решением", exact: true })
      .click();
    await expect(page.locator(".journal-solution").first()).toContainText(
      "Решено",
    );
    await other.goto(
      "/search?" +
        new URLSearchParams({
          q: nonce,
          type: "journal",
          brand: "Куб",
          model: "Tra-vel",
          purpose: "travel",
        }),
    );
    await expect(other.locator(".journal-card")).toHaveCount(1);
    await other
      .getByRole("button", { name: "Фильтры поиска", exact: true })
      .click();
    const dialog = other.getByRole("dialog", {
      name: "Фильтры поиска",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Год", { exact: true }).fill("2020");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect(other.locator(".journal-card")).toHaveCount(1);
    expect(
      await other.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await other.screenshot({
      path: info.outputPath("experience-search.png"),
      fullPage: true,
    });
    await other.goto("/journal?mode=following");
    await expect(other.locator(".journal-card")).toHaveCount(1);
    await other.screenshot({
      path: info.outputPath("journal-following.png"),
      fullPage: true,
    });
    expect(
      (
        await page.request.patch("/api/bikes/" + bike.id + "/share", {
          headers: { origin },
          data: { is_public: false },
        })
      ).status(),
    ).toBe(200);
    await other.reload();
    await expect(other.locator(".journal-card")).toHaveCount(0);
    await other.goto("/saved");
    await expect(
      other.getByRole("heading", { name: "Пока ничего не сохранено" }),
    ).toBeVisible();
    expect(
      (await reader.request.get("/api/journal/media/" + photo.id)).status(),
    ).toBe(404);
    await other.goto(
      "/search?" + new URLSearchParams({ q: nonce, type: "journal" }),
    );
    await expect(
      other.getByRole("heading", { name: "Ничего не найдено" }),
    ).toBeVisible();
    expect(
      (
        await reader.request.get("/api/journal/public/" + entry.shareId)
      ).status(),
    ).toBe(404);
  } finally {
    await reader.close();
  }
});
