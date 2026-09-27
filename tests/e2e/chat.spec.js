import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(page, name) {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "chat-browser-password-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
test("messages: real SDK, two isolated sessions, DM delivery, mobile list and both themes", async ({
  page,
  browser,
  isMobile,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  const bobPage = await context.newPage();
  try {
    const alice = await register(page, "Chat Alice"),
      bob = await register(bobPage, "Chat Bob");
    const fixture = chatBrowserFixture([alice, bob]);
    await fixture.install(page, alice);
    await fixture.install(bobPage, bob);
    await page.goto("/messages?to=" + bob.id);
    const input = page.locator(".chat-conversation textarea").first();
    await expect(input).toBeVisible();
    // Mobile shows either the conversation or the list. Open the list before
    // querying its accessible buttons, just as the user would.
    if (isMobile)
      await page.getByRole("button", { name: "К списку диалогов" }).click();
    const dialog = page
      .locator(".chat-channels")
      .getByRole("button", { name: /Chat Bob/ });
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
    if (isMobile) {
      await dialog.click();
      await expect(input).toBeVisible();
    }
    await input.fill("Поедем кататься в субботу?");
    await input.press("Enter");
    await expect(
      page
        .locator(".chat-text")
        .filter({ hasText: "Поедем кататься в субботу?" }),
    ).toBeVisible();
    await bobPage.goto("/messages?to=" + alice.id);
    await expect(
      bobPage
        .locator(".chat-text")
        .filter({ hasText: "Поедем кататься в субботу?" }),
    ).toBeVisible();
    const answer = bobPage.locator(".chat-conversation textarea").first();
    await answer.fill("Да, в десять!");
    await answer.press("Enter");
    await expect(
      page.locator(".chat-text").filter({ hasText: "Да, в десять!" }),
    ).toBeVisible();
    await expect.poll(() => fixture.reads.length).toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: /Сообщения: / })).toBeVisible();
    if (isMobile) {
      await page.getByRole("button", { name: "К списку диалогов" }).click();
      await expect(
        page.getByRole("complementary", { name: "Диалоги" }),
      ).toBeVisible();
      await page.getByRole("button", { name: /Chat Bob/ }).click();
      await expect(input).toBeVisible();
    }
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("cola:theme", value);
        window.dispatchEvent(new Event("storage"));
      }, theme);
      await expect(page.locator(".cola-chat .str-chat").first()).toHaveClass(
        new RegExp("str-chat__theme-" + theme),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("chat-" + theme + ".png"),
        fullPage: true,
      });
    }
    expect(fixture.unexpected).toEqual([]);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await expect(
      page
        .locator(".navigation-drawer")
        .getByRole("link", { name: /^Сообщения/ }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("messages connection failure keeps navigation usable and offers retry", async ({
  page,
}) => {
  await register(page, "Chat retry");
  await page.route("**/api/chat/token", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("/messages");
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".global-header")).toBeVisible();
});
