import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
for (const theme of ["light", "dark"])
  test(`RWGPS OAuth, sync and disconnect · ${theme}`, async ({
    page,
  }, info) => {
    const r = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Sync Rider",
        email: randomUUID() + "@example.test",
        password: "browser-sync-secret-123",
      },
    });
    expect(r.status()).toBe(201);
    expect(
      (
        await page.request.post("/api/bikes", {
          headers: { origin },
          data: {
            name: "Sync gravel",
            brand: "Giant",
            model: "Revolt",
            year: 2026,
            category: "gravel",
            description: "",
            color: "",
            size: "M",
            weight: 9,
            is_public: false,
          },
        })
      ).status(),
    ).toBe(201);
    await page.addInitScript(
      (value) => localStorage.setItem("cola:theme", value),
      theme,
    );
    const vendorId = Math.floor(Math.random() * 1000000) + 4000000;
    await page.route("https://ridewithgps.com/oauth/authorize?**", (route) => {
      const url = new URL(route.request().url()),
        callback = new URL(url.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", url.searchParams.get("state"));
      callback.searchParams.set("code", String(vendorId));
      return route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
      });
    });
    await page.goto("/account?tab=rides");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const panel = page.getByRole("region", {
      name: "Ride with GPS",
      exact: true,
    });
    await expect(
      panel.getByRole("button", { name: "Подключить Ride with GPS" }),
    ).toBeEnabled({ timeout: 15000 });
    await panel
      .getByLabel("Велосипед для импорта")
      .selectOption({ label: "Sync gravel" });
    await panel
      .getByRole("button", { name: "Подключить Ride with GPS" })
      .click();
    await expect(panel.getByText("Подключено", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Импортировано: 1/)).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText("Тестовая велопоездка RWGPS").first(),
    ).toBeVisible({ timeout: 10000 });
    await panel.getByLabel("Велосипед для импорта").selectOption("");
    await page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/activity-sync/rwgps" &&
        response.request().method() === "GET",
    );
    await expect(panel.getByLabel("Велосипед для импорта")).toHaveValue("");
    await panel
      .getByRole("button", { name: "Синхронизировать сейчас" })
      .click();
    await expect(panel.getByRole("status")).toContainText(
      "поставлена в очередь",
    );
    expect(
      (await (await page.request.get("/api/activity-sync/rwgps")).json())
        .bikeId,
    ).toBeNull();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .include('[aria-label="Ride with GPS"]')
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`activity-sync-${theme}.png`),
      fullPage: true,
    });
    await panel
      .getByRole("button", { name: "Отключить Ride with GPS" })
      .click();
    await expect(
      panel.getByRole("button", { name: "Подключить Ride with GPS" }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(
      page.getByText("Тестовая велопоездка RWGPS").first(),
    ).toBeVisible();
  });
