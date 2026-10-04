import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { legalRequestsAfterSignup, testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
import { publicPath } from "../../lib/public-urls.ts";

// #235: one participation state per person and date, agreements with
// editions, closed recruitment, the public announcement, link and QR.
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const nonce = randomUUID().slice(0, 8);
const hour = 3600000;
const inHours = (h) =>
  new Date(Math.ceil((Date.now() + h * hour) / 60000) * 60000).toISOString();
let organizer, organizerUser, bike;

async function person(browser, name, { verified = true } = {}) {
  const context = await browser.newContext({ baseURL: origin });
  const data = {
    ...testConsents,
    name,
    email: randomUUID() + "@example.test",
    password: "agreements-browser-secret-123",
  };
  const options = { headers: { origin }, data };
  const response = verified
    ? await registerVerified(context.request, options)
    : await context.request.post("/api/auth/register", options);
  expect(response.status()).toBe(201);
  const user = (await (await context.request.get("/api/me")).json()).user;
  return { context, user };
}
async function api(context, method, path, data) {
  const response = await context.request.fetch("/api/" + path, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function plan(fields = {}) {
  const created = await api(organizer, "POST", "rides/plan", {
    bikeId: bike.id,
    title: "Круг " + nonce + " " + randomUUID().slice(0, 4),
    description: "Спокойно, с остановкой на кофе.",
    isPublic: true,
    privacyEnabled: false,
    privacyRadiusM: 500,
    scheduledAt: inHours(52),
    expectedEndAt: inHours(55),
    recurrenceTimezone: "Europe/Moscow",
    meetingPoint: "Секретная встреча " + nonce,
    meetingVisibility: "participants",
    passport: {
      area: { label: "Парк " + nonce },
      purpose: "social",
      pace: "relaxed",
      groupSize: { min: 2, max: 4 },
    },
    ...fields,
  });
  const { ride } = await api(
    organizer,
    "GET",
    "rides/owner/" + created.shareId,
  );
  return ride;
}
/** The owner's edit with the plan's current values plus `changes`. */
async function edit(ride, changes) {
  const { ride: current } = await api(
    organizer,
    "GET",
    "rides/owner/" + ride.shareId,
  );
  await api(organizer, "PATCH", "rides/" + ride.id, {
    bikeId: current.bike.id,
    title: current.title,
    description: current.description,
    isPublic: current.isPublic,
    privacyEnabled: current.privacyEnabled,
    privacyRadiusM: current.privacyRadiusM,
    scheduledAt: current.startedAt,
    expectedEndAt: current.planEndsAt,
    meetingPoint: current.meetingPoint,
    meetingVisibility: current.meetingVisibility,
    passport: current.passport,
    invitations: current.invitations.map((i) => i.username),
    ...changes,
  });
}
async function settle(page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
}
async function themes(page, info, name) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await settle(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("main").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`${name}-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
}

test.beforeAll(async ({ browser }) => {
  ({ context: organizer, user: organizerUser } = await person(
    browser,
    "Организатор " + nonce,
  ));
  bike = await api(organizer, "POST", "bikes", {
    name: "Agreements gravel",
    brand: "Giant",
    model: "Revolt",
    year: 2026,
    category: "gravel",
    description: "",
    color: "",
    size: "M",
    weight: 9,
    is_public: true,
  });
});
test.afterAll(async () => {
  await organizer?.close();
});

test("a guest reads the announcement, signs up on the ride and answers; organizer summary, closed recruitment and a new edition", async ({
  page,
  browser,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ride = await plan();
  const url = publicPath("ride", ride);
  const secret = "Секретная встреча " + nonce;
  // Guest: date in the ride's zone, format, area and organizer; no place.
  const html = await (await page.request.get(url)).text();
  expect(html).not.toContain(secret);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ride.title);
  const terms = page.getByRole("region", { name: "Договорённости" });
  await expect(terms).toContainText("GMT+3");
  await expect(terms).toContainText("Парк " + nonce);
  await expect(terms).toContainText("Откроется участникам после ответа «Иду»");
  await expect(page.locator("main")).toContainText("Организатор " + nonce);
  const description = await page
    .locator('meta[property="og:description"]')
    .getAttribute("content");
  expect(description).toContain("Парк " + nonce);
  expect(description).toContain("организатор: Организатор " + nonce);
  expect(description).not.toContain(secret);
  await themes(page, info, "announcement-guest");
  // Sign up without leaving the ride: the same address, checked again.
  await page.getByRole("button", { name: "Войти и ответить" }).click();
  const dialog = page.getByRole("dialog", { name: "Вход" });
  await dialog
    .getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" })
    .click();
  const register = page.getByRole("dialog", { name: "Регистрация" });
  await register.getByLabel("Ваше имя").fill("Новичок " + nonce);
  await register
    .getByLabel("Электронная почта")
    .fill(randomUUID() + "@example.test");
  await register
    .getByLabel("Пароль", { exact: true })
    .fill("agreements-browser-secret-123");
  await register
    .getByLabel("Подтвердите пароль")
    .fill("agreements-browser-secret-123");
  await register.getByRole("checkbox").first().check();
  await register.getByRole("checkbox").nth(1).check();
  const lateLegal = legalRequestsAfterSignup(page);
  await Promise.all([
    page.waitForEvent("load"),
    register.getByRole("button", { name: /Создать аккаунт/ }).click(),
  ]);
  await expect(page).toHaveURL(new RegExp(url + "$"));
  expect(lateLegal).toEqual([]);
  const panel = page.getByRole("region", { name: "Участие", exact: true });
  await expect(panel).toContainText("Отметьте, поедете ли вы");
  // No bike needed; the answer opens the hidden place.
  const rsvp = panel.getByRole("group", { name: "Участие в покатушке" });
  await rsvp.getByRole("button", { name: /^Иду/ }).click();
  await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(terms).toContainText(secret);
  await expect(panel).toContainText("Вы едете");
  // Keyboard: the same buttons, focus stays on the pressed one.
  const maybe = rsvp.getByRole("button", { name: /^Может быть/ });
  await maybe.focus();
  await page.keyboard.press("Space");
  await expect(maybe).toHaveAttribute("aria-pressed", "true");
  await expect(maybe).toBeFocused();
  await expect(terms).not.toContainText(secret);
  await rsvp.getByRole("button", { name: /^Иду/ }).focus();
  await page.keyboard.press("Enter");
  await expect(terms).toContainText(secret);
  await themes(page, info, "participant");

  // Organizer: names and states, then closes the recruitment.
  const own = await organizer.newPage();
  await own.goto(url);
  const summary = own.getByRole("region", { name: "Ответы участников" });
  await expect(summary).toContainText("Новичок " + nonce);
  await expect(summary.getByText("Идёт", { exact: true })).toBeVisible();
  await summary.getByRole("button", { name: "Закрыть набор" }).click();
  await expect(summary.getByRole("status")).toHaveText("Набор закрыт");
  await expect(own.locator("header").getByText("Набор закрыт")).toBeVisible();
  await themes(own, info, "organizer");

  // A newcomer cannot join a closed date; the participant keeps the place.
  const late = await person(browser, "Опоздавший " + nonce);
  try {
    const latePage = await late.context.newPage();
    await latePage.goto(url);
    const lateRsvp = latePage.getByRole("group", {
      name: "Участие в покатушке",
    });
    await expect(
      latePage.getByRole("region", { name: "Участие", exact: true }),
    ).toContainText("Набор закрыт");
    await expect(lateRsvp.getByRole("button", { name: /^Иду/ })).toBeDisabled();
    await expect(
      lateRsvp.getByRole("button", { name: /^Не иду/ }),
    ).toBeEnabled();
    expect(
      (
        await late.context.request.patch(`/api/rides/${ride.id}/rsvp`, {
          headers: { origin },
          data: { response: "accepted", occurrenceAt: ride.scheduledAt },
        })
      ).status(),
    ).toBe(409);
  } finally {
    await late.context.close();
  }

  // A new place is a new edition: the old «Иду» is not agreement with it.
  await edit(ride, { meetingPoint: "Новая точка " + nonce });
  await page.reload();
  await expect(panel.locator(".notice")).toContainText(
    "Условия изменились — подтвердите заново",
  );
  await expect(terms).toContainText("место встречи");
  for (const name of [/^Иду/, /^Может быть/, /^Не иду/])
    await expect(rsvp.getByRole("button", { name })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
    "data-previous",
    "true",
  );
  await page.screenshot({
    path: info.outputPath("reconfirm.png"),
    fullPage: true,
    animations: "disabled",
  });
  await rsvp.getByRole("button", { name: /^Иду/ }).click();
  await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(terms).toContainText("Новая точка " + nonce);
  // A typo fix keeps the answer.
  await edit(ride, { meetingPoint: "Новая точкка " + nonce });
  await page.reload();
  await expect(panel).toContainText("Вы едете");
  await own.close();
  expect(errors).toEqual([]);
});

test("a closed plan opens for invited people only; revoking ends access; the preview stays neutral", async ({
  page,
  browser,
}, info) => {
  const invitee = await person(browser, "Приглашённый " + nonce);
  const stranger = await person(browser, "Чужой " + nonce);
  try {
    const ride = await plan({
      isPublic: false,
      invitations: [invitee.user.username],
    });
    const url = publicPath("ride", ride);
    // Guests and strangers: a real 404 and a neutral preview.
    const guest = await page.request.get(url);
    expect(guest.status()).toBe(404);
    const guestHtml = await guest.text();
    expect(guestHtml).not.toContain(ride.title);
    expect(guestHtml).not.toContain("Парк " + nonce);
    expect(
      (
        await stranger.context.request.get("/api/rides/public/" + ride.shareId)
      ).status(),
    ).toBe(404);
    expect(
      (
        await stranger.context.request.patch(`/api/rides/${ride.id}/rsvp`, {
          headers: { origin },
          data: { response: "accepted", occurrenceAt: ride.scheduledAt },
        })
      ).status(),
    ).toBe(404);
    const invited = await invitee.context.newPage();
    await invited.goto(url);
    const panel = invited.getByRole("region", { name: "Участие", exact: true });
    await expect(panel).toContainText("Вас пригласил организатор");
    await expect(
      invited.locator("header").getByText("По приглашению"),
    ).toBeVisible();
    const share = invited.getByRole("region", { name: "Позвать знакомых" });
    await expect(share).toContainText("ссылка откроется только приглашённым");
    await expect(share.getByRole("button", { name: "Поделиться" })).toHaveCount(
      0,
    );
    await panel.getByRole("button", { name: /^Иду/ }).click();
    await expect(panel).toContainText("Вы едете");
    await invited.screenshot({
      path: info.outputPath("private-invitee.png"),
      fullPage: true,
      animations: "disabled",
    });
    // The organizer revokes the invitation: no page, no answer.
    await edit(ride, { invitations: [] });
    expect((await invited.goto(url)).status()).toBe(404);
    expect(
      (
        await invitee.context.request.get("/api/rides/public/" + ride.shareId)
      ).status(),
    ).toBe(404);
  } finally {
    await invitee.context.close();
    await stranger.context.close();
  }
});

test("share, QR, chunk failure and reduced motion; one date of a series is cancelled", async ({
  page,
  browser,
}, info) => {
  const rider = await person(browser, "Райдер " + nonce);
  try {
    const ride = await plan({ recurrence: "weekly" });
    const url = publicPath("ride", ride);
    await page
      .context()
      .addCookies((await rider.context.storageState()).cookies);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    const share = page.getByRole("region", { name: "Позвать знакомых" });
    await expect(share).toContainText("могут остаться у получателей");
    await share.getByRole("button", { name: "QR-код" }).click();
    const qr = share.getByRole("img", { name: "QR-код ссылки на покатушку" });
    await expect(qr).toBeVisible();
    await expect(share.locator("#ride-qr small")).toHaveText(
      decodeURI(origin + url),
    );
    await share.screenshot({
      path: info.outputPath("share-qr.png"),
      animations: "disabled",
    });
    await share.getByRole("button", { name: "Скрыть QR-код" }).click();
    await expect(qr).toHaveCount(0);
    // Reduced motion: answers still work at once.
    const rsvp = page.getByRole("group", { name: "Участие в покатушке" });
    await rsvp.getByRole("button", { name: /^Может быть/ }).click();
    await expect(
      rsvp.getByRole("button", { name: /^Может быть/ }),
    ).toHaveAttribute("aria-pressed", "true");
    // A failed chunk: the QR says so, the page and answers keep working.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await share.getByRole("button", { name: "QR-код" }).click();
    await expect(share.getByRole("alert")).toContainText(
      "Не удалось показать QR-код",
    );
    await rsvp.getByRole("button", { name: /^Иду/ }).click();
    await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.unroute("**/_next/static/**/*.js");
    // A failed answer rolls back and says why.
    await page.route("**/api/rides/*/rsvp", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Сервис временно недоступен" }),
      }),
    );
    await rsvp.getByRole("button", { name: /^Не иду/ }).click();
    await expect(page.locator(".ride-rsvp [role=alert]")).toContainText(
      "Сервис временно недоступен",
    );
    await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.unroute("**/api/rides/*/rsvp");
    // Refreshes can answer out of order: only the latest applies, so an
    // older one cannot bring back the previous answer.
    let release, requested, delivered;
    const held = new Promise((resolve) => (release = resolve));
    const staleRequested = new Promise((resolve) => (requested = resolve));
    const staleDelivered = new Promise((resolve) => (delivered = resolve));
    let stale = true;
    await page.route("**/api/rides/public/**", async (route) => {
      if (!stale || route.request().method() !== "GET") return route.fallback();
      stale = false;
      const response = await route.fetch();
      requested();
      await held;
      await route.fulfill({ response });
      delivered();
    });
    await rsvp.getByRole("button", { name: /^Может быть/ }).click();
    await staleRequested;
    const fresh = page.waitForResponse(
      (r) =>
        r.url().includes("/api/rides/public/") &&
        r.request().method() === "GET",
    );
    await rsvp.getByRole("button", { name: /^Иду/ }).click();
    await fresh;
    release();
    await staleDelivered;
    await page.waitForTimeout(300);
    await expect(rsvp.getByRole("button", { name: /^Иду/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.unroute("**/api/rides/public/**");
    // The organizer cancels only this date; the series goes on.
    const own = await organizer.newPage();
    own.on("dialog", (d) => d.accept());
    await own.goto(url);
    const summary = own.getByRole("region", { name: "Ответы участников" });
    const day = new Date(ride.scheduledAt).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
    });
    await summary
      .getByRole("button", { name: "Отменить выезд " + day })
      .click();
    await expect(own.getByText("Отменены выезды: " + day)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Отменены выезды: " + day)).toBeVisible();
    const next = new Date(+new Date(ride.scheduledAt) + 7 * 24 * hour);
    await expect(
      page.getByRole("region", { name: "Договорённости" }),
    ).toContainText(
      next.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Moscow",
      }),
    );
    await expect(
      rsvp.getByRole("button", { name: /^Иду/ }),
      "a new date starts unanswered",
    ).toHaveAttribute("aria-pressed", "false");
    await own.close();
  } finally {
    await rider.context.close();
  }
});

test("«Спросить организатора» opens the existing messages with the ride as a draft, or says messages are off", async ({
  page,
  browser,
}, info) => {
  const rider = await person(browser, "Вопрос " + nonce);
  try {
    const ride = await plan();
    await page
      .context()
      .addCookies((await rider.context.storageState()).cookies);
    // The vendor double patches WebSocket in documents loaded after it is
    // installed; the link below is a client-side navigation.
    const fixture = chatBrowserFixture([rider.user, organizerUser]);
    await fixture.install(page, rider.user);
    await page.goto(publicPath("ride", ride));
    const panel = page.getByRole("region", { name: "Участие", exact: true });
    const ask = panel.getByRole("link", { name: "Спросить организатора" });
    if (!(await ask.count())) {
      // No Stream in this environment: the page says so and still works.
      await expect(panel).toContainText("Сообщения сейчас недоступны");
      await panel.getByRole("button", { name: /^Иду/ }).click();
      await expect(panel).toContainText("Вы едете");
      return;
    }
    await ask.click();
    await expect(page).toHaveURL(/\/messages\?channel=/);
    const input = page.locator(".chat-conversation textarea").first();
    await expect(input).toHaveValue(
      new RegExp("Вопрос о покатушке «" + ride.title + "»"),
    );
    await expect(input).not.toHaveValue(/Секретная встреча/);
    await page.screenshot({
      path: info.outputPath("ask-organizer.png"),
      fullPage: true,
      animations: "disabled",
    });
    // Nothing was sent on the rider's behalf.
    expect(
      [...fixture.channels.values()].every((c) => c.messages.length === 0),
    ).toBe(true);
    expect(fixture.unexpected).toEqual([]);
  } finally {
    await rider.context.close();
  }
});
