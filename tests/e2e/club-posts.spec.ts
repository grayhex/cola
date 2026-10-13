import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { ClubPostDto } from "../../lib/club-posts.ts";
type ClubPostView = ClubPostDto;
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
async function person(request: APIRequestContext, bike = false) {
  const response = await registerVerified(request, {
    headers,
    data: {
      ...testConsents,
      name: "Клубный автор " + randomUUID().slice(0, 5),
      email: randomUUID() + "@example.test",
      password: "club-post-fixture-413",
    },
  });
  expect(response.status()).toBe(201);
  const data: { user: { id: string } } = await response.json();
  if (bike) {
    const response = await request.post("/api/bikes", {
      headers,
      data: {
        name: "Приватный велосипед",
        brand: "Cube",
        model: "Nuroad",
        year: 2026,
        category: "gravel",
        is_public: false,
        description: "",
        color: "",
        size: "",
        weight: null,
      },
    });
    expect(response.status()).toBe(201);
  }
  return data.user;
}
async function setup(request: APIRequestContext) {
  await person(request, true);
  const response = await request.post("/api/clubs", {
    headers,
    data: {
      name: "Длинное название клуба любителей ночных гравийных путешествий",
      mission: "Ездим вместе по выходным.",
      joinMode: "open",
      requestId: randomUUID(),
    },
  });
  expect(response.status()).toBe(201);
  const data: { club: ClubDto } = await response.json();
  return data.club;
}
async function post(
  request: APIRequestContext,
  club: string,
  status: "draft" | "published" = "published",
) {
  const response = await request.post("/api/club-posts?clubId=" + club, {
    headers,
    data: {
      requestId: randomUUID(),
      title: "Ночная поездка и встреча на рассвете",
      body:
        "## Делимся впечатлениями\nПервый совместный выезд.\n\nНеобычно длинное слово: " +
        "велосипед".repeat(20),
      status,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { post: ClubPostView }).post;
}
test("club posts: guest reads, an active member without a bike publishes and replies; owner pins, departure revokes writes", async ({
  page,
  browser,
}) => {
  const club = await setup(page.request),
    member = await browser.newContext(),
    guest = await browser.newContext();
  try {
    await person(member.request);
    expect(
      (
        await member.request.post("/api/clubs/" + club.id + "/membership", {
          headers,
          data: { action: "join" },
        })
      ).status(),
    ).toBe(200);
    const p = await post(member.request, club.id),
      draft = await post(member.request, club.id, "draft");
    expect(
      (await guest.request.get("/api/club-posts/" + draft.id)).status(),
    ).toBe(404);
    expect(
      (await page.request.get("/api/club-posts/" + draft.id)).status(),
    ).toBe(404);
    const g = await guest.newPage();
    await g.goto(p.href);
    await expect(
      g.getByRole("heading", { name: p.title, exact: true }),
    ).toBeVisible();
    await expect(
      g.getByRole("link", { name: "Войти, чтобы участвовать в обсуждении" }),
    ).toBeVisible();
    await expect(
      g.getByRole("textbox", { name: "Ваш комментарий" }),
    ).toHaveCount(0);
    const m = await member.newPage();
    await m.goto(p.href);
    await m
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill("Где встречаемся в следующий раз?");
    const posted = m.waitForResponse(
      (r) => r.url().endsWith("/comments") && r.request().method() === "POST",
    );
    await m
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    expect((await posted).status()).toBe(201);
    await expect(
      m
        .locator(".comment-body")
        .getByText("Где встречаемся в следующий раз?", { exact: true }),
    ).toBeVisible();
    await page.goto(p.href);
    await page.getByRole("button", { name: "Закрепить", exact: true }).click();
    await expect(page.getByText("Закреплено", { exact: true })).toBeVisible();
    await page.goto("/clubs/" + club.id);
    await expect(page.getByText("Закреплено", { exact: true })).toBeVisible();
    expect(
      (
        await member.request.post("/api/clubs/" + club.id + "/membership", {
          headers,
          data: { action: "leave" },
        })
      ).status(),
    ).toBe(200);
    const rejected = await member.request.post(
      "/api/club-posts/" + p.id + "/comments",
      { headers, data: { body: "Нет доступа" } },
    );
    expect(rejected.status()).toBe(403);
    await m.reload();
    await expect(
      m.getByRole("textbox", { name: "Ваш комментарий", exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByRole("link", { name: "Редактировать", exact: true }),
    ).toHaveCount(0);
    await page.goto(p.href);
    await page
      .getByRole("button", { name: "Скрыть публикацию", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Скрыть", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Публикация недоступна" }),
    ).toBeVisible();
    expect((await guest.request.get("/api/club-posts/" + p.id)).status()).toBe(
      404,
    );
  } finally {
    await member.close();
    await guest.close();
  }
});
test("club post editor keeps a draft through Back and resumes partial image upload without duplicate publication", async ({
  page,
  browser,
}) => {
  const club = await setup(page.request);
  await page.goto("/clubs/" + club.id);
  await page.getByRole("link", { name: "Написать в клуб" }).click();
  await page
    .getByLabel("Заголовок", { exact: false })
    .fill("Черновик после возврата");
  await page
    .getByRole("textbox", { name: "Текст публикации", exact: true })
    .fill("Текст не теряется при возврате.");
  await page.locator("a.brand").click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Текст публикации", exact: true }),
  ).toContainText("Текст не теряется");
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#215a3c" },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "ride.png", mimeType: "image/png", buffer: photo });
  let failed = false;
  await page.route("**/api/club-posts/*/photos?requestId=*", async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { error: "Повторите загрузку фото" },
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Повторите загрузку фото",
  );
  const before = await page.request.get(
      "/api/club-posts?clubId=" + club.id + "&own=1",
    ),
    data: { posts: ClubPostView[] } = await before.json();
  expect(data.posts).toHaveLength(1);
  expect(data.posts[0].status).toBe("draft");
  const guest = await browser.newContext();
  try {
    expect(
      (await guest.request.get("/api/club-posts/" + data.posts[0].id)).status(),
    ).toBe(404);
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp("/posts/" + data.posts[0].id + "$"),
    );
    await expect(
      page.getByRole("heading", {
        name: "Черновик после возврата",
        exact: true,
      }),
    ).toBeVisible();
    const after: { posts: ClubPostView[] } = await (
      await page.request.get("/api/club-posts?clubId=" + club.id + "&own=1")
    ).json();
    expect(after.posts).toHaveLength(1);
    expect(after.posts[0].photos).toHaveLength(1);
    expect(
      (await guest.request.get(after.posts[0].photos[0].url)).status(),
    ).toBe(200);
  } finally {
    await guest.close();
  }
});
test("club feed and reader: both themes, readable photos and long text, mobile and desktop without overflow", async ({
  page,
  browserName,
}, info) => {
  const club = await setup(page.request),
    p = await post(page.request, club.id),
    photo = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#456a83" },
    })
      .webp()
      .toBuffer();
  const upload = await page.request.post(
    "/api/club-posts/" + p.id + "/photos?requestId=" + randomUUID(),
    { headers: { ...headers, "Content-Type": "image/webp" }, data: photo },
  );
  expect(upload.status(), await upload.text()).toBe(201);
  const uploaded: { id: string } = await upload.json();
  const media = "/api/club-posts/" + p.id + "/media/" + uploaded.id;
  const thumbnail = await page.request.get(media + "?width=320");
  expect(thumbnail.status()).toBe(200);
  expect(thumbnail.headers()["cache-control"]).toBe("private, no-store");
  expect(
    (await sharp(await thumbnail.body()).metadata()).width,
  ).toBeLessThanOrEqual(320);
  expect((await page.request.get(media + "?width=321")).status()).toBe(400);
  const sizes =
    browserName === "chromium" ? [320, 360, 393, 430, 768, 1440] : [393];
  for (const theme of ["light", "dark"]) {
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/clubs/" + club.id);
      await page.evaluate(
        (value) => localStorage.setItem("cola:theme", value),
        theme,
      );
      await page.reload();
      await expect(
        page.getByRole("heading", { name: p.title, exact: true }),
      ).toBeVisible();
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((img) =>
            img.decode().catch(() => {}),
          ),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`club-feed-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.getByRole("link", { name: p.title, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: p.title, exact: true }),
      ).toBeVisible();
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((img) =>
            img.decode().catch(() => {}),
          ),
        );
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`club-post-${theme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});
