import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import {
  registerVerified,
  capturedVerificationToken,
} from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { chatBrowserFixture } from "../fixtures/chat-browser.js";
import { publicPath } from "../../lib/public-urls.ts";
import { contrastRatio } from "../../lib/appearance.ts";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(page, name = "First audience") {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name,
      email: randomUUID() + "@example.test",
      password: "first-audience-password-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await (await page.request.get("/api/me")).json()).user;
}
async function api(request, method, path, data) {
  const response = await request.fetch("/api/" + path, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function theme(page, value) {
  await page.evaluate((value) => {
    localStorage.setItem("cola:theme", value);
    window.dispatchEvent(new Event("storage"));
  }, value);
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}
async function fits(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("guest bug report: keyboard focus, both themes and widths, failure preserves fields, retry has one accepted result", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let submitted;
  await page.route("**/api/bug-reports", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      json: { error: "Отправка пока не настроена. Текст сохранён." },
    });
  });
  await page.goto("/login?secret=never-collect#private");
  const opener = page.getByRole("button", {
    name: "Сообщить об ошибке",
    exact: true,
  });
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Сообщить об ошибке",
    exact: true,
  });
  await expect(dialog.getByLabel("Что произошло?")).toBeFocused();
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await dialog.getByLabel("Что произошло?").fill("Не получилось войти");
  await dialog
    .getByLabel("Как повторить / что ожидали?")
    .fill("Нажал кнопку входа");
  await dialog
    .getByRole("button", { name: "Отправить сообщение", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Текст сохранён");
  expect(submitted.contact).toBe("");
  expect(submitted.diagnostics.path).toBe("/login");
  expect(JSON.stringify(submitted)).not.toMatch(
    /never-collect|private|cookies|authorization/i,
  );
  await expect(dialog.getByLabel("Что произошло?")).toHaveValue(
    "Не получилось войти",
  );
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const value of ["light", "dark"]) {
      await theme(page, value);
      await fits(page);
      const a11y = await new AxeBuilder({ page })
        .include("dialog[open]")
        .analyze();
      expect(a11y.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`bug-report-${value}-${width}.png`),
        animations: "disabled",
      });
    }
  }
  await dialog.press("Escape");
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("без отправки");
  await confirmation
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await expect(dialog.getByLabel("Что произошло?")).toHaveValue(
    "Не получилось войти",
  );
  await page.route("**/api/bug-reports", (route) =>
    route.fulfill({ json: { id: "browser-report", accepted: true } }),
  );
  await dialog
    .getByRole("button", { name: "Отправить сообщение", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("принял сообщение");
});

