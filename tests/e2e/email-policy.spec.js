import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { testConsents } from "../fixtures/legal.js";
import { verifyCapturedEmail } from "../fixtures/verified-user.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("email policy preserves the listing draft while resending and confirming email", async ({ page }) => {
  const email = `policy-ui-${randomUUID()}@example.test`;
  const response = await page.request.post("/api/auth/register", {
    headers: { origin }, data: { ...testConsents, name: "Policy UI", email, password: "policy-ui-secret-123" },
  });
  expect(response.status()).toBe(201);
  await page.goto("/market/new");
  const title = page.getByRole("textbox", { name: "Название", exact: true });
  const description = page.getByRole("textbox", { name: "Описание", exact: true });
  await title.fill("Keep my policy draft");
  await description.fill("My text must survive email confirmation");
  const blocked = page.waitForResponse(r => new URL(r.url()).pathname === "/api/market" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  expect((await (await blocked).json()).code).toBe("EMAIL_VERIFICATION_REQUIRED");
  await expect(page.locator("main").getByRole("alert")).toContainText("Подтвердите почту");
  await page.getByRole("button", { name: "Отправить письмо повторно", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Письмо отправлено");
  await expect(title).toHaveValue("Keep my policy draft");
  await expect(description).toHaveValue("My text must survive email confirmation");
  await verifyCapturedEmail(email);
  await page.getByRole("button", { name: "Я подтвердил почту", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Почта подтверждена");
  await expect(title).toHaveValue("Keep my policy draft");
  await expect(description).toHaveValue("My text must survive email confirmation");
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Keep my policy draft", exact: true })).toBeVisible();
});
