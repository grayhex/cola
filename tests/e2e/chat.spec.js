import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
import AxeBuilder from "@axe-core/playwright";
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
    await page.screenshot({
      path: testInfo.outputPath("chat-list.png"),
      fullPage: true,
    });
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
    await expect
      .poll(() => fixture.events.some((event) => event.type === "typing.start"))
      .toBe(true);
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
    await page
      .locator(".global-header")
      .getByRole("button", { name: "Открыть меню", exact: true })
      .click();
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

test("messenger: discover people, accessible selector, DM and group, drafts and browser back", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const context = await browser.newContext({ baseURL: origin });
  const thirdContext = await browser.newContext({ baseURL: origin });
  try {
    const suffix = randomUUID().slice(0, 7);
    const alice = await register(page, "Rider Alice " + suffix);
    const bob = await register(
      { request: context.request },
      "Rider Bob " + suffix,
    );
    const cara = await register(
      { request: thirdContext.request },
      "Rider Cara " + suffix,
    );
    const fixture = chatBrowserFixture([alice, bob, cara]);
    await fixture.install(page, alice);
    await page.goto("/messages");
    const sidebar = page.getByRole("complementary", { name: "Диалоги" });
    await expect(sidebar.getByText("Пока нет диалогов")).toBeVisible();
    await sidebar.getByRole("button", { name: "Найти собеседника" }).click();
    const selector = page.getByRole("dialog", {
      name: "Новое сообщение",
      exact: true,
    });
    const search = selector.getByRole("textbox", { name: "Имя или username" });
    await expect(search).toBeFocused();
    if (isMobile)
      expect((await selector.boundingBox()).width).toBeCloseTo(
        page.viewportSize().width,
        0,
      );
    await expect(selector.getByText("Ваши подписки")).toBeVisible();
    await search.fill("z");
    await expect(
      selector.getByText("Введите хотя бы 2 символа."),
    ).toBeVisible();
    await search.fill("no-such-person-" + suffix);
    await expect(selector.getByText(/Никого не нашли/)).toBeVisible();
    await page.route("**/api/chat/people?q=unavailable", (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Поиск временно недоступен" },
      }),
    );
    await search.fill("unavailable");
    await expect(selector.getByRole("alert")).toContainText(
      "Поиск временно недоступен",
    );
    await page.unroute("**/api/chat/people?q=unavailable");
    await selector.getByRole("button", { name: "Повторить поиск" }).click();
    await expect(selector.getByText(/Никого не нашли/)).toBeVisible();
    await search.fill("@" + bob.username);
    const bobOption = selector
      .getByRole("list", { name: "Найденные пользователи" })
      .getByRole("button", {
        name: new RegExp(bob.name),
      });
    await expect(bobOption).toBeVisible();
    // A real keyboard selection, not only a pointer click.
    await search.press("Tab");
    await expect(bobOption).toBeFocused();
    await bobOption.press("Enter");
    await expect(bobOption).toHaveAttribute("aria-pressed", "true");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("cola:theme", value);
        window.dispatchEvent(new Event("storage"));
      }, theme);
      await expect(page.locator(".cola-chat .str-chat").first()).toHaveClass(
        new RegExp("str-chat__theme-" + theme),
      );
      await page.screenshot({
        path: info.outputPath("chat-selector-" + theme + ".png"),
        fullPage: true,
      });
      const accessibility = await new AxeBuilder({ page })
        .include(".chat-selector")
        .analyze();
      expect(accessibility.violations).toEqual([]);
    }
    await selector.getByRole("button", { name: "Начать переписку" }).click();
    await expect(selector).toHaveCount(0);
    await expect(page).toHaveURL(/channel=colabike%3Adm_/);
    const input = page.getByPlaceholder("Написать сообщение…", { exact: true });
    await expect(input).toBeVisible();
    expect((await input.boundingBox()).height).toBeLessThan(60);
    await input.fill("Черновик маршрута");
    await page.goBack();
    await expect(page).toHaveURL(/\/messages$/);
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: new RegExp(bob.name) }).click();
    await expect(input).toHaveValue("Черновик маршрута");
    await input.press("Enter");
    await expect(
      page.locator(".chat-text").filter({ hasText: "Черновик маршрута" }),
    ).toBeVisible();
    if (isMobile)
      await page.getByRole("button", { name: "К списку диалогов" }).click();
    await expect(sidebar.locator(".chat-preview")).toContainText(
      "Вы: Черновик маршрута",
    );
    await sidebar
      .getByRole("button", { name: "Новое сообщение", exact: true })
      .click();
    await search.fill(bob.name);
    await selector.getByRole("button", { name: new RegExp(bob.name) }).click();
    await search.fill(cara.name);
    await selector.getByRole("button", { name: new RegExp(cara.name) }).click();
    await selector
      .getByRole("textbox", { name: "Название группы" })
      .fill("Субботняя покатушка: длинное название нашей группы");
    await selector.getByRole("button", { name: "Создать группу" }).click();
    await expect(page).toHaveURL(/channel=colabike%3Agroup_/);
    await expect(input).toBeVisible();
    await page.getByRole("button", { name: "Участники и информация" }).click();
    const details = page.getByRole("dialog", { name: "Участники группы" });
    await expect(details).toContainText(alice.name);
    await expect(details).toContainText(bob.name);
    await expect(details).toContainText(cara.name);
    await details.press("Escape");
    await expect(details).not.toBeVisible();
    await input.fill("Встречаемся у парка в 10:00");
    await input.press("Enter");
    await expect(
      page
        .locator(".chat-text")
        .filter({ hasText: "Встречаемся у парка в 10:00" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator(".chat-text")
        .filter({ hasText: "Встречаемся у парка в 10:00" }),
    ).toBeVisible();
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
        path: info.outputPath("chat-group-" + theme + ".png"),
        fullPage: true,
      });
      const accessibility = await new AxeBuilder({ page })
        .include(".chat-channels")
        .include(".chat-conversation-header")
        .analyze();
      expect(accessibility.violations).toEqual([]);
    }
    expect(fixture.unexpected).toEqual([]);
  } finally {
    await context.close();
    await thirdContext.close();
  }
});
