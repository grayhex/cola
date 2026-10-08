import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
// #234, #370: «Подобрать время по интересам» in the planner (it was «Собрать
// компанию») — real, consenting interest as counts, a form that takes the
// chosen time and format but saves nothing by itself, then explicit
// invitations that the server re-checks. Several riders, each in their own
// session.
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const day = date(2);
// Each run has its own park: projects share one database.
const run = randomUUID().slice(0, 8),
  park = "Парк " + run;

async function member(request, name) {
  const response = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "organize-browser-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const zone = await request.patch("/api/social/preferences", {
    headers: { origin },
    data: { preferences: { timeZone: "Europe/Moscow" } },
  });
  expect(zone.status()).toBe(200);
  return (await response.json()).user;
}
async function intent(request, o = {}) {
  const r = await request.post("/api/ride-intents", {
    headers: { origin },
    data: {
      readiness: o.readiness || "ready",
      timeZone: "Europe/Moscow",
      windows: [{ startLocal: day + "T10:00", endLocal: day + "T15:00" }],
      passport: {
        area: { label: park },
        purpose: o.purpose || "social",
      },
      visibility: o.visibility || "community",
      allowSuggestions: o.allow ?? true,
      requestId: randomUUID(),
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).intent;
}

test("planner shows consenting interest, takes a time from it and invites explicitly", async ({
  page,
  browser,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Four riders: two who allow suggestions, one who does not, one private.
  const riders = [];
  for (const [name, o] of [
    ["Анна Готова", { readiness: "ready" }],
    ["Борис Прикидывает", { readiness: "considering" }],
    ["Вера Без предложений", { allow: false }],
    ["Глеб Приватный", { visibility: "private" }],
  ]) {
    const context = await browser.newContext({ baseURL: origin });
    const user = await member(context.request, `${name} ${run}`);
    riders.push({
      context,
      user,
      intent: await intent(context.request, o),
    });
  }
  try {
    await member(page.request, "Организатор");
    const bike = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name: "Organizer bike",
        brand: "Trek",
        model: "Checkpoint",
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
    });
    expect(bike.status()).toBe(201);
    // The organizer's own intent is not their own audience.
    await intent(page.request);
    // One planning action: the finder is a step of the planner.
    await page.goto("/rides");
    await page
      .getByRole("link", { name: "Запланировать покатушку", exact: true })
      .click();
    const planner = page.getByRole("dialog", {
      name: "Организовать покатушку",
    });
    await expect(planner.getByLabel("Дата", { exact: true })).toBeVisible();
    // Folded by default: no request for interest until it is opened.
    await expect(planner.getByLabel("Группы интереса")).toHaveCount(0);
    await planner.getByText("Подобрать время по интересам людей").click();
    const filters = planner.getByRole("region", {
      name: "Условия поиска компании",
    });
    await filters.getByLabel("Район или парк").fill(park);
    const groups = planner.getByLabel("Группы интереса");
    const row = groups.getByRole("article").first();
    await expect(row).toContainText("2 человека");
    await expect(row).toContainText("Готовы: 1");
    await expect(row).toContainText("Прикидывают: 1");
    // Counts only: no names, notes or windows of the people in a group.
    for (const r of riders)
      await expect(planner.getByText(r.user.name)).toHaveCount(0);
    // A format filter narrows the interest; a conflicting one leaves nothing.
    await filters.getByLabel("Цель").selectOption("training");
    await expect(
      planner.getByText("Под эти условия пока нет общего времени"),
    ).toBeVisible();
    await filters.getByLabel("Цель").selectOption("social");
    await expect(row).toContainText("2 человека");
    // Folding the section keeps the choices: the next opening finds them as
    // they were left, not reset to the defaults.
    const toggle = planner.getByText("Подобрать время по интересам людей");
    await toggle.click();
    await expect(planner.getByLabel("Группы интереса")).toHaveCount(0);
    await toggle.click();
    await expect(filters.getByLabel("Район или парк")).toHaveValue(park);
    await expect(filters.getByLabel("Цель")).toHaveValue("social");
    await expect(row).toContainText("2 человека");
    for (const [theme, system] of [
      ["light", "light"],
      ["dark", "light"],
      ["system", "dark"],
    ]) {
      await page.emulateMedia({ colorScheme: system });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      // Colours fade between themes: axe must read the settled ones.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running"),
      );
      expect(
        (await new AxeBuilder({ page }).include("dialog.planning").analyze())
          .violations,
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`organize-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    // «Выбрать это время»: the finder folds, the form takes the group's time
    // and format, nothing is saved yet.
    await row.getByRole("button", { name: /^Выбрать время/ }).click();
    await expect(planner.getByLabel("Группы интереса")).toHaveCount(0);
    await expect(planner.getByText("Время и формат взяты")).toBeVisible();
    await expect(planner.getByLabel("Дата", { exact: true })).toHaveValue(day);
    await expect(planner.getByLabel("Старт", { exact: true })).toHaveValue(
      "10:00",
    );
    await expect(planner.getByRole("button", { name: /^Цель:/ })).toContainText(
      "Общение",
    );
    expect(
      (await (await page.request.get("/api/rides?own=1")).json()).rides,
    ).toHaveLength(0);
    await planner
      .getByLabel("Название", { exact: true })
      .fill("Сокольники вместе");
    await planner
      .getByRole("textbox", { name: "Место встречи", exact: true })
      .fill("У входа");
    await planner
      .getByRole("button", { name: "Создать покатушку", exact: true })
      .click();
    await expect(planner).toHaveCount(0);
    const [plan] = (await (await page.request.get("/api/rides?own=1")).json())
      .rides;
    expect(plan.title).toBe("Сокольники вместе");
    // Saving a plan invites nobody.
    const detail = async () =>
      (
        await (
          await page.request.get("/api/rides/owner/" + plan.shareId)
        ).json()
      ).ride;
    expect((await detail()).invitations).toEqual([]);
    // Invitations: explicit choice among people who allow suggestions.
    const invite = page.getByRole("dialog", {
      name: "Пригласить заинтересованных",
    });
    const [anna, boris, vera, gleb] = riders;
    await expect(invite.getByText(anna.user.name)).toBeVisible();
    await expect(invite.getByText(boris.user.name)).toBeVisible();
    await expect(invite.getByText(vera.user.name)).toHaveCount(0);
    await expect(invite.getByText(gleb.user.name)).toHaveCount(0);
    const send = invite.getByRole("button", { name: /^Пригласить выбранных/ });
    await expect(send).toBeDisabled();
    await invite
      .getByRole("checkbox", { name: new RegExp(anna.user.name) })
      .check();
    await invite
      .getByRole("checkbox", { name: new RegExp(boris.user.name) })
      .check();
    // Between the view and the send, Boris withdraws his intent.
    const cancel = await boris.context.request.post(
      `/api/ride-intents/${boris.intent.id}/cancel`,
      { headers: { origin } },
    );
    expect(cancel.status()).toBe(200);
    const posts = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/invitations"))
        posts.push(r.url());
    });
    await send.dblclick();
    await expect(invite.getByRole("status")).toContainText(
      "Отправлено приглашений: 1",
    );
    await expect(invite.getByRole("status")).toContainText(
      `${boris.user.name}: Интерес изменился — не приглашён`,
    );
    expect(posts).toHaveLength(1);
    await expect(
      invite.getByRole("checkbox", { name: new RegExp(anna.user.name) }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("organize-invite.png"),
      fullPage: true,
      animations: "disabled",
    });
    await invite.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(invite).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Покатушка запланирована" }),
    ).toBeVisible();
    // Anna is invited and notified; no RSVP was made for her.
    const own = await detail();
    expect(own.invitations.map((i) => [i.username, i.response])).toEqual([
      [anna.user.username, "pending"],
    ]);
    const count = await (
      await anna.context.request.get("/api/community/notifications/count")
    ).json();
    expect(count.unread).toBeGreaterThan(0);
    const upcoming = await (
      await anna.context.request.get("/api/ride-matches/upcoming")
    ).json();
    expect(upcoming.rides.find((r) => r.id === own.id)?.role).toBe("invited");
    // An old «Собрать компанию» link opens the planner with the same choices.
    await page.goto("/rides?mode=organize&duration=short&purpose=social");
    await expect(page).toHaveURL(/\/account\?tab=rides&action=plan&interest=1/);
    const old = page.getByRole("dialog", { name: "Организовать покатушку" });
    await expect(
      old
        .getByRole("region", { name: "Условия поиска компании" })
        .getByLabel("Цель"),
    ).toHaveValue("social");
    // Closing the planner leaves a clean address.
    await old.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(old).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("?tab=rides");
    expect(errors).toEqual([]);
  } finally {
    for (const r of riders) await r.context.close();
  }
});

test("empty demand, an unavailable API and guests", async ({ page }) => {
  await member(page.request, "Одинокий организатор");
  // The finder is a step of the planner, which needs a bike to plan with.
  const bike = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Lonely bike",
      brand: "Trek",
      model: "Checkpoint",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
    },
  });
  expect(bike.status()).toBe(201);
  let failed = 0;
  await page.route("**/api/ride-matches/groups?**", (r) => {
    failed++;
    return r.fulfill({
      status: 500,
      json: { error: "Сервис подбора недоступен" },
    });
  });
  // No one wants an adventure in this run: an honest empty state.
  await page.goto("/rides?mode=organize&purpose=adventure");
  const planner = page.getByRole("dialog", { name: "Организовать покатушку" });
  await expect(planner.getByRole("alert")).toContainText(
    "Сервис подбора недоступен",
  );
  // One request per choice: the filter pause must not send the same one
  // again (it did 250 ms after opening, and a late copy leaked into the
  // guest check below).
  await page.waitForTimeout(600);
  expect(failed).toBe(1);
  await page.unroute("**/api/ride-matches/groups?**");
  await planner.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    planner.getByText("Под эти условия пока нет общего времени"),
  ).toBeVisible();
  await expect(
    planner.getByRole("link", { name: "Отметить, когда хочется кататься" }),
  ).toHaveAttribute("href", "/ride-intents");
  // With no interest the form is still there to be filled by hand.
  await expect(planner.getByLabel("Дата", { exact: true })).toBeVisible();
  // Guests: an old link asks to sign in without any request for interest.
  await page.request.post("/api/auth/logout", { headers: { origin } });
  const calls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ride-matches")) calls.push(r.url());
  });
  await page.goto("/rides?mode=organize");
  // The account page asks to sign in in place and keeps the planner request,
  // so signing in lands in the same planner.
  await expect(page).toHaveURL(/\/account\?tab=rides&action=plan&interest=1/);
  await expect(page.getByLabel("Пароль").first()).toBeVisible();
  await expect(page.getByText("Собрать компанию")).toHaveCount(0);
  expect(calls).toEqual([]);
});
