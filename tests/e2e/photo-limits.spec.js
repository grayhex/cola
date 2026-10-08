import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const limit = 10 * 1024 * 1024;

// #366: a photo above the limit is refused where the owner chose it, with the
// file name, its size and the limit; a file of exactly the limit is taken.
// A PNG ends at its IEND chunk and decoders ignore what follows, so a real
// picture can be padded to the byte.
const picture = async (bytes, width = 800, height = 600) => {
  const png = await sharp({
    create: { width, height, channels: 3, background: "#6f7768" },
  })
    .png()
    .toBuffer();
  return Buffer.concat([png, Buffer.alloc(Math.max(0, bytes - png.length))]);
};

test("bike page: an oversize photo is named beside the button; the limit itself passes; a proxy's 413 is understood", async ({
  page,
}, info) => {
  const nonce = randomUUID().slice(0, 8);
  const register = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Лимит " + nonce,
      email: `limit-${nonce}@example.test`,
      password: "photo-limits-secret-123",
    },
  });
  expect(register.status()).toBe(201);
  const created = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Лимит " + nonce,
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: 9.4,
      is_public: true,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const { bike } = await (await page.request.get("/api/bikes/" + id)).json();
  const photos = `/api/bikes/${id}/photos`;

  // The server: strictly above the limit is 413 with words, the limit and one
  // byte less are read as pictures.
  const post = (data) =>
    page.request.post(photos, {
      headers: { origin, "Content-Type": "image/png" },
      data,
    });
  const refused = await post(Buffer.alloc(limit + 1));
  expect(refused.status()).toBe(413);
  expect((await refused.json()).error).toMatch(
    /Фото слишком большое\. Максимальный размер — 10 МБ\./,
  );
  expect((await post(await picture(limit - 1))).status()).toBe(201);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/b/" + bike.share_id);
  const addPhoto = page
    .getByRole("button", { name: "Добавить фото", exact: true })
    .first();
  await expect(addPhoto).toBeVisible();
  const problems = page.locator(".photo-problems");
  const requests = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(photos))
      requests.push(request.url());
  });
  async function choose(file) {
    const chooser = page.waitForEvent("filechooser");
    await addPhoto.click();
    await (await chooser).setFiles(file);
  }

  // Above the limit: nothing is sent, the message is under the buttons.
  const big = {
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(limit + 1),
  };
  await choose(big);
  await expect(problems).toBeVisible();
  await expect(problems).toHaveAttribute("role", "alert");
  await expect(problems).toContainText(
    "Фото «huge.png» слишком большое: 10,01 МБ. Максимальный размер — 10 МБ.",
  );
  await expect(page.locator(".global-error")).toHaveCount(0);
  expect(requests).toEqual([]);
  await expect(problems).toBeInViewport();
  const message = await problems.boundingBox();
  const button = await addPhoto.boundingBox();
  expect(message.y).toBeGreaterThanOrEqual(button.y);
  expect(message.y - button.y).toBeLessThan(220);
  await page.screenshot({
    path: info.outputPath("bike-photo-too-large.png"),
    animations: "disabled",
  });
  expect(await pageOverflow(page)).toBeNull();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(
      (await new AxeBuilder({ page }).include(".photo-problems").analyze())
        .violations,
    ).toEqual([]);
  }

  // The same file chosen again is told about again: the input is not left
  // holding it.
  await problems.getByRole("button", { name: "Скрыть" }).click();
  await expect(problems).toHaveCount(0);
  await choose(big);
  await expect(problems).toContainText("«huge.png»");
  expect(requests).toEqual([]);

  // Exactly the limit goes through, and the old message is gone.
  await choose({
    name: "limit.png",
    mimeType: "image/png",
    buffer: await picture(limit),
  });
  await expect(page.getByText("Фотография добавлена")).toBeVisible();
  await expect(problems).toHaveCount(0);
  expect(requests).toHaveLength(1);

  // A proxy in front of the server refuses a file the browser found fine:
  // HTML, plain text or an empty body, the owner reads the same thing.
  const small = {
    name: "small.png",
    mimeType: "image/png",
    buffer: await picture(0, 800, 600),
  };
  for (const body of [
    { contentType: "text/html", body: "<html>413 Request Entity Too Large" },
    { contentType: "text/plain", body: "Payload Too Large" },
    { contentType: "text/plain", body: "" },
  ]) {
    await page.route("**/api/bikes/*/photos", (route) =>
      route.fulfill({ status: 413, ...body }),
    );
    await choose(small);
    await expect(problems).toContainText("Сервер не принял фото «small.png»");
    await expect(problems).not.toContainText("<html>");
    await expect(page.locator(".global-error")).toHaveCount(0);
    await page.unroute("**/api/bikes/*/photos");
    await problems.getByRole("button", { name: "Скрыть" }).click();
  }
  // Other refusals keep the server's own words, or say the status.
  await page.route("**/api/bikes/*/photos", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Не удалось прочитать изображение" }),
    }),
  );
  await choose(small);
  await expect(problems).toContainText(
    "Фото «small.png» не загружено: Не удалось прочитать изображение",
  );
  await page.unroute("**/api/bikes/*/photos");
  await expect(addPhoto).toBeEnabled();
});

test("account garage: a refusal belongs to the bike it was made on", async ({
  page,
}) => {
  const nonce = randomUUID().slice(0, 8);
  const register = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Гараж " + nonce,
      email: `garage-${nonce}@example.test`,
      password: "photo-limits-secret-123",
    },
  });
  expect(register.status()).toBe(201);
  for (const name of ["Первый " + nonce, "Второй " + nonce])
    expect(
      (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name,
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
        })
      ).status(),
    ).toBe(201);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account?tab=bikes");
  await page
    .locator(".bike-card")
    .filter({ hasText: "Первый " + nonce })
    .getByRole("button")
    .first()
    .click();
  const problems = page.locator(".photo-problems");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Добавить фото", exact: true })
    .first()
    .click();
  await (
    await chooser
  ).setFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(limit + 1),
  });
  await expect(problems).toContainText("«huge.png»");
  // Back to the garage and into the other bike: no alert about a file that
  // was meant for the first one.
  // The phone's section switcher is named alike («Раздел: Мои велосипеды»).
  await page
    .getByRole("button", { name: "Мои велосипеды", exact: true })
    .click();
  await page
    .locator(".bike-card")
    .filter({ hasText: "Второй " + nonce })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Второй " + nonce, level: 1 }),
  ).toBeVisible();
  await expect(problems).toHaveCount(0);
  await expect(page.getByText("huge.png")).toHaveCount(0);
});
