import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { gpx, loop } from "../ride-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const password = "product-ui-browser-secret";
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("login and registration are complete forms, errors preserve input, passwords are confirmed", async ({
  page,
  playwright,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill("missing-" + randomUUID() + "@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page
    .locator(".auth-form")
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Неверная почта или пароль" }),
  ).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue(
    password,
  );
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  // #71: the username follows the name until edited; a taken one offers a
  // free variant.
  const other = await playwright.request.newContext({ baseURL: origin });
  const taken = "taken-" + randomUUID().slice(0, 8);
  const created = await other.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Занятое имя",
      email: randomUUID() + "@product-ui.test",
      password,
      username: taken,
    },
  });
  expect(created.status()).toBe(201);
  await other.dispose();
  await page.goto("/register");
  await page.getByLabel("Ваше имя", { exact: true }).fill("Новый участник");
  const username = page.getByLabel("Имя пользователя", { exact: true });
  const usernameHelp = page.locator("#username-help");
  await expect(username).toHaveValue(/^novyy-uchastnik(-\d+)?$/);
  await expect(usernameHelp).toContainText(
    "Свободно. Адрес профиля: /@novyy-uchastnik",
  );
  await username.fill(taken.toUpperCase());
  await expect(usernameHelp).toContainText("Имя @" + taken + " занято.");
  await page
    .getByRole("button", { name: "Взять @" + taken + "-2", exact: true })
    .click();
  await expect(username).toHaveValue(taken + "-2");
  await expect(usernameHelp).toContainText("Свободно");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(randomUUID() + "@product-ui.test");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page
    .getByLabel("Подтвердите пароль", { exact: true })
    .fill(password + "wrong");
  await page.getByRole("checkbox", { name: "Принять пользовательское соглашение" }).check();
  await page.getByRole("checkbox", { name: "Согласен с политикой обработки персональных данных" }).check();
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page.locator(".auth-form").getByRole("alert")).toHaveText(
    "Пароли не совпадают",
  );
  await page.getByLabel("Подтвердите пароль", { exact: true }).fill(password);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("register.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator(".account-content")).toBeVisible();
  const { user } = await (await page.request.get("/api/me")).json();
  expect(user.username).toBe(taken + "-2");
  expect(errors).toEqual([]);
});

test("the cabinet offers once to replace an automatic username (#71)", async ({
  page,
}) => {
  await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Старый аккаунт",
      email: randomUUID() + "@ui.test",
      password,
    },
  });
  const { user } = await (await page.request.get("/api/me")).json();
  // Accounts created before #71 kept the database default.
  const generated = "rider-" + randomUUID().replaceAll("-", "").slice(0, 24);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE users SET username=$2 WHERE id=$1", [
      user.id,
      generated,
    ]);
  } finally {
    await db.end();
  }
  await page.goto("/account");
  const prompt = page.locator(".username-prompt");
  await expect(prompt).toContainText("@" + generated);
  await prompt.getByRole("button", { name: "Не сейчас", exact: true }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".account-overview")).toBeVisible();
  await expect(prompt).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await prompt.getByRole("button", { name: "Выбрать имя", exact: true }).click();
  await expect(page).toHaveURL(/tab=profile/);
  const chosen = "renamed-" + randomUUID().slice(0, 8);
  await page.getByRole("textbox", { name: "Username" }).fill(chosen);
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Профиль сохранён" }),
  ).toBeVisible();
  await page.goto("/account");
  await expect(page.locator(".account-overview")).toContainText("@" + chosen);
  await expect(prompt).toHaveCount(0);
});

