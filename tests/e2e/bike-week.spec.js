import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { bikeWeekStart } from "../../lib/bike-week-validation.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("weekly feature: server permissions, admin choice, service notice, owner preview, publication and refusal", async ({
  page,
  browser,
}, info) => {
  const q = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await q.connect();
  const other = await browser.newContext({ baseURL: origin });
  const users = [];
  let bikeId;
  const original = (
    await q.query("SELECT value FROM bike_week_settings WHERE id=1")
  ).rows[0].value;
  try {
    expect((await other.request.get("/api/bike-week/me")).status()).toBe(401);
    expect((await other.request.get("/api/bike-week/bikes")).status()).toBe(
      401,
    );
    for (const request of [page.request, other.request]) {
      expect(
        (
          await registerVerified(request, {
            headers: { origin },
            data: {
              ...testConsents,
              name: "Spotlight rider",
              email: randomUUID() + "@example.test",
              password: "week-browser-secret-123",
            },
          })
        ).status(),
      ).toBe(201);
      users.push((await (await request.get("/api/me")).json()).user.id);
    }
    expect((await other.request.get("/api/bike-week/admin")).status()).toBe(
      403,
    );
    expect((await other.request.get("/api/bike-week/bikes")).status()).toBe(
      403,
    );
    await q.query("UPDATE users SET role='admin' WHERE id=$1", [users[0]]);
    const created = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Week touring",
        brand: "Cube",
        model: "Travel",
        year: 2026,
        category: "road",
        description: "Original public description",
        color: "",
        size: "L",
        weight: 12,
        is_public: true,
      },
    });
    expect(created.status()).toBe(201);
    bikeId = (await created.json()).id;
    expect(
      (
        await page.request.post(`/api/bikes/${bikeId}/photos`, {
          headers: { origin, "Content-Type": "image/png" },
          data: await sharp({
            create: {
              width: 600,
              height: 400,
              channels: 3,
              background: "#58636b",
            },
          })
            .png()
            .toBuffer(),
        })
      ).status(),
    ).toBe(201);
    for (const category of [
      "Рама",
      "Вилка",
      "Тормоза",
      "Колёса",
      "Руль",
      "Седло",
    ])
      await q.query(
        "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build',$3,$4)",
        [randomUUID(), bikeId, category, "Shimano " + category],
      );
    const preview = await (
      await page.request.get("/api/bike-week/admin")
    ).json();
    expect(
      (
        await page.request.put("/api/bike-week/settings", {
          headers: { origin: "https://evil.test" },
          data: preview.settings,
        })
      ).status(),
    ).toBe(403);
    expect(
      (await page.request.get("/api/bike-week/admin?week=2026-02-30")).status(),
    ).toBe(400);
    expect(
      (
        await page.request.put("/api/bike-week/settings", {
          headers: { origin },
          data: {
            ...preview.settings,
            minimumLikes: 0,
            minimumReactions: 0,
            minimumParticipants: 0,
            minimumScore: 0,
            cooldownWeeks: 0,
          },
        })
      ).status(),
    ).toBe(200);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Главная", exact: true }).click();
    await page
      .getByRole("button", { name: "Велосипед недели", exact: true })
      .click();
    const candidate = page
      .getByRole("list", { name: "Кандидаты недели" })
      .getByRole("button", { name: "Назначить Week touring" });
    await expect(candidate).toBeDisabled();
    await page
      .getByLabel("Причина для журнала")
      .fill("Candidate browser verification");
    await candidate.click();
    await expect(
      page.getByRole("region", { name: "Текущий велосипед недели" }),
    ).toContainText("Week touring");
    await page
      .getByRole("button", { name: "Пропустить неделю", exact: true })
      .click();
    await expect(
      page.getByText("Статус: неделя пропущена", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Вернуть автоматический выбор",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Текущий велосипед недели" }),
    ).toContainText("Автоматический выбор по баллам");
    expect(
      (
        await page.request.get("/api/bike-week/bikes?q=" + "x".repeat(101))
      ).status(),
    ).toBe(400);
    await page
      .getByRole("button", { name: "Назначить вручную", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Найти публичный велосипед" })
      .fill("missing-" + randomUUID());
    await expect(
      page.getByText("Нет подходящих велосипедов.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Найти публичный велосипед" })
      .fill("Week touring");
    const choice = page.getByRole("radio", { name: "Выбрать Week touring" });
    await expect(choice).toBeVisible();
    await choice.focus();
    await page.keyboard.press("Space");
    await expect(choice).toBeChecked();
    await page
      .getByLabel("Причина для журнала")
      .fill("Editorial browser verification");
    await page
      .getByRole("button", { name: "Назначить на неделю", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Решение на неделю сохранено" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Текущий велосипед недели" }),
    ).toContainText("Week touring");
    await expect(
      page.getByText("Причина: Editorial browser verification", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Текущий велосипед недели" }),
    ).toContainText("Назначен администратором");
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          (v) => (document.documentElement.dataset.theme = v),
          theme,
        );
        expect(
          (await new AxeBuilder({ page }).include(".admin-content").analyze())
            .violations,
        ).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`bike-week-admin-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    await page.screenshot({
      path: info.outputPath("bike-week-admin.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      (
        await other.request.put("/api/bike-week/me", {
          headers: { origin },
          data: { action: "publish", text: "stolen" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.put("/api/bike-week/me", {
          headers: { origin },
          data: { action: "publish", text: "x".repeat(601) },
        })
      ).status(),
    ).toBe(400);
    await page.goto("/notifications");
    await expect(
      page.getByText("Ваш велосипед — велосипед недели:", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Подготовить материал для главной" })
      .click();
    await expect(page.getByLabel("История для главной")).toHaveValue(
      "Original public description",
    );
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: "Week touring", exact: true })
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);

    await page
      .getByLabel("История для главной")
      .fill(
        "Мой велосипед для длинных поездок. История специально для главной.",
      );
    for (const width of [390, 1440])
      for (const theme of ["dark", "light"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        expect(
          (await new AxeBuilder({ page }).include("main").analyze()).violations,
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`bike-week-story-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    await page
      .getByRole("button", { name: "Опубликовать текст", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Текст опубликован" }),
    ).toBeVisible();
    const home = await (await page.request.get("/api/discovery/home")).json();
    expect(home.bikeOfWeek.textSource).toBe("owner");
    expect(home.bikeOfWeek.components).toHaveLength(6);
    expect(
      (await q.query("SELECT description FROM bikes WHERE id=$1", [bikeId]))
        .rows[0].description,
    ).toBe("Original public description");
    await page.getByRole("button", { name: "Отказаться от участия" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "отказались" }),
    ).toBeVisible();
    expect(
      await (await page.request.get("/api/bike-week/current")).json(),
    ).toBe(null);
    await q.query("UPDATE users SET blocked=true WHERE id=$1", [users[1]]);
    expect((await other.request.get("/api/bike-week/me")).status()).toBe(401);
  } finally {
    await q.query("DELETE FROM bike_week_decisions WHERE week_start=$1", [
      bikeWeekStart(),
    ]);
    await q.query("DELETE FROM bike_weeks WHERE week_start=$1", [
      bikeWeekStart(),
    ]);
    if (bikeId) {
      await q.query("DELETE FROM bike_week_history WHERE bike_id=$1", [bikeId]);
      await q.query("DELETE FROM bike_week_declines WHERE bike_id=$1", [
        bikeId,
      ]);
    }
    await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    await q.query("UPDATE bike_week_settings SET value=$1 WHERE id=1", [
      original,
    ]);
    await q.end();
    await other.close();
  }
});
