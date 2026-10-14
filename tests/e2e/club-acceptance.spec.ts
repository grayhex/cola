import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
import { runClubEventBatch } from "../../lib/club-events.ts";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { CurrentUser } from "../../lib/contracts.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
test.use({ video: "on" });
async function person(request: APIRequestContext) {
  expect(
    (
      await registerVerified(request, {
        headers,
        data: {
          ...testConsents,
          name: "Велосипедист " + randomUUID().slice(0, 5),
          email: randomUUID() + "@example.test",
          password: "club-full-acceptance-413",
        },
      })
    ).status(),
  ).toBe(201);
  const me: { user: CurrentUser } = await (await request.get("/api/me")).json();
  return me.user;
}
async function bike(request: APIRequestContext, isPublic: boolean) {
  const r = await request.post("/api/bikes", {
    headers,
    data: {
      name: "Велосипед участника",
      brand: "Cube",
      model: "Nuroad",
      category: "gravel",
      year: 2026,
      is_public: isPublic,
      description: "",
      color: "",
      size: "",
      weight: null,
    },
  });
  expect(r.status()).toBe(201);
  const d: { id: string } = await r.json();
  const b: { bike: { share_id: string } } = await (
    await request.get("/api/bikes/" + d.id)
  ).json();
  return b.bike.share_id;
}
test("recorded mobile path: create, invitation, badge, post/comment, real ride, opt-in notification and club SDK chat", async ({
  page,
  browser,
}, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const ownerContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 393, height: 852 },
      recordVideo: { dir: info.outputPath("owner-video") },
    }),
    ownerPage = await ownerContext.newPage();
  const video = ownerPage.video();
  try {
    const owner = await person(ownerContext.request),
      member = await person(page.request);
    const fixture = chatBrowserFixture([owner, member]);
    await fixture.install(page, member);
    await bike(ownerContext.request, false);
    const memberBike = await bike(page.request, true);
    await ownerPage.goto("/clubs/new");
    await ownerPage
      .getByLabel("Название", { exact: true })
      .fill("Клуб вечерних маршрутов");
    const created = ownerPage.waitForResponse(
      (r) => r.url().endsWith("/api/clubs") && r.request().method() === "POST",
    );
    await ownerPage
      .getByRole("button", {
        name: /^(Создать клуб|Сохранить изменения)$/,
        exact: true,
      })
      .click();
    expect((await created).status()).toBe(201);
    const data: { club: ClubDto } = await (await created).json(),
      c = data.club;
    await expect(
      ownerPage.getByRole("heading", { name: c.name, exact: true }),
    ).toBeVisible();
    await ownerPage
      .getByRole("link", { name: "Правила клуба", exact: true })
      .click();
    await ownerPage
      .getByRole("link", { name: "Редактировать правила" })
      .click();
    await ownerPage
      .locator('[contenteditable="true"]')
      .fill("Едем вместе и предупреждаем о препятствиях.");
    await ownerPage
      .getByRole("button", {
        name: /^(Создать клуб|Сохранить изменения)$/,
        exact: true,
      })
      .click();
    await expect(ownerPage).toHaveURL(origin + "/clubs/" + c.id + "/rules");
    await expect(
      ownerPage.getByText("Едем вместе и предупреждаем о препятствиях.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await ownerContext.request.patch(
          "/api/clubs/" + c.id + "/members/" + member.id,
          { headers, data: { action: "invite" } },
        )
      ).status(),
    ).toBe(200);
    await runClubEventBatch();
    await page.goto("/clubs/" + c.id);
    await page
      .getByRole("button", { name: "Принять приглашение", exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Вступить в клуб?" })
      .getByRole("button", { name: "Вступить", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Чат клуба", exact: true }),
    ).toBeVisible();
    await page.getByText("Уведомления клуба", { exact: true }).click();
    await page.getByLabel("Уведомлять о новых выездах").check();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                "/api/clubs/" + c.id + "/notice-preferences",
              )
            ).json()
          ).notifyRides,
      )
      .toBe(true);
    await page.goto("/u/" + member.username);
    await expect(
      page
        .getByLabel("Клубы участника", { exact: true })
        .getByRole("link", { name: c.name }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("acceptance-profile-badge.png"),
      fullPage: true,
    });
    await page.goto("/b/" + memberBike);
    await expect(
      page
        .getByLabel("Клубы участника", { exact: true })
        .getByRole("link", { name: c.name }),
    ).toBeVisible();
    await page.goto("/clubs/" + c.id);
    await page
      .getByRole("link", { name: "Написать в клуб", exact: true })
      .click();
    await page
      .getByLabel("Заголовок", { exact: false })
      .fill("Первая история клуба");
    await page
      .getByRole("textbox", { name: "Текст публикации", exact: true })
      .fill("Собираемся на спокойный вечерний круг.");
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Первая история клуба", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Ваш комментарий", exact: true })
      .fill("Присоединюсь к обсуждению.");
    await page
      .getByRole("button", { name: "Отправить комментарий", exact: true })
      .click();
    await expect(
      page
        .locator(".comment-body")
        .getByText("Присоединюсь к обсуждению.", { exact: true }),
    ).toBeVisible();
    await ownerPage.goto("/clubs/" + c.id + "?tab=rides");
    await ownerPage
      .getByRole("button", { name: "Запланировать выезд клуба" })
      .click();
    const dialog = ownerPage.getByRole("dialog", {
      name: "Организовать покатушку",
    });
    await dialog
      .getByLabel("Название", { exact: true })
      .fill("Вечерний выезд клуба");
    await dialog
      .getByLabel("Дата", { exact: true })
      .fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    await dialog.getByLabel("Старт", { exact: true }).fill("18:00");
    await dialog
      .getByLabel("Место встречи", { exact: true })
      .fill("Закрытые ворота");
    await dialog
      .getByRole("button", { name: "Создать покатушку", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await runClubEventBatch();
    await page.goto("/notifications");
    await expect(
      page.getByText("Вечерний выезд клуба", { exact: true }),
    ).toBeVisible();
    await page.goto("/clubs/" + c.id);
    await expect(page.locator("time")).toBeVisible();
    await expect(
      page.getByText("Ближайший выезд", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Чат клуба", exact: true }).click();
    const composer = page.locator(".chat-conversation textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill("Обсуждаем выезд во внутреннем чате.");
    await composer.press("Enter");
    await expect(
      page
        .locator(".chat-text")
        .getByText("Обсуждаем выезд во внутреннем чате.", { exact: true }),
    ).toBeVisible();
    expect(fixture.unexpected).toEqual([]);
  } finally {
    await ownerContext.close();
    if (video)
      await info.attach("owner-mobile-path", {
        path: await video.path(),
        contentType: "video/webm",
      });
  }
});
