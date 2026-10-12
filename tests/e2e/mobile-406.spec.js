import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test.use({ video: "on" });

async function member(request) {
  const r = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Mobile review",
      email: randomUUID() + "@example.test",
      password: "mobile-review-secret-406",
    },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).user;
}

// A deliberately smaller, panned VisualViewport with an unchanged layout
// viewport. This exercises the keyboard strategy, not an actual OS keyboard.
async function visibleArea(page) {
  await page.addInitScript(({ width, height }) => {
    const area = Object.assign(new EventTarget(), {
      height,
      width,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: area,
    });
  }, page.viewportSize());
}
async function resizeArea(page, height, top = 0) {
  await page.evaluate(
    ({ height, top }) => {
      Object.assign(window.visualViewport, {
        height,
        width: window.innerWidth,
        offsetTop: top,
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
      window.visualViewport.dispatchEvent(new Event("scroll"));
    },
    { height, top },
  );
}

for (const width of [320, 360, 393, 430]) {
  test(`global search at ${width}: top field, visible-area changes, scroll, errors and restored focus/query`, async ({
    page,
    isMobile,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: width % 2 ? "dark" : "light",
    });
    await visibleArea(page);
    await page.route("**/api/discovery/search?**", (route) =>
      route.fulfill({
        json: {
          total: 30,
          groups: [
            {
              type: "bike",
              label: "Велосипеды",
              items: Array.from({ length: 30 }, (_, i) => ({
                type: "bike",
                id: String(i),
                title: `Велосипед с длинным названием ${i}`,
                subtitle: "Длинная подпись велосипеда для проверки переноса",
                href: "/bikes",
                metadata: {},
              })),
            },
          ],
        },
      }),
    );
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: "Поиск ColaBike",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Поиск ColaBike" });
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    await expect
      .poll(async () => (await input.boundingBox()).y)
      .toBeLessThan(160);
    await input.fill("длинный запрос");
    await expect(dialog.getByRole("option")).toHaveCount(30);
    await resizeArea(page, 320, 35);
    await expect
      .poll(async () => {
        const d = await dialog.boundingBox();
        return { top: Math.round(d.y), height: Math.round(d.height) };
      })
      .toEqual({ top: 35, height: 320 });
    for (const locator of [
      input,
      dialog.getByRole("button", { name: "Закрыть панель" }),
    ]) {
      const b = await locator.boundingBox();
      expect(b.y).toBeGreaterThanOrEqual(35);
      expect(b.y + b.height).toBeLessThanOrEqual(355);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    const last = dialog.getByRole("option").last();
    await last.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport();
    const b = await last.boundingBox();
    expect(b.y + b.height).toBeLessThanOrEqual(355);
    await page.screenshot({
      path: info.outputPath(`search-${width}-visible-area.png`),
    });
    await resizeArea(page, 800);
    // Orientation changes preserve query, then return to the portrait panel.
    await page.setViewportSize({ width: 800, height: width });
    await resizeArea(page, width);
    await expect(input).toHaveValue("длинный запрос");
    if (isMobile) {
      await resizeArea(page, 180, 10);
      await expect
        .poll(async () => Math.round((await dialog.boundingBox()).height))
        .toBe(180);
      const field = await input.boundingBox();
      expect(field.y).toBeGreaterThanOrEqual(10);
      expect(field.y + field.height).toBeLessThanOrEqual(190);
      const last = dialog.getByRole("option").last();
      await last.scrollIntoViewIfNeeded();
      expect(
        (await last.boundingBox()).y + (await last.boundingBox()).height,
      ).toBeLessThanOrEqual(190);
    }
    await page.setViewportSize({ width, height: 800 });
    await resizeArea(page, 800);
    await expect
      .poll(() =>
        dialog.evaluate((e) => e.style.getPropertyValue("--visible-height")),
      )
      .toBe("800px");
    // API scale change exercises the branch; this is not a real pinch gesture.
    await page.evaluate(() => {
      window.visualViewport.scale = 2;
      window.visualViewport.height = 100;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(() =>
        dialog.evaluate((e) => e.style.getPropertyValue("--visible-height")),
      )
      .toBe("800px");
    await page.evaluate(() => {
      window.visualViewport.scale = 1;
    });
    await resizeArea(page, 800);

    await expect(input).toHaveValue("длинный запрос");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(input).toHaveValue("длинный запрос");
    await page.unroute("**/api/discovery/search?**");
    await page.route("**/api/discovery/search?**", (route) =>
      route.fulfill({ status: 503, json: {} }),
    );
    await input.fill("ошибка");
    await resizeArea(page, 320);
    await expect(dialog.getByRole("status")).toContainText(
      "Подсказки недоступны",
    );
    await expect(dialog.getByRole("status")).toBeInViewport();
    await page.unroute("**/api/discovery/search?**");
    await page.route("**/api/discovery/search?**", (route) =>
      route.fulfill({ json: { total: 0, groups: [] } }),
    );
    await input.fill("пусто");
    await expect(dialog.getByRole("status")).toContainText("Ничего не найдено");
    await expect(dialog.getByRole("status")).toBeInViewport();
    expect(await pageOverflow(page)).toBeNull();
    await dialog.getByRole("button", { name: "Закрыть панель" }).click();
    await expect(trigger).toBeFocused();
  });
}

test("showcase has one combined filter, chips/reset, all facets and URL history for guest and member", async ({
  page,
}, info) => {
  for (const signedIn of [false, true]) {
    if (signedIn) await member(page.request);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: signedIn ? "dark" : "light",
    });
    await page.goto("/bikes?sort=popular&page=2");
    const toolbar = page.getByLabel("Действия витрины");
    const filter = toolbar.getByRole("button", {
      name: "Фильтры",
      exact: true,
    });
    await expect(filter).toBeVisible();
    await expect(
      page.locator("main summary").filter({ hasText: "Классификация" }),
    ).toHaveCount(0);
    const controls = await toolbar
      .locator(":scope > button, :scope > a, :scope > div > button")
      .evaluateAll((items) => items.map((e) => e.getBoundingClientRect().top));
    expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(4);
    await filter.click();
    const dialog = page.getByRole("dialog", { name: "Фильтры", exact: true });
    await dialog
      .getByRole("checkbox", { name: "Шоссе / гравел", exact: true })
      .check();
    for (const label of [
      "Подтип",
      "Амортизация",
      "Конструкция",
      "Назначение",
      "Электропривод",
      "Fatbike",
    ])
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    await dialog.getByLabel("Электропривод", { exact: true }).selectOption("1");
    await dialog
      .getByRole("button", { name: "Применить", exact: true })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("electric"))
      .toBe("1");
    expect(new URL(page.url()).searchParams.get("page") || "1").toBe("1");
    const selectedUrl = page.url();
    await expect(filter.locator(".badge")).toHaveText("2");
    await expect(page.getByLabel("Активные фильтры")).toContainText(
      "Шоссе / гравел",
    );
    await page.screenshot({
      path: info.outputPath(`showcase-${signedIn ? "member" : "guest"}.png`),
    });
    await page.reload();
    await expect(filter.locator(".badge")).toHaveText("2");
    await page.goto("/");
    await page.goBack();
    await expect(page).toHaveURL(selectedUrl);
    await expect(filter.locator(".badge")).toHaveText("2");
    await page
      .getByRole("button", { name: "Сбросить всё", exact: true })
      .click();
    await expect(filter.locator(".badge")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("electric")).toBe(false);
    expect(await pageOverflow(page)).toBeNull();
  }
});

test("component photos fit their actual cover at every aspect ratio, on desktop and phones", async ({
  page,
}, info) => {
  await member(page.request);
  const nonce = randomUUID().slice(0, 8);
  const parts = [
    ["Передний тормоз", "Shimano MT-410", 900, 900],
    ["Амортизатор", "FOX FLOAT X Factory", 480, 1440],
    ["Система / шатуны", "SRAM Force", 1440, 480],
    ["Вилка", "RockShox SID", 480, 1440],
    ["Руль", "Race Face Atlas", 900, 600],
    ["Седло", "Brooks C17", 0, 0],
  ];
  const response = await page.request.post("/api/bikes/wizard", {
    headers: { origin },
    data: {
      requestId: randomUUID(),
      bike: {
        name: "Photo shapes " + nonce,
        brand: "Cube",
        model: "Travel",
        year: 2024,
        category: "road",
        is_public: true,
        description: "",
        color: "",
        size: "",
        weight: null,
      },
      components: parts.map(([category, name]) => ({
        section: "build",
        category,
        name: name + " " + nonce,
        notes: "",
        price: null,
      })),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const catalog = await (
    await page.request.get("/api/components?q=" + nonce)
  ).json();
  expect(catalog.items).toHaveLength(parts.length);
  for (const [, name, width, height] of parts) {
    if (!width) continue;
    const model = catalog.items.find(
      (item) => item.name === name + " " + nonce,
    );
    const bytes = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="#d9a949" stroke="#243b4e" stroke-width="16"/><path d="M8 8L${width - 8} ${height - 8}M8 ${height - 8}L${width - 8} 8" stroke="#243b4e" stroke-width="16"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const upload = await page.request.post(
      `/api/components/${model.id}/photos`,
      { headers: { origin, "content-type": "image/png" }, data: bytes },
    );
    expect(upload.status(), await upload.text()).toBe(201);
  }
  await page.goto("/components?q=" + nonce);
  const results = page.getByRole("region", { name: "Модели компонентов" });
  for (const width of [1440, 320, 360, 393, 430]) {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: width === 393 ? "dark" : "light",
    });
    for (const img of await results.locator("img").all()) {
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0))
        .toBe(true);
      const geometry = await img.evaluate((e) => {
        const image = e.getBoundingClientRect(),
          cover = e.parentElement.getBoundingClientRect();
        return {
          x: image.x - cover.x,
          y: image.y - cover.y,
          right: image.right - cover.right,
          bottom: image.bottom - cover.bottom,
          height: image.height,
          fit: getComputedStyle(e).objectFit,
        };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(-1);
      expect(geometry.y).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(1);
      expect(geometry.bottom).toBeLessThanOrEqual(1);
      expect(geometry.height).toBeGreaterThanOrEqual(100);
      expect(geometry.fit).toBe("contain");
    }
    expect(await pageOverflow(page)).toBeNull();
    await page.screenshot({
      path: info.outputPath(`component-shapes-${width}.png`),
      fullPage: true,
    });
  }
});

test("chat composer and latest message fit a contracted visible area", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const { chatBrowserFixture } = await import("../fixtures/chat-browser.js");
  const context = await browser.newContext(info.project.use);
  try {
    const alice = await member(page.request),
      bob = await member(context.request);
    await page.setViewportSize({ width: 393, height: 800 });
    await visibleArea(page);
    const fixture = chatBrowserFixture([alice, bob]);
    await fixture.install(page, alice);
    await page.goto("/messages?to=" + bob.id);
    const input = page.locator(".chat-conversation textarea").first();
    await expect(input).toBeVisible();
    await input.fill("Несколько строк\nв мобильном чате");
    await resizeArea(page, 320, 40);
    await expect
      .poll(async () => {
        const b = await input.boundingBox();
        return b.y >= 40 && b.y + b.height <= 360;
      })
      .toBe(true);
    await page.screenshot({ path: info.outputPath("chat-visible-area.png") });
    await input.press("Enter");
    await expect(
      page.locator(".chat-text").filter({ hasText: "в мобильном чате" }),
    ).toBeVisible();
    // Back remains clickable above the site header while the keyboard area is contracted.
    await page.getByRole("button", { name: "К списку диалогов" }).click();
    await resizeArea(page, 800);
    await expect(page.locator(".chat-channels")).toBeVisible();
    await page
      .locator(".chat-channels")
      .getByRole("button", { name: /Mobile review/ })
      .first()
      .click();
    await resizeArea(page, 320, 40);
    if (isMobile) {
      await page.setViewportSize({ width: 844, height: 390 });
      await resizeArea(page, 180, 10);
      await expect
        .poll(async () => {
          const b = await input.boundingBox();
          return b.y >= 10 && b.y + b.height <= 190;
        })
        .toBe(true);
      await page.setViewportSize({ width: 393, height: 800 });
    }
    await resizeArea(page, 800);
    await page.getByRole("button", { name: "К списку диалогов" }).click();
    await expect(page.locator(".chat-channels")).toBeVisible();
    expect(await pageOverflow(page)).toBeNull();
  } finally {
    await context.close();
  }
});

test("wizard, intent, plan and bug report keep their input and last action reachable in a small visible area", async ({
  page,
}, info) => {
  await member(page.request);
  const bike = await page.request.post("/api/bikes", {
    headers: { origin },
    data: {
      name: "Mobile planning bike",
      brand: "Cube",
      model: "Travel",
      year: 2024,
      category: "road",
      is_public: true,
      description: "",
      color: "",
      size: "",
      weight: null,
    },
  });
  expect(bike.status()).toBe(201);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visibleArea(page);
  await page.goto("/account?tab=bikes&action=add");
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Продолжить вручную" }).click();
  await resizeArea(page, 350, 24);
  const brand = wizard.getByLabel("Марка", { exact: true });
  await brand.fill("Очень длинная марка велосипеда");
  await expect(brand).toBeInViewport();
  const next = wizard.getByRole("button", { name: "Далее", exact: true });
  const actionBox = await next.boundingBox();
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(374);
  await page.screenshot({ path: info.outputPath("wizard-visible-area.png") });
  const size = wizard.getByRole("combobox", { name: "Ростовка", exact: true });
  await size.fill("");
  await size.click();
  const popup = wizard.locator(".combo-popup");
  await expect(popup).toBeVisible();
  const popupBox = await popup.boundingBox();
  expect(popupBox.y).toBeGreaterThanOrEqual(24);
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(374);
  const option = popup.getByRole("option", { name: "M", exact: true });
  await option.scrollIntoViewIfNeeded();
  expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await option.click();
  await expect(size).toHaveValue("M");
  await page.goto("/ride-intents");
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  const intent = page.getByRole("dialog", {
    name: "Новое намерение",
    exact: true,
  });
  await resizeArea(page, 350, 24);
  const field = intent.getByLabel("Окно 1: с", { exact: true });
  await field.fill("2026-12-10T10:00");
  await field.scrollIntoViewIfNeeded();
  const fieldBox = await field.boundingBox(),
    saveBox = await intent
      .getByRole("button", { name: "Сохранить намерение", exact: true })
      .boundingBox();
  expect(fieldBox.y).toBeGreaterThanOrEqual(24);
  expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(saveBox.y);
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(374);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Организовать покатушку", exact: true })
    .first()
    .click();
  const plan = page.getByRole("dialog", {
    name: "Организовать покатушку",
    exact: true,
  });
  await resizeArea(page, 350, 24);
  await plan.getByLabel("Дата", { exact: true }).fill("2026-12-10");
  await plan.getByLabel("Дата", { exact: true }).scrollIntoViewIfNeeded();
  await expect(plan.getByLabel("Дата", { exact: true })).toBeInViewport();
  const submit = plan.getByRole("button", {
    name: "Создать покатушку",
    exact: true,
  });
  expect(
    (await submit.boundingBox()).y + (await submit.boundingBox()).height,
  ).toBeLessThanOrEqual(374);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Сообщить об ошибке", exact: true })
    .click();
  const bug = page.getByRole("dialog", {
    name: "Сообщить об ошибке",
    exact: true,
  });
  await resizeArea(page, 350, 24);
  await bug
    .getByRole("textbox", { name: "Что произошло?", exact: true })
    .fill("Текст сохраняется при отказе отправки");
  await page.route("**/api/bug-reports", (route) =>
    route.fulfill({ status: 503, json: { error: "Временно недоступно" } }),
  );
  await bug
    .getByRole("button", { name: "Отправить сообщение", exact: true })
    .click();
  await expect(bug.getByRole("alert")).toBeVisible();
  await expect(
    bug.getByRole("textbox", { name: "Что произошло?", exact: true }),
  ).toHaveValue("Текст сохраняется при отказе отправки");
  await bug
    .getByLabel("Email для ответа", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    bug.getByLabel("Email для ответа", { exact: true }),
  ).toBeInViewport();
  const send = bug.getByRole("button", {
    name: "Отправить сообщение",
    exact: true,
  });
  await send.scrollIntoViewIfNeeded();
  expect(
    (await send.boundingBox()).y + (await send.boundingBox()).height,
  ).toBeLessThanOrEqual(374);
  await page.screenshot({ path: info.outputPath("bug-visible-area.png") });
});

test("global search uses the full small viewport when VisualViewport is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await page.addInitScript(() =>
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Поиск ColaBike",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Поиск ColaBike" });
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await expect
    .poll(async () => Math.round((await dialog.boundingBox()).height))
    .toBe(420);
  expect((await dialog.getByRole("combobox").boundingBox()).y).toBeLessThan(
    160,
  );
  await dialog.getByRole("button", { name: "Закрыть панель" }).click();
  await expect(trigger).toBeFocused();
});
