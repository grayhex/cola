import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// The choices of N1.3 (#341) in a real browser: when and from whom a person is
// told (pause, quiet hours, the circle, mutes), the filters of the list of
// notifications, and the notifications group of the administrator's app
// settings. The same settings object is read by the app.
async function member(request, name) {
  const email = randomUUID() + "@example.test";
  expect(
    (
      await registerVerified(request, {
        headers: { origin },
        data: {
          ...testConsents,
          name,
          email,
          password: "notification-policy-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
const settingsOf = async (request) =>
  (await request.get("/api/v1/me/notification-settings")).json();

test("account: pause, quiet hours, the circle and mutes are saved, shown again and reachable by keyboard", async ({
  page,
  browser,
}, info) => {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const other = await browser.newContext({ baseURL: origin });
  const ids = [];
  try {
    const me = await member(page.request, "Policy owner");
    const friend = await member(other.request, "Policy friend");
    ids.push(me.id, friend.id);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/account?tab=account");
    const policy = page.getByRole("group", { name: "Когда и от кого" });
    await expect(policy).toBeVisible();

    // A pause is one click, and one click lifts it.
    await policy.getByRole("button", { name: "На час" }).click();
    await expect(policy.getByRole("status").first()).toContainText("молчат до");
    expect((await settingsOf(page.request)).pausedUntil).toBeTruthy();
    await page.reload();
    await expect(policy.getByText("молчат до", { exact: false })).toBeVisible();
    await policy.getByRole("button", { name: "Снять паузу" }).click();
    await expect(policy.getByRole("button", { name: "На час" })).toBeVisible();
    expect((await settingsOf(page.request)).pausedUntil).toBeNull();

    // Quiet hours: nothing to save until something changes; a zone is chosen.
    const save = policy.getByRole("button", { name: "Сохранить тихие часы" });
    await expect(save).toBeDisabled();
    const enabled = policy.getByLabel("Не беспокоить письмами и push", {
      exact: false,
    });
    await enabled.focus();
    await page.keyboard.press("Space");
    await policy.getByLabel("С", { exact: true }).fill("23:30");
    await policy.getByLabel("До", { exact: true }).fill("06:45");
    await policy.getByLabel("Часовой пояс").selectOption("Europe/Moscow");
    await policy
      .getByLabel("Сообщать об отмене подтверждённой покатушки", {
        exact: false,
      })
      .check();
    await save.click();
    await expect(policy.getByRole("status").last()).toContainText(
      "Тихие часы сохранены",
    );
    const stored = await settingsOf(page.request);
    expect(stored.timeZone).toBe("Europe/Moscow");
    expect(stored.quietHours).toEqual({
      enabled: true,
      from: "23:30",
      to: "06:45",
      allowCancellations: true,
    });
    await page.reload();
    await expect(policy.getByLabel("С", { exact: true })).toHaveValue("23:30");

    // The circle: the choice, then the people picked by name.
    await policy.getByLabel("Выбранные люди", { exact: false }).first().check();
    await policy
      .getByLabel("Сообщать и о намерениях", { exact: false })
      .check();
    await policy.getByRole("button", { name: "Сохранить круг" }).click();
    await expect(policy.getByRole("status").last()).toContainText(
      "Круг сохранён",
    );
    const pick = policy.getByRole("group", { name: "Выбранные люди" });
    await pick
      .getByLabel("Добавить по имени пользователя")
      .fill("@" + friend.username);
    await pick.getByRole("button", { name: "Добавить" }).click();
    await expect(pick.getByText("Policy friend")).toBeVisible();
    expect((await settingsOf(page.request)).circle.members).toHaveLength(1);
    await pick.getByRole("button", { name: /Убрать из круга/ }).click();
    await expect(pick.getByText("Пока никого.")).toBeVisible();
    await pick
      .getByLabel("Добавить по имени пользователя")
      .fill("no-such-person-" + randomUUID().slice(0, 8));
    await pick.getByRole("button", { name: "Добавить" }).click();
    await expect(policy.getByRole("alert")).toContainText("Не нашли");

    // A mute: an author by name, and it comes back.
    const mutes = policy.getByRole("group", { name: "Заглушённое" });
    await expect(mutes.getByText("Ничего не заглушено.")).toBeVisible();
    await mutes
      .getByLabel("Заглушить автора по имени пользователя")
      .fill(friend.username);
    await mutes.getByRole("button", { name: "Заглушить" }).click();
    await expect(mutes.getByText("Policy friend")).toBeVisible();
    await mutes.getByRole("button", { name: /Вернуть/ }).click();
    await expect(mutes.getByText("Ничего не заглушено.")).toBeVisible();

    for (const color of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        color,
      );
      await expect
        .poll(
          async () =>
            (await new AxeBuilder({ page }).include("main").analyze())
              .violations,
        )
        .toEqual([]);
      await page.screenshot({
        path: info.outputPath("notification-policy-" + color + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }

    // A refusal says so and leaves the saved choice as it was.
    await page.route("**/api/v1/me/notification-settings", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "service_unavailable", message: "Не сохранилось" },
            }),
          })
        : route.continue(),
    );
    await policy.getByRole("button", { name: "На час" }).click();
    await expect(policy.getByRole("alert")).toContainText("Не сохранилось");
    expect((await settingsOf(page.request)).pausedUntil).toBeNull();
  } finally {
    await other.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.end();
  }
});

test("the list of notifications: the unread and one category, and nothing found says so", async ({
  page,
  browser,
}, info) => {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const other = await browser.newContext({ baseURL: origin });
  const ids = [];
  try {
    const me = await member(page.request, "List owner");
    const fan = await member(other.request, "List fan");
    ids.push(me.id, fan.id);
    // A follow (reactions) read, and a follow of another kind: a like (reactions) unread,
    // and a plan of a friend (plans).
    expect(
      (
        await other.request.put(
          "/api/social/profiles/" + me.username + "/follow",
          {
            headers: { origin },
          },
        )
      ).status(),
    ).toBeLessThan(300);
    await db.query(
      "UPDATE notifications SET read_at=now() WHERE recipient_id=$1",
      [me.id],
    );
    const bike = (
      await (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name: "Filter bike",
            brand: "Cube",
            model: "Travel",
            year: 2020,
            category: "road",
            description: "",
            color: "",
            size: "",
            weight: 14,
            is_public: true,
          },
        })
      ).json()
    ).id;
    expect(
      (
        await other.request.post("/api/community/bikes/" + bike + "/comments", {
          headers: { origin },
          data: { body: "Filter comment" },
        })
      ).status(),
    ).toBe(201);

    await page.goto("/notifications");
    const rows = page.locator(".notification-list li");
    await expect(rows).toHaveCount(2);
    const filters = page.getByRole("group", { name: "Какие уведомления" });
    await filters.getByRole("button", { name: "Непрочитанные" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("прокомментировал");
    await expect(
      filters.getByRole("button", { name: "Непрочитанные" }),
    ).toHaveAttribute("aria-pressed", "true");

    await filters.getByRole("button", { name: "Все" }).click();
    await page.getByLabel("Категория уведомлений").selectOption("reactions");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("подписался");

    await page.getByLabel("Категория уведомлений").selectOption("plans");
    await expect(rows).toHaveCount(0);
    await expect(
      page.getByText("По этому фильтру уведомлений нет."),
    ).toBeVisible();

    await page.getByLabel("Категория уведомлений").selectOption("");
    await expect(rows).toHaveCount(2);
    await expect
      .poll(
        async () =>
          (await new AxeBuilder({ page }).include("main").analyze()).violations,
      )
      .toEqual([]);
    await page.screenshot({
      path: info.outputPath("notification-filters.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await other.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.end();
  }
});

test("admin: the notifications group shows the catalogue, saves limits, explains reasons and tests to oneself", async ({
  page,
  browser,
}, info) => {
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const other = await browser.newContext({ baseURL: origin });
  const ids = [];
  try {
    const admin = await member(page.request, "Notice admin");
    const author = await member(other.request, "Explain author");
    ids.push(admin.id, author.id);
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin");
    await page
      .getByRole("tab", { name: "Мобильное приложение", exact: true })
      .click();
    const group = page.getByRole("region", { name: "Уведомления" });
    await expect(
      group.getByRole("heading", { name: "Уведомления", level: 2 }),
    ).toBeVisible();
    await expect(
      group.getByText("Согласие на письма и push даёт только"),
    ).toBeVisible();

    // The catalogue, as the code has it.
    await group.getByText("Каталог категорий и событий").click();
    await expect(
      group.getByRole("rowheader", { name: /Новые планы друзей/ }),
    ).toBeVisible();
    await expect(
      group.getByText("plan_published", { exact: false }),
    ).toBeVisible();

    // Limits: a change is saved on the version that was read, and shown again.
    const perDay = group.getByLabel("Предложений наружу на человека в сутки");
    await expect(perDay).toHaveValue("3");
    const save = group.getByRole("button", { name: "Сохранить" });
    await expect(save).toBeDisabled();
    await perDay.fill("5");
    await group.getByLabel(/Окончание срока объявлений/).check();
    await save.click();
    await expect(group.getByRole("status").first()).toContainText(
      "Настройки уведомлений сохранены",
    );
    await page.reload();
    await page
      .getByRole("tab", { name: "Мобильное приложение", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Уведомления" })
        .getByLabel("Предложений наружу на человека в сутки"),
    ).toHaveValue("5");
    expect(
      (
        await db.query(
          "SELECT target FROM admin_audit WHERE action='notifications.limits' AND actor_id=$1",
          [admin.id],
        )
      ).rows[0].target,
    ).toMatch(/discoveryPerDay,disabledCategories/);

    // Why: the reasons, in order, and nothing the people wrote.
    const region = page.getByRole("region", { name: "Уведомления" });
    await region.getByLabel("Автор (имя пользователя)").fill(author.username);
    await region
      .getByLabel("Получатель (имя пользователя)")
      .fill(admin.username);
    await region.getByRole("button", { name: "Разобрать" }).click();
    const answer = region.locator("ul li", { hasText: "Круг получателя" });
    await expect(answer).toContainText("автора в круге нет");
    await expect(region.getByText("уведомления не будет")).toBeVisible();
    await region
      .getByLabel("Получатель (имя пользователя)")
      .fill("no-such-person-" + randomUUID().slice(0, 8));
    await region.getByRole("button", { name: "Разобрать" }).click();
    await expect(region.getByRole("alert")).toContainText("Не нашли");

    // A test goes to oneself, and only if mail is configured.
    await region
      .getByRole("button", { name: "Отправить тестовое письмо себе" })
      .click();
    await expect(
      region.getByText("Тестовое письмо отправлено на ваш адрес"),
    ).toBeVisible();

    for (const color of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        color,
      );
      await expect
        .poll(
          async () =>
            (await new AxeBuilder({ page }).include("main").analyze())
              .violations,
        )
        .toEqual([]);
      await region.screenshot({
        path: info.outputPath("notification-admin-" + color + ".png"),
        animations: "disabled",
      });
    }

    // Not an administrator: the endpoints refuse.
    const refused = await other.request.get("/api/admin/notifications");
    expect(refused.status()).toBe(403);
    expect(
      (
        await other.request.put("/api/admin/notifications", {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
  } finally {
    await db.query(
      "UPDATE notification_limits SET discovery_per_day=3,disabled_categories='{}',version=version+1",
    );
    await other.close();
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await db.end();
  }
});