test("all product routes and account sections share clear light/dark UI; composer, profile menu and real speed data work", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Александр Смирнов",
      email: randomUUID() + "@ui.test",
      password,
    },
  });
  const { user } = await (await page.request.get("/api/me")).json();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    "UPDATE users SET role='admin', bio='Велосипед для города, длинных маршрутов и новых историй.', location='Санкт-Петербург' WHERE id=$1",
    [user.id],
  );
  const request = async (path, data) => {
    const r = await page.request.post("/api/" + path, {
      headers: { origin },
      data,
    });
    expect(r.ok()).toBe(true);
    return r.json();
  };
  const bike = await request("bikes", {
    name: "Canyon Grail CF 8",
    brand: "Canyon",
    model: "Grail CF 8",
    year: 2026,
    category: "gravel",
    description: "Один велосипед для города и поездок за его пределы.",
    color: "Песочный",
    size: "M",
    weight: 8.2,
    is_public: true,
  });
  const b = (await (await page.request.get("/api/bikes/" + bike.id)).json())
    .bike;
  const entry = await request("journal", {
    bikeId: bike.id,
    kind: "story",
    title: "Город заканчивается — маршрут продолжается",
    body: "Первый длинный маршрут на новой сборке. Проверил посадку, сменил покрышки и нашёл тихую дорогу вдоль реки.\n\nСамое приятное — возвращаться с новыми идеями для следующей поездки.",
    status: "published",
    isPublic: true,
  });
  const preview = await request("rides/preview", gpx([loop]));
  const ride = await request("rides", {
    previewId: preview.previewId,
    bikeId: bike.id,
    title: "Утро вдоль реки",
    description: "Кольцевой маршрут без спешки.",
    isPublic: true,
    privacyEnabled: true,
    privacyRadiusM: 500,
  });
  await page.request.put("/api/journal/" + entry.id + "/save", {
    headers: { origin },
  });
  const comment = await request("journal/" + entry.id + "/comments", {
    body: "Какие покрышки лучше показали себя на грунте?",
  });
  await request("journal/" + entry.id + "/comments", {
    parentId: comment.id,
    body: "На сухом грунте понравились покрышки 40 мм: держат уверенно, а на асфальте не мешают катить.",
  });
  const detail = await (
    await page.request.get("/api/rides/public/" + ride.shareId)
  ).json();
  expect(detail.ride.speedProfile.flat().length).toBeGreaterThan(0);
  const routes = [
    ["/", "#hero-title", "home"],
    ["/bikes", ".bike-card", "bikes"],
    ["/b/" + b.share_id, ".bike-heading", "bike"],
    ["/journal", ".journal-card", "journal"],
    ["/j/" + entry.shareId, ".journal-body", "post"],
    ["/j/new?bike=" + bike.id, ".journal-editor", "composer"],
    ["/rides", ".ride-card", "rides"],
    [
      "/r/" + ride.shareId,
      'svg[aria-label="График скорости по расстоянию"]',
      "ride",
    ],
    ["/u/" + user.username, ".profile-hero", "profile"],
    ["/saved", ".journal-card", "saved"],
    ["/feed", "main", "feed"],
    ["/notifications", "main", "notifications"],
    ["/records", ".hall-heading", "records"],
    ["/about", "main", "about"],
    ["/search?q=Canyon", "main", "search"],
    ["/experience?q=Canyon", "main", "experience"],
    ["/missing-product-page", "main", "404"],
    ...[
      "overview",
      "profile",
      "bikes",
      "rides",
      "social",
      "achievements",
      "appearance",
      "account",
    ].map((tab) => [
      "/account?tab=" + tab,
      ".account-content",
      "account-" + tab,
    ]),
    ["/admin", ".admin-content", "admin"],
  ];
  try {
    for (const mode of ["light", "dark"]) {
      for (const [url, ready, name] of routes) {
        // Audit each direct URL in its own page. Replacing an active document
        // cancels Next prefetches, which WebKit reports as fetch pageerrors.
        // Navigation/history behavior is covered separately in gallery tests.
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(
          (mode) => localStorage.setItem("cola:theme", mode),
          mode,
        );
        try {
          await page.goto(url);
          await expect(page.locator(ready).first()).toBeVisible();
          if (await page.locator(".discussion").count()) {
            await expect(
              page
                .getByRole("status")
                .filter({ hasText: "Загружаем обсуждение" }),
            ).not.toBeVisible();
          }
          if (name === "ride") {
            const chart = page.getByRole("img", {
              name: "График скорости по расстоянию",
            });
            await expect
              .poll(async () => (await chart.boundingBox()).height)
              .toBeGreaterThan(180);
            await expect(
              page.getByRole("region", { name: "Скорость" }),
            ).toHaveAttribute("aria-busy", "false");
            await chart.hover();
            await expect(
              page
                .getByRole("region", { name: "Скорость" })
                .locator('[aria-live="polite"]'),
            ).toContainText(/на \d+[,.]?\d* км/);
          }
          if (name === "post")
            await expect(page.locator(".comment-body")).toHaveCount(2);
          await page.evaluate(() => document.fonts.ready);
          await noOverflow(page);
          await page.screenshot({
            path: info.outputPath(name + "-" + mode + ".png"),
            fullPage: true,
            animations: "disabled",
          });
        } finally {
          await page.close();
        }
      }
    }
    await page.goto("/j/new?bike=" + bike.id);
    const body = page.getByRole("textbox", {
      name: "Текст записи",
      exact: true,
    });
    await body.fill("Мой новый маршрут <script>plain text</script>");
    await page.getByRole("tab", { name: "Предпросмотр", exact: true }).click();
    await expect(
      page.getByRole("tabpanel").filter({ visible: true }),
    ).toContainText("Мой новый маршрут <script>plain text</script>");
    await page.getByRole("tab", { name: "Написать", exact: true }).click();
    await expect(body).toHaveText(
      "Мой новый маршрут <script>plain text</script>",
    );
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/account");
    const menu = page.getByRole("button", {
      name: "Открыть меню",
      exact: true,
    });
    if (await menu.isVisible()) await menu.click();
    else
      await page
        .getByRole("button", {
          name: "Аккаунт — Александр Смирнов",
          exact: true,
        })
        .click();
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("profile-menu.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
