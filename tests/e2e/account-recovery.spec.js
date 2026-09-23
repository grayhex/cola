import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const mailDir = process.env.MAIL_CAPTURE_DIR;

async function mailTo(to, subject) {
  for (let i = 0; i < 60; i++) {
    for (const file of (await readdir(mailDir).catch(() => []))
      .sort()
      .reverse()) {
      const mail = JSON.parse(await readFile(path.join(mailDir, file), "utf8"));
      if (mail.to === to && subject.test(mail.subject)) return mail;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No mail to " + to);
}
const link = (mail, route) =>
  mail.text.match(new RegExp(`https?://[^\\s]+${route}#[A-Za-z0-9_-]{43}`))[0];

test("forgotten password: request, email link, new password and confirmation", async ({
  page,
  playwright,
}) => {
  test.skip(!mailDir, "MAIL_CAPTURE_DIR is set by the test harness");
  const email = `browser-${randomUUID().slice(0, 8)}@recovery.test`;
  const api = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (
        await api.post("/api/auth/register", {
          headers: { origin },
          data: {
            ...testConsents,
            name: "Восстановление",
            email,
            password: "first-browser-pass",
          },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await api.dispose();
  }

  // Confirmation link from the registration email.
  await page.goto(
    link(await mailTo(email, /Подтвердите адрес/), "/verify-email"),
  );
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Адрес подтверждён",
  );
  expect(page.url()).not.toContain("#");

  await page.goto("/login");
  await page.getByRole("link", { name: "Забыли пароль?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByRole("button", { name: "Отправить ссылку" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Если адрес зарегистрирован",
  );

  await page.goto(
    link(await mailTo(email, /Восстановление пароля/), "/reset-password"),
  );
  await expect(
    page.getByRole("heading", { name: "Новый пароль" }),
  ).toBeVisible();
  // The token leaves the address bar before the form is used.
  await expect.poll(() => page.url()).not.toContain("#");
  await page.locator('input[name="password"]').fill("second-browser-pass");
  await page
    .locator('input[name="confirmPassword"]')
    .fill("different-browser-pass");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  // Next.js adds its own role="alert" route announcer outside <main>.
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Пароли не совпадают",
  );
  await page
    .locator('input[name="confirmPassword"]')
    .fill("second-browser-pass");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(
    page.getByRole("heading", { name: "Пароль изменён" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Открыть кабинет" }).click();
  await expect(page).toHaveURL(/\/account/);
  const me = await (await page.request.get("/api/me")).json();
  expect(me.user.email).toBe(email);
  await page.goto("/account?tab=account");
  await expect(page.getByRole("main").getByText("· подтверждён")).toBeVisible();

  // A used link shows the recovery path instead of a broken form.
  await page.goto("/reset-password#" + "z".repeat(43));
  await page.locator('input[name="password"]').fill("third-browser-pass");
  await page
    .locator('input[name="confirmPassword"]')
    .fill("third-browser-pass");
  await page.getByRole("button", { name: "Сохранить пароль" }).click();
  await expect(
    page.getByRole("heading", { name: "Ссылка не работает" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Запросить новую ссылку" }),
  ).toBeVisible();
});
