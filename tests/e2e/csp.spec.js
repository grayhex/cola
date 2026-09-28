import { test, expect } from "@playwright/test";
import pg from "pg";
test("CSP blocks untrusted inline scripts, keeps theme/navigation and delivers reports", async ({
  page,
  isMobile,
}) => {
  // The browser suite shares one disposable DB (workers=1). Earlier scenarios
  // can fill the global report bucket; this test needs a fresh delivery budget.
  // HTTP tests separately verify that exhausting this same budget returns 429.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("DELETE FROM rate_limits WHERE key='csp:global'");
  } finally {
    await db.end();
  }
  // Inject into the HTML parser, not through privileged Playwright evaluation
  // or a trusted script creating a non-parser-inserted child under strict-dynamic.
  await page.route("**/about", async (route) => {
    const response = await route.fetch();
    const policy = response.headers()["content-security-policy"];
    const nonce = policy.match(/'nonce-([^']+)'/)[1];
    const probes = `<script>window.cspUntrusted = true</script><script nonce="${nonce}">window.cspTrusted = true</script>`;
    await route.fulfill({
      response,
      body: (await response.text()).replace("</head>", probes + "</head>"),
    });
  });
  const report = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/csp-reports" &&
      r.request().method() === "POST",
  );
  const response = await page.goto("/about");
  expect(response.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  );
  const nonce = await page
    .locator("script[nonce]")
    .first()
    .evaluate((el) => el.nonce);
  expect(nonce.length).toBeGreaterThan(20);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /light|dark/,
  );
  expect(await page.evaluate(() => window.cspUntrusted)).toBeUndefined();
  expect((await report).status()).toBe(204);
  expect(await page.evaluate(() => window.cspTrusted)).toBe(true);
  const violations = [];
  page.on("console", (m) => {
    if (/violates|Refused to|Content Security Policy/i.test(m.text()))
      violations.push(m.text());
  });
  if (isMobile)
    await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .getByRole("link", { name: "Велосипеды", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/bikes$/);
  expect(
    await page
      .locator("style[nonce]")
      .first()
      .evaluate((el) => el.nonce),
  ).toBe(nonce);
  expect(violations).toEqual([]);
});
