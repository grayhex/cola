import { test, expect } from "@playwright/test";
test("CSP blocks untrusted inline scripts, keeps theme/navigation and delivers reports", async ({ page }) => {
  const response = await page.goto("/about");
  expect(response.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  const nonce = await page.locator("script[nonce]").first().evaluate(el => el.nonce);
  expect(nonce.length).toBeGreaterThan(20);
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  const report = page.waitForResponse(r => new URL(r.url()).pathname === "/api/csp-reports" && r.request().method() === "POST");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.cspUntrusted = true";
    document.head.appendChild(script);
  });
  expect(await page.evaluate(() => window.cspUntrusted)).toBeUndefined();
  expect((await report).status()).toBe(204);
  await page.evaluate(value => {
    const script = document.createElement("script");
    script.nonce = value;
    script.textContent = "window.cspTrusted = true";
    document.head.appendChild(script);
  }, nonce);
  expect(await page.evaluate(() => window.cspTrusted)).toBe(true);
  const violations = [];
  page.on("console", m => { if (/violates|Refused to|Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.getByRole("link", { name: "Велосипеды", exact: true }).first().click();
  await expect(page).toHaveURL(/\/bikes$/);
  expect(await page.locator("style[nonce]").first().evaluate(el => el.nonce)).toBe(nonce);
  expect(violations).toEqual([]);
});
