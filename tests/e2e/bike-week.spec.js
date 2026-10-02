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
          data: await sharp(
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><g fill="none" stroke="#6b7b91" stroke-width="14"><circle cx="140" cy="260" r="125"/><circle cx="660" cy="260" r="125"/><path d="M140 260L305 80 420 260H140M305 80H560L420 260M660 260L545 55H610M265 70H330"/></g></svg>',
            ),
          )
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
    await page.getByRole("tab", { name: "Механики", exact: true }).click();
    await page
      .getByRole("button", { name: "Велосипед недели", exact: true })
      .click();
    const candidate = page
      .getByRole("list", { name: "Кандидаты недели" })
      .getByRole("button", { name: "Выбрать Week touring" });
    // Search results used to push the submit button between pointer down/up.
    // Hold a real response until the pointer is down: no timing sleeps/retries.
    let showSearchResults;
    await page.route(
      "**/api/bike-week/bikes?**",
      async (route) => {
        const response = await route.fetch();
        showSearchResults = () => route.fulfill({ response });
      },
      { times: 1 },
    );
    await expect(candidate).toBeEnabled();
    await candidate.click();
    const assign = page.getByRole("button", {
      name: "Назначить на неделю",
      exact: true,
    });
    await expect(assign).toBeDisabled();
    await page
      .getByLabel("Причина для журнала")
      .fill("Candidate browser verification");
    await expect(assign).toBeEnabled();
    await expect.poll(() => !!showSearchResults).toBe(true);
    await assign.scrollIntoViewIfNeeded();
    const beforeSearch = await assign.boundingBox();
    const assigned = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/bike-week/decision") &&
        r.request().method() === "PUT",
    );
    await page.mouse.move(
      beforeSearch.x + beforeSearch.width / 2,
      beforeSearch.y + beforeSearch.height / 2,
    );
    await page.mouse.down();
    await showSearchResults();
    await expect(
      page.getByRole("radio", { name: "Выбрать Week touring" }),
    ).toBeVisible();
    const afterSearch = await assign.boundingBox();
    await page.mouse.up();
    expect(afterSearch.y).toBeCloseTo(beforeSearch.y, 0);
    expect((await assigned).status()).toBe(200);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Решение на неделю сохранено" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Назначить вручную", exact: true })
      .click();
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
    // Text actions get their own column; icon-only reference lists retain three controls.
    await page.getByRole("tab", { name: "Каталог", exact: true }).click();
    const iconRow = page.locator(".list-row:not(.catalog-model-row)").first();
    await expect(iconRow).toBeVisible();
    expect(
      (
        await iconRow.evaluate((e) => getComputedStyle(e).gridTemplateColumns)
      ).split(" "),
    ).toHaveLength(4);
    await page
      .getByRole("button", { name: "Каталог велосипедов", exact: true })
      .click();
    const modelRow = page.locator(".catalog-model-row").first();
    await expect(modelRow).toBeVisible();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const dimensions = await modelRow.evaluate((row) => {
        const button = row.querySelector("button"),
          r = row.getBoundingClientRect(),
          b = button.getBoundingClientRect();
        return {
          fits:
            button.scrollWidth <= button.clientWidth &&
            b.right <= r.right + 1 &&
            b.left >= r.left,
          lines: getComputedStyle(button).whiteSpace,
        };
      });
      expect(dimensions.fits).toBe(true);
      expect(dimensions.lines).toBe("nowrap");
      await page.screenshot({
        path: info.outputPath(`catalog-edit-${width}.png`),
        fullPage: true,
      });
    }
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
    const storyUrl = page.url();
    await page.goto("/");
    const weekBand = page.locator('[data-home-band="bike-week"]');
    const image = weekBand.getByRole("img", {
      name: "Week touring",
      exact: true,
    });
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((e) => e.complete && e.naturalWidth > 0))
      .toBe(true);
    expect(await image.evaluate((e) => getComputedStyle(e).objectFit)).toBe(
      "contain",
    );
    const photoResponse = await page.request.get(
      await image.getAttribute("src"),
    );
    expect((await sharp(await photoResponse.body()).metadata()).hasAlpha).toBe(
      true,
    );
    for (const width of [390, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate((v) => {
          document.documentElement.dataset.theme = v;
        }, theme);
        const colors = await image.evaluate((e) => {
          const link = e.closest("a");
          const sample = document.createElement("span");
          sample.style.backgroundColor = "var(--surface)";
          link.append(sample);
          const result = [
            getComputedStyle(link).backgroundColor,
            getComputedStyle(sample).backgroundColor,
          ];
          sample.remove();
          return result;
        });
        expect(colors[0]).toBe(colors[1]);
        const bands = await page
          .locator("[data-home-band]")
          .evaluateAll((nodes) =>
            nodes.map((e) => ({
              padding: parseFloat(getComputedStyle(e).paddingTop),
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            })),
          );
        expect(bands).toHaveLength(4);
        for (const band of bands) {
          expect(band.padding).toBe(16);
          expect(band.left).toBeGreaterThanOrEqual(0);
          expect(band.right).toBeLessThanOrEqual(width);
        }
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-home-band="bike-week"]')
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`home-bands-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    await page.goto(storyUrl);
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
