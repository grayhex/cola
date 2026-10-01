import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { publicPath } from "../../lib/public-urls.ts";
import { runNotificationEmailBatch } from "../../lib/notification-email.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("ride reminders: default on-site, independent mail, keyboard, rollback and reconfirmation", async ({
  page,
  browser,
}, info) => {
  const q = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const organizer = await browser.newContext({ baseURL: origin });
  const ids = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function api(request, path, method = "GET", data) {
    const response = await request.fetch("/api/" + path, {
      method,
      headers: { origin },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  // WebKit reports interrupted comment/prefetch requests as page errors.
  // Finish each document's requests before replacing it; retain error checks.
  async function visit(url) {
    await page.waitForLoadState("networkidle");
    await page.goto(url, { waitUntil: "networkidle" });
  }
  async function reload() {
    await page.waitForLoadState("networkidle");
    await page.reload({ waitUntil: "networkidle" });
  }
  try {
    for (const request of [organizer.request, page.request]) {
      expect(
        (
          await registerVerified(request, {
            headers: { origin },
            data: {
              ...testConsents,
              name: "Напоминания",
              email: randomUUID() + "@example.test",
              password: "ride-reminder-ui-secret-123",
            },
          })
        ).status(),
      ).toBe(201);
      ids.push((await api(request, "me")).user.id);
    }
    const bike = await api(organizer.request, "bikes", "POST", {
      name: "Reminder gravel",
      brand: "Cube",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      is_public: true,
    });
    const fields = {
      bikeId: bike.id,
      title: "Утренний круг",
      description: "С остановкой на кофе",
      scheduledAt: new Date(
        Math.ceil((Date.now() + 2 * 3600000) / 60000) * 60000,
      ).toISOString(),
      isPublic: true,
      privacyEnabled: true,
      privacyRadiusM: 500,
      meetingPoint: "Кафе у станции",
      meetingVisibility: "participants",
      recurrenceTimezone: "Europe/Moscow",
    };
    const created = await api(organizer.request, "rides/plan", "POST", fields);
    const { ride } = await api(
      organizer.request,
      "rides/owner/" + created.shareId,
    );
    const url = publicPath("ride", ride);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await visit(url);
    const status = page.getByTestId("ride-reminder-status");
    await expect(status).toContainText("после ответа «Иду»");
    const going = page
      .getByRole("group", { name: "Участие в покатушке" })
      .getByRole("button", { name: /^Иду/ });
    await going.focus();
    await page.keyboard.press("Enter");
    await expect(going).toHaveAttribute("aria-pressed", "true");
    await expect(status).toContainText("Напоминание на сайте:");
    await expect(status).toContainText("Письма о покатушках выключены");
    expect(
      (
        await runNotificationEmailBatch(q, {
          send: async () => {
            throw Error("no opt-in");
          },
        })
      ).sent,
    ).toBe(0);
    await reload();
    await expect(status).toContainText("доступно в уведомлениях");
    await visit("/notifications");
    await expect(page.locator("main")).toContainText("Утренний круг");
    await expect(page.locator("main")).toContainText("ColaBike ·");
    await page.screenshot({
      path: info.outputPath("ride-notification.png"),
      fullPage: true,
      animations: "disabled",
    });
    await visit("/account?tab=account");
    const settings = page.getByRole("region", { name: "Уведомления" });
    const reminder = settings.getByLabel(
      "Напоминать перед подтверждённой покатушкой",
    );
    const mail = settings.getByLabel("Получать уведомления по почте", {
      exact: true,
    });
    await expect(reminder).toBeChecked();
    await expect(mail).not.toBeChecked();
    await reminder.focus();
    await page.keyboard.press("Space");
    await settings
      .getByRole("button", { name: "Сохранить уведомления" })
      .click();
    await expect(settings.getByRole("status")).toContainText("сохранены");
    await visit(url);
    await expect(status).toContainText("Напоминание отключено");
    await visit("/account?tab=account");
    await page.route("**/api/account/notifications", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Настройки временно недоступны" }),
          })
        : route.continue(),
    );
    await reminder.check();
    await settings
      .getByRole("button", { name: "Сохранить уведомления" })
      .click();
    await expect(settings.getByRole("alert")).toContainText(
      "временно недоступны",
    );
    await expect(reminder).not.toBeChecked();
    await page.unroute("**/api/account/notifications");
    await reminder.check();
    await mail.check();
    await settings.getByLabel("Покатушки и приглашения").check();
    await settings
      .getByRole("button", { name: "Сохранить уведомления" })
      .click();
    await expect(settings.getByRole("status")).toContainText("сохранены");
    await api(organizer.request, "rides/" + ride.id, "PATCH", {
      ...fields,
      meetingPoint: "Главный вход в парк",
    });
    await visit(url);
    await expect(status).toContainText("после нового подтверждения");
    await expect(status).toContainText("Письма о покатушках включены");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      expect(
        (await new AxeBuilder({ page }).include("main").analyze()).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("ride-reconfirm-" + theme + ".png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    await going.focus();
    await page.keyboard.press("Enter");
    await expect(going).toHaveAttribute("aria-pressed", "true");
    await expect(status).toContainText("Напоминание на сайте:");
    // A temporary SMTP refusal does not become an RSVP error.
    expect(
      (
        await runNotificationEmailBatch(q, {
          send: async () => {
            throw { responseCode: 451 };
          },
        })
      ).retry,
    ).toBe(1);
    await reload();
    await expect(going).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ride-rsvp [role=alert]")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await organizer.close();
    await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
    await q.end();
  }
});
