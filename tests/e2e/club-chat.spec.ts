import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
import type { CurrentUser } from "../../lib/contracts.ts";
import type { ClubDto } from "../../lib/club-contracts.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100",
  headers = { origin };
async function person(request: APIRequestContext) {
  const r = await registerVerified(request, {
    headers,
    data: {
      ...testConsents,
      name: "Чат райдер " + randomUUID().slice(0, 5),
      email: randomUUID() + "@example.test",
      password: "club-chat-browser-413",
    },
  });
  expect(r.status()).toBe(201);
  const me: { user: CurrentUser } = await (await request.get("/api/me")).json();
  return me.user;
}
test("club >8: member-only internal CTA, separate external link, actual SDK and mute without leave", async ({
  page,
  browser,
}, info) => {
  const owner = await person(page.request);
  expect(
    (
      await page.request.post("/api/bikes", {
        headers,
        data: {
          name: "Клубный велосипед",
          brand: "Cube",
          model: "Travel",
          year: 2026,
          category: "road",
          is_public: false,
          description: "",
          color: "",
          size: "",
          weight: null,
        },
      })
    ).status(),
  ).toBe(201);
  const made: { club: ClubDto } = await (
    await page.request.post("/api/clubs", {
      headers,
      data: {
        name: "Клуб больших разговоров",
        joinMode: "open",
        requestId: randomUUID(),
      },
    })
  ).json();
  const c = made.club;
  expect(
    (
      await page.request.patch("/api/clubs/" + c.id + "/chat", {
        headers,
        data: {
          version: c.version,
          externalUrl: "https://example.org/club-chat",
        },
      })
    ).status(),
  ).toBe(200);
  const contexts = [];
  const users = [owner];
  try {
    for (let i = 0; i < 9; i++) {
      const ctx = await browser.newContext({ baseURL: origin });
      contexts.push(ctx);
      users.push(await person(ctx.request));
      expect(
        (
          await ctx.request.post("/api/clubs/" + c.id + "/membership", {
            headers,
            data: { action: "join" },
          })
        ).status(),
      ).toBe(200);
    }
    const guest = await browser.newContext({ baseURL: origin });
    contexts.push(guest);
    const gp = await guest.newPage();
    const sdkRequests: string[] = [];
    gp.on("request", (r) => {
      if (/stream-io-api/.test(r.url())) sdkRequests.push(r.url());
    });
    await gp.goto("/clubs/" + c.id);
    await expect(
      gp.getByRole("button", { name: "Чат клуба", exact: true }),
    ).toHaveCount(0);
    await expect(
      gp.getByRole("link", { name: "Дополнительный чат" }),
    ).toHaveCount(0);
    expect(
      (await guest.request.get("/api/clubs/" + c.id + "/chat")).status(),
    ).toBe(401);
    expect(sdkRequests).toEqual([]);
    const fixture = chatBrowserFixture(users);
    await fixture.install(page, owner);
    await page.goto("/clubs/" + c.id);
    await expect(
      page.getByRole("link", { name: "Дополнительный чат" }),
    ).toHaveAttribute("href", "https://example.org/club-chat");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        localStorage.setItem("cola:theme", t);
        window.dispatchEvent(new Event("storage"));
      }, theme);
      for (const width of [320, 360, 393, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`club-chat-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize(
      info.project.use.viewport || { width: 393, height: 852 },
    );
    await page.getByRole("button", { name: "Чат клуба", exact: true }).click();
    await expect(
      page.locator(".chat-conversation textarea").first(),
    ).toBeVisible();
    await page
      .locator(".chat-conversation textarea")
      .first()
      .fill("Разговор всего клуба");
    await page.locator(".chat-conversation textarea").first().press("Enter");
    await expect(
      page.locator(".chat-text").filter({ hasText: "Разговор всего клуба" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Участники и информация" }).click();
    await expect(
      page.getByRole("button", { name: /Выйти из группы/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Перейти в клуб/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Отключить уведомления/ }).click();
    const state: { club: ClubDto } = await (
      await page.request.get("/api/clubs/" + c.id)
    ).json();
    expect(state.club.membership?.state).toBe("active");
    expect(fixture.unexpected).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});