test("article HTML table paste survives publication and editing; complex tables keep surrounding text; accents stay readable", async ({
  page,
}, info) => {
  await register(page);
  await page.goto("/articles/new");
  await page
    .getByLabel("Заголовок статьи")
    .fill("Таблица моделей " + randomUUID().slice(0, 6));
  const editor = page.getByRole("textbox", {
    name: "Текст статьи",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const paste = async (html) =>
    editor.evaluate((el, html) => {
      el.focus();
      const data = new DataTransfer();
      data.setData("text/html", html);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, html);
  await paste(
    '<table><tr><th>Модель</th><th>Ссылка</th></tr><tr><td>A | B</td><td><a href="https://example.test">Сайт</a></td></tr><tr><td></td><td>' +
      "Длинное описание ".repeat(24) +
      "</td></tr></table>",
  );
  await expect(editor.locator("table")).toHaveCount(1);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page).toHaveURL(/\/articles\/[a-f0-9-]+$/);
  const table = page.getByRole("region", {
    name: "Таблица, горизонтальная прокрутка",
  });
  await expect(page.locator(".article-prose th")).toHaveText([
    "Модель",
    "Ссылка",
  ]);
  await expect(page.locator(".article-prose td").first()).toHaveText("A | B");
  await table.focus();
  await expect(table).toBeFocused();
  await table.press("ArrowRight");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  try {
    for (const accent of ["#000000", "#FFFFFF"]) {
      await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [
        { ...original, appearance: { ...original.appearance, accent } },
      ]);
      await page.reload();
      for (const value of ["light", "dark"]) {
        await theme(page, value);
        await page.setViewportSize({ width: 390, height: 844 });
        await fits(page);
        const link = page
          .locator(".article-prose a")
          .filter({ hasText: "Сайт" });
        for (const state of ["normal", "hover", "focus"]) {
          if (state === "hover") await link.hover();
          if (state === "focus") await link.focus();
          const color = await link.evaluate((el) => {
            const rgb = getComputedStyle(el)
              .color.match(/\d+/g)
              .slice(0, 3)
              .map(Number);
            return (
              "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join("")
            );
          });
          expect(
            contrastRatio(color, value === "light" ? "#FFFFFF" : "#111827"),
          ).toBeGreaterThanOrEqual(4.5);
        }
        await page.screenshot({
          path: info.outputPath(
            `article-table-${value}-${accent.slice(1)}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    await db.end();
  }
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await expect(editor.locator("table")).toHaveCount(1);
  await editor.press("ControlOrMeta+End");
  await paste(
    '<p>До таблицы</p><table><tr><td colspan="2">One</td><td>Two</td></tr></table><p>После таблицы</p>',
  );
  await expect(page.locator("[data-rich-editor]")).toContainText(
    "Таблица преобразована",
  );
  await expect(editor).toContainText("One | Two");
  await expect(editor).toContainText("До таблицы");
  await expect(editor).toContainText("После таблицы");
});

test("stale RSVP at unchanged start shows fresh coarse place; retry is explicit; plan cards use plan timezone", async ({
  page,
  browser,
}, info) => {
  await register(page, "RSVP owner");
  const bike = await api(page.request, "POST", "bikes", {
    name: "Timezone gravel",
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
  const input = {
    bikeId: bike.id,
    title: "Полночь " + randomUUID().slice(0, 6),
    isPublic: true,
    privacyEnabled: true,
    privacyRadiusM: 500,
    scheduledAt: "2031-10-10T21:30:00Z",
    recurrenceTimezone: "Europe/Moscow",
    meetingVisibility: "participants",
    meetingPoint: "Скрытый вход 1",
    passport: { area: { label: "Первый парк" } },
  };
  const made = await api(page.request, "POST", "rides/plan", input);
  const { ride } = await api(
    page.request,
    "GET",
    "rides/owner/" + made.shareId,
  );
  const context = await browser.newContext({
    baseURL: origin,
    timezoneId: "America/Los_Angeles",
    viewport: info.project.use.viewport,
  });
  try {
    const reader = await context.newPage();
    await register(reader, "RSVP reader");
    await reader.goto(publicPath("ride", ride));
    await expect(reader.locator("main")).toContainText(
      "11 октября в 00:30 GMT+3",
    );
    await api(page.request, "PATCH", "rides/" + made.id, {
      ...input,
      passport: { area: { label: "Второй парк" } },
      meetingPoint: "Скрытый вход 7",
      description: "Условия после изменения",
    });
    const answer = reader
      .getByRole("group", { name: "Участие в покатушке" })
      .getByRole("button", { name: /^Иду/ });
    await answer.click();
    const fresh = reader.getByRole("region", { name: "Актуальные условия" });
    await expect(fresh).toContainText("Второй парк");
    await expect(fresh).toContainText("Условия после изменения");
    await expect(reader.locator("main")).not.toContainText("Скрытый вход 7");
    await expect(answer).toHaveAttribute("aria-pressed", "false");
    await answer.click();
    await expect(answer).toHaveAttribute("aria-pressed", "true");
    await reader.reload();
    await expect(reader.locator("main")).toContainText("Скрытый вход 7");
    await reader.goto("/rides");
    await expect(reader.locator("main")).toContainText(
      "11 октября в 00:30 GMT+3",
    );
  } finally {
    await context.close();
  }
});

test("legacy session cache cannot show personalized rides during a failed fresh request; home hero uses both themes", async ({
  page,
}, info) => {
  await register(page, "Cache rider A");
  const bike = await api(page.request, "POST", "bikes", {
    name: "Private cache bike",
    brand: "Kona",
    model: "Rove",
    year: 2022,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: false,
  });
  await api(page.request, "POST", "rides/plan", {
    bikeId: bike.id,
    title: "PRIVATE_A_SECRET",
    isPublic: false,
    privacyEnabled: true,
    privacyRadiusM: 500,
    scheduledAt: "2031-10-10T21:30:00Z",
    meetingPoint: "PRIVATE_A_POINT",
    recurrenceTimezone: "Europe/Moscow",
  });
  const personalized = await api(page.request, "GET", "rides?own=1");
  expect(JSON.stringify(personalized)).toContain("PRIVATE_A_SECRET");
  await page.goto("/account?tab=rides");
  await expect(page.locator("main")).toContainText("PRIVATE_A_SECRET");
  await page.evaluate(
    (data) =>
      sessionStorage.setItem(
        "cola:ride-list:catalogue",
        JSON.stringify({ page: 1, data }),
      ),
    personalized,
  );
  await api(page.request, "POST", "auth/logout", {});
  await page.route("**/api/rides?**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Fresh request unavailable" },
    }),
  );
  await page.goto("/rides");
  await expect(page.locator("body")).not.toContainText("PRIVATE_A_SECRET");
  expect(
    await page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith("cola:ride-list:"))
        .map(([, value]) => value)
        .join(),
    ),
  ).not.toContain("PRIVATE_A_POINT");
  await register(page, "Cache rider B");
  await page.goto("/rides");
  await expect(page.locator("main")).not.toContainText("PRIVATE_A_SECRET");
  await expect(page.locator("main")).toContainText("Fresh request unavailable");
  await page.goto("/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const value of ["light", "dark"]) {
      await theme(page, value);
      await fits(page);
      await page.screenshot({
        path: info.outputPath(`home-hero-${value}-${width}.png`),
        animations: "disabled",
      });
    }
  }
});

test("block controls retain state on failure and unblock from account; group mute survives reload and leaving persists", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const bobPage = await context.newPage(),
      alice = await register(page, "Safety Alice"),
      bob = await register(bobPage, "Safety Bob");
    await page.goto("/@" + bob.username);
    const block = page.getByRole("button", {
      name: "Заблокировать",
      exact: true,
    });
    await expect(block).toBeEnabled();
    await page.route("**/api/v1/users/*/block", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { message: "Safety unavailable" } },
      }),
    );
    await block.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Safety unavailable" }),
    ).toBeVisible();
    await expect(block).toBeEnabled();
    await page.unroute("**/api/v1/users/*/block");
    await block.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Разблокировать", exact: true }),
    ).toBeVisible();
    await page.goto("/account?tab=social");
    await expect(
      page.getByRole("heading", { name: "Заблокированные люди" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Разблокировать", exact: true })
      .click();
    await expect(page.locator("main")).toContainText(
      "Вы никого не заблокировали",
    );
    const thirdContext = await browser.newContext({ baseURL: origin });
    const cara = await register(await thirdContext.newPage(), "Safety Cara");
    await thirdContext.close();
    const fixture = chatBrowserFixture([alice, bob, cara]);
    await fixture.install(page, alice);
    await page.goto("/");
    const group = await page.evaluate(
      async ({ ids }) => {
        const r = await fetch("/api/chat/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "group",
            name: "Safety group",
            members: ids,
          }),
        });
        return { status: r.status, ...(await r.json()) };
      },
      { ids: [bob.id, cara.id] },
    );
    expect(group.status, JSON.stringify(group)).toBe(201);
    await page.goto("/messages?channel=" + encodeURIComponent(group.cid));
    await expect(
      page.locator(".chat-conversation textarea").first(),
    ).toBeVisible();
    const openDetails = () =>
      page.getByRole("button", { name: "Участники и информация" }).click();
    await openDetails();
    await page
      .getByRole("button", { name: "Отключить уведомления чата", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Включить уведомления чата",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await openDetails();
    await expect(
      page.getByRole("button", {
        name: "Включить уведомления чата",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Включить уведомления чата", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Отключить уведомления чата",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Выйти из группы", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Продолжить", exact: true })
      .click();
    await expect(page).not.toHaveURL(/channel=/);
    await page.reload();
    await expect(page.locator(".chat-channel")).toHaveCount(0);
    expect(fixture.unexpected).toEqual([]);
  } finally {
    await context.close();
  }
});

test("unverified rider keeps bike fields, photo and component in a private draft; verification refreshes the same-tab viewer", async ({
  page,
  isMobile,
}, info) => {
  const email = randomUUID() + "@example.test";
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name: "Private drafter",
          email,
          password: "private-draft-password-123",
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/bikes");
  await page
    .locator("main")
    .getByRole("link", { name: "Добавить велосипед" })
    .first()
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  const forward = wizard.getByRole("button", {
    name: /^(Далее|Продолжить вручную)$/,
  });
  await forward.click();
  await wizard.getByLabel("Марка", { exact: true }).fill("Kona");
  await wizard.getByLabel("Модель", { exact: true }).fill("Private Rove");
  await wizard.getByLabel("Год", { exact: true }).fill("2022");
  await wizard
    .getByLabel("Категория велосипеда", { exact: true })
    .selectOption("road_gravel");
  await wizard.getByLabel("Файлы фотографий").setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#7fa088" },
    })
      .png()
      .toBuffer(),
  });
  await forward.click();
  await wizard.getByRole("button", { name: "Педали", exact: true }).click();
  await wizard.getByLabel("Компонент", { exact: true }).fill("Shimano PD-M520");
  await expect(wizard).toContainText(
    "Для публичного велосипеда подтвердите почту",
  );
  await wizard.screenshot({
    path: info.outputPath("private-bike-draft.png"),
    animations: "disabled",
  });
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/bikes/wizard" &&
      r.request().method() === "POST",
  );
  await wizard
    .getByRole("button", { name: "Сохранить приватный черновик", exact: true })
    .click();
  const result = await saved;
  expect(result.status(), await result.text()).toBe(201);
  const { id } = await result.json();
  await expect(wizard).not.toBeVisible();
  const bike = await api(page.request, "GET", "bikes/" + id);
  expect(bike.bike.is_public).toBe(false);
  expect(bike.bike.model).toBe("Private Rove");
  expect(bike.bike.components.some((p) => p.name === "Shimano PD-M520")).toBe(
    true,
  );
  expect(bike.bike.photos).toHaveLength(1);
  const token = await capturedVerificationToken(email);
  await page.goto("/verify-email#" + token);
  await expect(
    page.getByRole("status").filter({ hasText: "Адрес подтверждён" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Открыть кабинет", exact: true })
    .click();
  // SPA navigation keeps the layout: this status must come from refreshViewer.
  if (isMobile) await page.getByRole("button", { name: /^Раздел:/ }).click();
  await page
    .getByRole("navigation", { name: "Разделы личного кабинета" })
    .getByRole("link", { name: "Аккаунт", exact: true })
    .click();
  await expect(page.locator("main")).toContainText("· подтверждён");
  await expect(page.locator("main")).not.toContainText("· не подтверждён");
});
