import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #378: a guest's «Хочу кататься» and «Организовать покатушку» say «нужна
// регистрация» under the buttons (a site text of the administrator's), open the
// form of registering at once, keep «Уже есть аккаунт? Войти», and bring the
// rider back to the chosen scenario — opened, never created.
const password = "guest-378-secret-123";
async function db() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
// The settings the test changes are put back whatever happens.
async function withSettings(client, patch, body) {
  const original = (
    await client.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  try {
    await client.query(
      "UPDATE site_settings SET value=value || $1::jsonb WHERE id=1",
      [JSON.stringify(patch(original))],
    );
    await body();
  } finally {
    await client.query("UPDATE site_settings SET value=$1 WHERE id=1", [
      original,
    ]);
  }
}
async function signUp(page, name = "Гость") {
  const email = randomUUID() + "@example.test";
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Подтвердите пароль").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("checkbox").nth(1).check();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: /Создать аккаунт/ }).click(),
  ]);
  return email;
}
const together = (page) => page.locator(".together-actions").first();
const intents = async (page) =>
  (await (await page.request.get("/api/ride-intents")).json()).items;

test("a guest sees «нужна регистрация» under the buttons, in the words of the administrator; a member does not", async ({
  page,
  browser,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const box = together(page);
  await expect(box.getByRole("link", { name: "Хочу кататься" })).toBeVisible();
  // The footnote is in the block, below the buttons (#382), not inside them.
  const note = page.locator("[data-registration-note]");
  await expect(note).toHaveText("нужна регистрация");
  // Under the buttons, not beside them.
  // Both are measured again until the layout has settled (fonts and images
  // may move the block by a pixel or two while the page is still arriving).
  await expect
    .poll(async () => {
      const buttons = await box.locator(".together-buttons").boundingBox();
      const line = await note.boundingBox();
      return line.y - (buttons.y + buttons.height);
    })
    .toBeGreaterThanOrEqual(-1);
  // #382: the title carries a small «*» (not part of its name), the footnote is
  // one small line at the bottom left of the block, and it explains the links.
  await expect(
    page.getByRole("heading", { name: "Покататься вместе" }),
  ).toHaveText(/^Покататься вместе\*$/);
  await expect(
    page.getByRole("heading", { name: "Покататься вместе", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#together-heading sup")).toHaveCount(1);
  await expect(page.locator("[data-registration-note]")).toHaveCount(1);
  const copy = await page.locator("[class*='togetherCopy']").boundingBox();
  const mark = await note.locator("xpath=..").boundingBox();
  expect(mark.x - copy.x).toBeLessThanOrEqual(48);
  expect(copy.y + copy.height - (mark.y + mark.height)).toBeLessThanOrEqual(40);
  expect(
    await note.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeLessThanOrEqual(12);
  for (const name of ["Хочу кататься", "Организовать покатушку"])
    await expect(box.getByRole("link", { name })).toHaveAccessibleDescription(
      "нужна регистрация",
    );
  expect(
    (await new AxeBuilder({ page }).include(".together-actions").analyze())
      .violations,
  ).toEqual([]);
  expect(await pageOverflow(page)).toBeNull();
  await page.screenshot({
    path: info.outputPath("guest-home.png"),
    animations: "disabled",
  });

  // The rides section says it under its own buttons.
  await page.goto("/rides");
  const actions = page.locator(".page-actions-stack");
  await expect(actions.locator("[data-registration-note]")).toHaveText(
    "нужна регистрация",
  );
  const stack = await actions.locator(".page-actions").boundingBox();
  const second = await actions
    .locator("[data-registration-note]")
    .boundingBox();
  expect(second.y).toBeGreaterThanOrEqual(stack.y + stack.height - 1);

  // The words are the administrator's: the site texts change them, an emptied
  // one shows nothing, and no component keeps a copy of its own.
  const client = await db();
  try {
    await withSettings(
      client,
      (value) => ({
        copy: { ...value.copy, "нужна регистрация": "Нужен аккаунт ColaBike" },
      }),
      async () => {
        await page.goto("/");
        await expect(page.locator("[data-registration-note]")).toHaveText(
          "Нужен аккаунт ColaBike",
        );
        await page.goto("/rides");
        await expect(
          page.locator(".page-actions-stack [data-registration-note]"),
        ).toHaveText("Нужен аккаунт ColaBike");
      },
    );
    await withSettings(
      client,
      (value) => ({ copy: { ...value.copy, "нужна регистрация": " " } }),
      async () => {
        await page.goto("/");
        await expect(together(page).getByRole("link").first()).toBeVisible();
        await expect(page.locator("[data-registration-note]")).toHaveCount(0);
        // No sign without words to explain it.
        await expect(page.locator("#together-heading sup")).toHaveCount(0);
      },
    );
  } finally {
    await client.end();
  }

  // A member is not told to register: the same buttons, no line.
  const member = await browser.newContext({ ...info.project.use });
  try {
    const mine = await member.newPage();
    expect(
      (
        await registerVerified(mine.request, {
          headers: { origin },
          data: {
            ...testConsents,
            name: "Уже свой",
            email: randomUUID() + "@example.test",
            password,
          },
        })
      ).status(),
    ).toBe(201);
    await mine.goto("/");
    await expect(
      together(mine).getByRole("button", { name: "Хочу кататься" }),
    ).toBeVisible();
    await expect(mine.locator("[data-registration-note]")).toHaveCount(0);
    await expect(mine.locator("#together-heading sup")).toHaveCount(0);
    await expect(
      mine.getByRole("heading", { name: "Покататься вместе" }),
    ).toHaveText("Покататься вместе");
  } finally {
    await member.close();
  }
});

test("«Хочу кататься» opens the form of registering at once; after it the same page opens the new intent window and nothing is created", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await together(page).getByRole("link", { name: "Хочу кататься" }).click();
  // Registering, not the sign-in page; the way to sign in is at hand.
  await expect(page).toHaveURL(/\/ride-intents\?new=1&auth=register$/);
  await expect(
    page.getByRole("heading", { name: "Присоединиться к ColaBike" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Уже есть аккаунт? Войти" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Создать аккаунт/ }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations,
  ).toEqual([]);
  await signUp(page);
  // The scenario they chose: the window to fill, with the marks gone.
  const dialog = page.getByRole("dialog", { name: "Новое намерение" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/ride-intents$/);
  expect(await intents(page)).toHaveLength(0);
});

test("«Организовать покатушку» from the rides section opens registering, and the planner after it; nothing is created", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rides");
  await page
    .getByRole("link", { name: "Запланировать покатушку", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/account\?tab=rides&action=plan&auth=register$/,
  );
  await expect(
    page.getByRole("heading", { name: "Присоединиться к ColaBike" }),
  ).toBeVisible();
  await signUp(page);
  await expect(
    page.getByRole("dialog", { name: "Организовать покатушку" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/auth=register/);
  const rides = await (await page.request.get("/api/rides?own=1")).json();
  expect(rides.rides).toHaveLength(0);
});

test("«Уже есть аккаунт? Войти» keeps the scenario: after signing in the same window opens", async ({
  page,
  browser,
}, info) => {
  const email = randomUUID() + "@example.test";
  const other = await browser.newContext({ ...info.project.use });
  try {
    const made = await other.newPage();
    expect(
      (
        await registerVerified(made.request, {
          headers: { origin },
          data: { ...testConsents, name: "Старый друг", email, password },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await other.close();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await together(page).getByRole("link", { name: "Хочу кататься" }).click();
  await page.getByRole("button", { name: "Уже есть аккаунт? Войти" }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Войти", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("dialog", { name: "Новое намерение" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/ride-intents$/);
  expect(await intents(page)).toHaveLength(0);
});

test("a guest already on the sign-in form is brought to registering by the menu «Запланировать», on the same page; a switch by hand stays", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  // The page is not loaded again: its own script is the proof.
  await page.evaluate(() => {
    window.sameDocument = true;
  });
  if (isMobile)
    await page.getByRole("button", { name: "Открыть меню" }).click();
  else
    await page
      .getByRole("button", { name: "Подразделы: Покатушки", exact: true })
      .click();
  await page.getByRole("link", { name: "Запланировать", exact: true }).click();
  await expect(page).toHaveURL(/auth=register/);
  await expect(
    page.getByRole("heading", { name: "Присоединиться к ColaBike" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.sameDocument)).toBe(true);
  // The guest's own choice is theirs: back to signing in, and it stays.
  await page.getByRole("button", { name: "Уже есть аккаунт? Войти" }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
});

test("closed registration says so and keeps the way to sign in; cancelling goes back to the page the guest was on", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const client = await db();
  try {
    await withSettings(
      client,
      () => ({ registrationOpen: false }),
      async () => {
        await page.goto("/rides");
        await page
          .getByRole("link", { name: "Хочу кататься", exact: true })
          .click();
        await expect(page).toHaveURL(/auth=register/);
        await expect(
          page.getByText("Регистрация временно закрыта", { exact: false }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Войти в аккаунт" }).click();
        await expect(
          page.getByRole("heading", { name: "С возвращением" }),
        ).toBeVisible();
      },
    );
  } finally {
    await client.end();
  }

  // Cancelling: the same page, where the guest was.
  await page.goto("/rides");
  await page.getByRole("link", { name: "Хочу кататься", exact: true }).click();
  await expect(page).toHaveURL(/auth=register/);
  await page.getByRole("link", { name: "Назад" }).click();
  await expect(page).toHaveURL(/\/rides$/);
});
