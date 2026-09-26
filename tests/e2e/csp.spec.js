import { test, expect } from "@playwright/test";
test("CSP blocks untrusted inline scripts, keeps theme/navigation and delivers reports", async ({ page, isMobile }) => {
  // Inject into the HTML parser, not through privileged Playwright evaluation
  // or a trusted script creating a non-parser-inserted child under strict-dynamic.
  await page.route("**/about", async route => {
    const response = await route.fetch();
    const nonce = response.headers()["content-security-policy"].match(/'nonce-([^']+)'/)[1];
    const probes = `<script>window.cspUntrusted = true</script><script nonce="${nonce}">window.cspTrusted = true</script>`;
    await route.fulfill({ response, body: (await response.text()).replace("</head>", probes + "</head>") });
  });
  const report = page.waitForResponse(r => new URL(r.url()).pathname === "/api/csp-reports" && r.request().method() === "POST");
  const response = await page.goto("/about");
  expect(response.headers()["content-security-policy"]).toContain("'strict-dynamic'");
  const nonce = await page.locator("script[nonce]").first().evaluate(el => el.nonce);
  expect(nonce.length).toBeGreaterThan(20);
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  expect(await page.evaluate(() => window.cspUntrusted)).toBeUndefined();
  expect((await report).status()).toBe(204);
  expect(await page.evaluate(() => window.cspTrusted)).toBe(true);
  const violations = [];
  page.on("console", m => { if (/violates|Refused to|Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  if (isMobile) await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.getByRole("link", { name: "Велосипеды", exact: true }).first().click();
  await expect(page).toHaveURL(/\/bikes$/);
  expect(await page.locator("style[nonce]").first().evaluate(el => el.nonce)).toBe(nonce);
  expect(violations).toEqual([]);
});
