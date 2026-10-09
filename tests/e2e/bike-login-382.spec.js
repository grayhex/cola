import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const password = "bike-login-secret-123";
const words = "Велосипед недоступен";

// #382: signing in on the page of an available bike must not flash «Велосипед
// недоступен» in any state between the click and the page of the signed-in
// reader. The three states are told apart: the session and the bike are being
// loaded, the bike is loaded, the bike is confirmed unavailable.
async function person(browser, label) {
  const context = await browser.newContext({ baseURL: origin });
  const email = randomUUID() + "@example.test";
  const response = await registerVerified(context.request, {
    headers: { origin },
    data: { ...testConsents, name: label, email, password },
  });
  expect(response.status()).toBe(201);
  return { context, email, label };
}
async function bike(owner, patch) {
  const created = await owner.context.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Вход · велосипед",
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: true,
      ...patch,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const { bike: stored } = await (
    await owner.context.request.get("/api/bikes/" + id)
  ).json();
  return { id, path: "/b/" + stored.share_id };
}
// Everything the page shows from now on is watched: the words must never be in
// the document, not for one frame.
async function watch(page) {
  await page.addInitScript((words) => {
    window.__flash = [];
    const look = () => {
      if (document.body && document.body.innerText.includes(words))
        window.__flash.push(Math.round(performance.now()));
    };
    new MutationObserver(look).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    setInterval(look, 10);
  }, words);
}
const flashes = (page) => page.evaluate(() => window.__flash);
// The network is slow, so the states between the click and the end are long.
async function slow(page, ms = 1500) {
  for (const pattern of ["**/api/shared/**", "**/api/me", "**/api/auth/login"])
    await page.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    });
}
async function signIn(
  page,
  who,
  { submit = true, password: typed, isMobile = false } = {},
) {
  // From the header, as a guest does on a bike page; on a phone it is in the
  // panel of the menu.
  if (isMobile)
    await page.getByRole("button", { name: "Открыть меню" }).click();
  await (
    isMobile
      ? page.getByRole("dialog", { name: "Меню ColaBike" })
      : page.locator("header")
  )
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Электронная почта").fill(who.email);
  await dialog.getByLabel("Пароль", { exact: true }).fill(typed ?? password);
  if (submit)
    await dialog.locator("button[type=submit], .button.block").first().click();
  return dialog;
}
// Who the page believes is reading: the session, not a look of the header.
const signedInAs = async (page) =>
  (await (await page.request.get("/api/me")).json()).user?.email ?? null;

test("signing in on the page of an available bike: no «Велосипед недоступен» at any moment, the address stays", async ({
  browser,
  isMobile,
}, info) => {
  const owner = await person(browser, "Владелец входа");
  const reader = await person(browser, "Читатель входа");
  const { path } = await bike(owner);
  const guest = await browser.newContext({ baseURL: origin });
  try {
    for (const delay of [0, 1500]) {
      const page = await guest.newPage();
      await watch(page);
      if (delay) await slow(page, delay);
      await page.goto(path + "?tab=specifications#top");
      const url = page.url();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      await expect(
        page.getByRole("group", { name: "Управление велосипедом" }),
      ).toHaveCount(0);
      await signIn(page, reader, { isMobile });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect.poll(() => signedInAs(page)).toBe(reader.email);
      // The page of the same bike, for the signed-in reader, in the same place.
      await expect(heading).toBeVisible();
      expect(page.url()).toBe(url);
      await expect(page.getByText(words)).toHaveCount(0);
      // A reader who is not the owner gets no owner's controls.
      await expect(
        page.getByRole("group", { name: "Управление велосипедом" }),
      ).toHaveCount(0);
      expect(await flashes(page)).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`bike-login-${delay}.png`),
        animations: "disabled",
      });
      await page.close();
      // A new guest for the next round: the session is dropped.
      await guest.clearCookies();
    }
    // The owner on their own public bike: the controls arrive with the answer,
    // the words never come.
    const page = await guest.newPage();
    await watch(page);
    await slow(page, 1000);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await signIn(page, owner, { isMobile });
    await expect(
      page.getByRole("group", { name: "Управление велосипедом" }),
    ).toBeVisible();
    expect(await flashes(page)).toEqual([]);
  } finally {
    await guest.close();
    await owner.context.close();
    await reader.context.close();
  }
});

test("cancelling and a wrong password leave the public page as it was", async ({
  browser,
  isMobile,
}) => {
  const owner = await person(browser, "Владелец отказа");
  const { path } = await bike(owner);
  const guest = await browser.newContext({ baseURL: origin });
  try {
    const page = await guest.newPage();
    await watch(page);
    await slow(page, 400);
    await page.goto(path);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const title = await heading.textContent();
    // Cancelled.
    await signIn(page, owner, { submit: false, isMobile });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(heading).toHaveText(title);
    // A wrong password: the window says so, the page behind it stays.
    const dialog = await signIn(page, owner, {
      password: "not the password 1",
      isMobile,
    });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(heading).toHaveText(title);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(heading).toHaveText(title);
    expect(await flashes(page)).toEqual([]);
  } finally {
    await guest.close();
    await owner.context.close();
  }
});

test("a bike that stopped being available says so only after the server's answer, never while the session or the bike is loading", async ({
  browser,
  isMobile,
}) => {
  const owner = await person(browser, "Владелец закрытого");
  const reader = await person(browser, "Читатель закрытого");
  const { id, path } = await bike(owner, { name: "Станет закрытым" });
  const guest = await browser.newContext({ baseURL: origin });
  try {
    // A bike that is not there or is closed from the start is the page of the
    // server, with its own words, and no sign-in changes that.
    const nobody = await guest.newPage();
    await nobody.goto("/b/" + randomUUID().replaceAll("-", ""));
    await expect(
      nobody.getByRole("heading", { name: "Здесь пока ничего нет" }),
    ).toBeVisible();
    await nobody.close();
    const page = await guest.newPage();
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The owner closes the bike while the guest has the page open.
    expect(
      (
        await owner.context.request.patch("/api/bikes/" + id, {
          headers: { origin },
          data: { is_public: false },
        })
      ).status(),
    ).toBeLessThan(300);
    // The answer of the bike for the signed-in reader is held back: the page
    // is loading, not unavailable, until the server has answered.
    let answer;
    const held = new Promise((resolve) => (answer = resolve));
    await page.route("**/api/shared/**", async (route) => {
      await held;
      await route.continue();
    });
    await signIn(page, reader, { isMobile });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForTimeout(600);
    // The page keeps the bike it has (a public one it was shown a moment ago)
    // and does not say «unavailable» as a heading: the bike's own answer has
    // not come. (Other panels of the page ask for their own data and may say
    // so for themselves.)
    await expect(page.getByRole("heading", { name: words })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The confirmed refusal is shown after the answer.
    answer();
    await expect(page.getByRole("heading", { name: words })).toBeVisible();
  } finally {
    await guest.close();
    await owner.context.close();
    await reader.context.close();
  }
});
