import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #70: the «Account» tab changes the password, lists devices, downloads the
// data and deletes the account; afterwards the public profile is gone.
test("account tab: password, devices, data export and deletion", async ({
  page,
  browser,
}, info) => {
  const nonce = randomUUID().slice(0, 8),
    email = `security-${nonce}@example.test`;
  const register = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Security " + nonce,
      email,
      password: "security-first-123",
    },
  });
  expect(register.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  // A second device signed in to the same account.
  const other = await browser.newContext({ baseURL: origin });
  try {
    expect(
      (
        await other.request.post("/api/auth/login", {
          headers: { origin },
          data: { email, password: "security-first-123" },
        })
      ).status(),
    ).toBe(200);

    await page.goto("/account?tab=account");
    const devices = page.getByRole("list", { name: "Устройства со входом" });
    await expect(devices.getByRole("listitem")).toHaveCount(2);
    await expect(devices.getByText("Этот браузер")).toHaveCount(1);

    // Password: a mismatch stays on the client, a wrong current password is
    // refused by the server, the right one signs the other device out.
    const password = page.getByRole("region", { name: "Пароль" });
    await password.getByLabel("Текущий пароль").fill("security-first-123");
    await password
      .getByLabel("Новый пароль", { exact: true })
      .fill("security-second-456");
    await password
      .getByLabel("Новый пароль ещё раз")
      .fill("security-other-789");
    await password.getByRole("button", { name: "Сменить пароль" }).click();
    await expect(password.getByText("Пароли не совпадают")).toBeVisible();
    await password
      .getByLabel("Новый пароль ещё раз")
      .fill("security-second-456");
    await password.getByLabel("Текущий пароль").fill("wrong-password-000");
    await password.getByRole("button", { name: "Сменить пароль" }).click();
    await expect(password.getByRole("alert")).toContainText(
      "Текущий пароль не подходит",
    );
    await password.getByLabel("Текущий пароль").fill("security-first-123");
    await password
      .getByLabel("Новый пароль", { exact: true })
      .fill("security-second-456");
    await password
      .getByLabel("Новый пароль ещё раз")
      .fill("security-second-456");
    await password.getByRole("button", { name: "Сменить пароль" }).click();
    await expect(password.getByRole("status")).toContainText("Пароль изменён");
    expect((await (await other.request.get("/api/me")).json()).user).toBeNull();
    await page.reload();
    await expect(devices.getByRole("listitem")).toHaveCount(1);

    // Data export downloads a JSON file with the profile.
    const exporting = page.waitForEvent("download");
    await page
      .getByRole("region", { name: "Мои данные" })
      .getByRole("button", { name: "Скачать мои данные" })
      .click();
    const download = await exporting;
    expect(download.suggestedFilename()).toMatch(/^colabike-.+\.json$/);
    const data = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(data.profile.email).toBe(email);

    await page.screenshot({
      path: info.outputPath("account-security.png"),
      fullPage: true,
      animations: "disabled",
    });

    // Deletion needs the password and the word; afterwards the profile is gone.
    const danger = page.getByRole("region", { name: "Удаление аккаунта" });
    await danger.getByLabel("Пароль").fill("security-second-456");
    await danger.getByLabel("Введите слово УДАЛИТЬ").fill("УДАЛИТЬ");
    await danger
      .getByRole("button", { name: "Удалить аккаунт навсегда" })
      .click();
    await expect(page).toHaveURL(origin + "/");
    expect((await (await page.request.get("/api/me")).json()).user).toBeNull();
    const profile = await page.goto("/@" + user.username);
    expect(profile.status()).toBe(404);
  } finally {
    await other.close();
  }
});
