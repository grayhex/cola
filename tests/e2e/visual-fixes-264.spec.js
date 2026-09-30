import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";

// Visual fixes and one «Хочу кататься» flow (#264).
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

async function member(request, label, { admin = false } = {}) {
  const nonce = randomUUID().slice(0, 8);
  const email = `${label}-${nonce}@example.test`;
  const r = await registerVerified(request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: label + " " + nonce,
      email,
      password: "visual-264-secret-123",
    },
  });
  expect(r.status()).toBe(201);
  const user = (await r.json()).user;
  if (admin) {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
    } finally {
      await db.end();
    }
  }
  return user;
}
async function noOverflow(page) {
  const overflow = await pageOverflow(page);
  expect(overflow, overflow ? describeOverflow(overflow) : "fits").toBeNull();
}
// WCAG contrast of two computed colours. The browser resolves any syntax
// (rgb, color(srgb), oklab…) to sRGB through a canvas.
async function contrast(page, a, b) {
  const [x, y] = await page.evaluate(
    (colors) =>
      colors.map((color) => {
        const ctx = document.createElement("canvas").getContext("2d");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      }),
    [a, b],
  );
  const luminance = (rgb) => {
    const [r, g, bl] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
async function theme(page, value) {
  await page.evaluate((mode) => {
    document.documentElement.dataset.theme = mode;
  }, value);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
}
const home = {
  popular: Array.from({ length: 5 }, (_, i) => ({
    id: "hover-" + i,
    share_id: "hover-" + i,
    name: "Hover bike " + i,
    category: "gravel",
    photos: [],
    author: { name: "Rider", username: "hover-rider" },
    likes: 0,
    is_public: true,
  })),
  totalBikes: 5,
  events: [],
  content: [
    {
      id: "journal:hover",
      type: "journal",
      author: "Мария",
      title: "Запись для проверки наведения",
      href: "/journal/hover",
      createdAt: "2026-09-21T08:00:00Z",
      excerpt: "Короткий текст записи.",
    },
  ],
  records: ["light", "heavy", "long", "climb"].map((key, i) => ({
    key,
    name: "Рекорд " + (i + 1),
    metric: "weight",
    holder: { shareId: "record-" + i, name: "Держатель " + (i + 1), value: 9 },
  })),
};

test("home: card titles stay readable under the pointer and keyboard focus in both themes, even with a dark accent", async ({
  page,
}, info) => {
  await page.route("**/api/discovery/home", (route) =>
    route.fulfill({ json: home }),
  );
  await page.goto("/");
  // The administrator may pick a deep accent; titles must stay readable.
  await page.addStyleTag({ content: "html:root{--accent:#1d4ed8}" });
  const title = page
    .locator('[data-home-band="popular"] article')
    .first()
    .locator(":is(h2, h3) :is(a, button)");
  const story = page.locator('[data-home-band="community"] article').first();
  const storyTitle = story.locator("h3 a");
  const background = (locator) =>
    locator.evaluate((el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      }
      return "rgb(255, 255, 255)";
    });
  // The title's colour eases in: read it once the transition has ended.
  const color = (locator) =>
    locator.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
      return getComputedStyle(el).color;
    });
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    const rest = await color(title);
    await title.hover();
    await expect.poll(() => color(title)).not.toBe(rest);
    const hovered = await color(title);
    expect(
      await contrast(page, hovered, await background(title)),
      mode + " hover",
    ).toBeGreaterThanOrEqual(4.5);
    // Keyboard focus shows the same colour as the pointer.
    await page.mouse.move(0, 0);
    await expect.poll(() => color(title)).toBe(rest);
    await title.focus();
    await expect.poll(() => color(title)).toBe(hovered);
    await storyTitle.hover();
    await expect
      .poll(async () =>
        contrast(page, await color(storyTitle), await background(storyTitle)),
      )
      .toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    await storyTitle.focus();
    expect(
      await contrast(
        page,
        await color(storyTitle),
        await background(storyTitle),
      ),
      mode + " focus",
    ).toBeGreaterThanOrEqual(4.5);
    await page
      .locator('[data-home-band="popular"]')
      .screenshot({ path: info.outputPath(`home-hover-${mode}.png`) });
  }
});

test("home: records are a manual rail — scroll and keys move it, it never moves by itself, no arrow buttons", async ({
  page,
  isMobile,
}, info) => {
  await page.route("**/api/discovery/home", (route) =>
    route.fulfill({ json: home }),
  );
  if (!isMobile) await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/");
  const band = page.locator('[data-home-band="records"]');
  const region = band.getByRole("region", { name: "Рекорды сообщества" });
  const rail = region.getByLabel("Рекорды; используйте стрелки для прокрутки", {
    exact: true,
  });
  await expect(region.locator("article")).toHaveCount(4);
  await expect(region.getByRole("button")).toHaveCount(0);
  // One row: every card shares its top.
  const tops = await region
    .locator("article")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  await rail.scrollIntoViewIfNeeded();
  const scrolls = await rail.evaluate((n) => n.scrollWidth > n.clientWidth);
  expect(scrolls).toBe(true);
  // Nothing moves on its own.
  await page.waitForTimeout(1200);
  expect(await rail.evaluate((n) => n.scrollLeft)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await rail.focus();
  await rail.press("ArrowRight");
  await expect
    .poll(() => rail.evaluate((n) => n.scrollLeft))
    .toBeGreaterThan(0);
  await rail.press("Home");
  await expect.poll(() => rail.evaluate((n) => n.scrollLeft)).toBe(0);
  await noOverflow(page);
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    await band.screenshot({
      path: info.outputPath(`records-rail-${mode}.png`),
    });
  }
});

test("planners: «Дополнительно» starts folded in both windows and keeps what was typed", async ({
  page,
}, info) => {
  await member(page.request, "planner");
  for (const name of ["Cube Travel", "Trek Checkpoint"]) {
    const r = await page.request.post("/api/bikes", {
      headers: { origin },
      data: {
        name,
        brand: name.split(" ")[0],
        model: name.split(" ")[1],
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
      },
    });
    expect(r.status()).toBe(201);
  }
  await page.goto("/ride-intents");
  await page
    .getByRole("button", { name: "Выбрать время", exact: true })
    .click();
  const intent = page.getByRole("dialog", { name: "Новое намерение" });
  const extra = intent.locator("details.intent-advanced");
  await expect(extra).not.toHaveAttribute("open", "");
  await expect(extra.locator("summary")).toHaveText(
    "Дополнительно · только мне",
  );
  await expect(intent.getByLabel("Готовность знакомиться")).toBeHidden();
  await extra.locator("summary").click();
  await intent.getByLabel("Готовность знакомиться").selectOption("true");
  await intent.getByLabel("Сообществу ColaBike", { exact: true }).check();
  await extra.locator("summary").click();
  await expect(intent.getByLabel("Готовность знакомиться")).toBeHidden();
  await expect(extra.locator("summary")).toHaveText(
    "Дополнительно · сообществу",
  );
  await extra.locator("summary").click();
  await expect(intent.getByLabel("Готовность знакомиться")).toHaveValue("true");
  await intent.screenshot({ path: info.outputPath("intent-advanced.png") });
  await intent.getByRole("button", { name: "Отмена", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Закрыть форму" })
    .click();
  await expect(intent).toHaveCount(0);
  // Two bikes: the bike waits in the folded section until it is needed.
  await page.goto("/account?tab=rides&action=plan");
  const plan = page.getByRole("dialog", { name: "Организовать покатушку" });
  const advanced = plan.locator("details.planning-advanced");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(advanced.locator("summary")).toContainText("выберите велосипед");
  await plan.getByLabel("Название", { exact: true }).fill("Сбор у моста");
  await plan.getByLabel("Дата", { exact: true }).fill("2031-03-29");
  await plan.getByLabel("Старт", { exact: true }).fill("09:00");
  await plan
    .getByRole("button", { name: "Создать покатушку", exact: true })
    .click();
  await expect(advanced).toHaveAttribute("open", "");
  await expect(plan.getByLabel("Велосипед", { exact: true })).toBeFocused();
  await expect(plan.getByLabel("Название", { exact: true })).toHaveValue(
    "Сбор у моста",
  );
});

test("one «Хочу кататься» flow: the same «Новое намерение» window from home and /ride-intents, preferences kept apart", async ({
  page,
  browser,
}, info) => {
  // A guest's button leads to the page, which opens the window after sign-in.
  const guest = await browser.newContext({ baseURL: origin });
  try {
    const g = await guest.newPage();
    await g.goto("/");
    await expect(
      g
        .locator(".together-actions")
        .getByRole("link", { name: "Хочу кататься" }),
    ).toHaveAttribute("href", "/ride-intents?new=1");
  } finally {
    await guest.close();
  }
  await member(page.request, "flow");
  await page.goto("/ride-intents?new=1");
  const dialog = page.getByRole("dialog", { name: "Новое намерение" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/ride-intents$/);
  const lead = await dialog.locator(".planning-lead").textContent();
  expect(lead).toContain("конкретный раз");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", { name: "Новое намерение", level: 2 }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Постоянные предпочтения", level: 2 }),
  ).toBeVisible();
  // The home page opens the very same window, not another form.
  await page.goto("/");
  await page
    .locator(".together-actions")
    .getByRole("button", { name: "Хочу кататься" })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".planning-lead")).toHaveText(lead);
  await expect(dialog.getByLabel("Окно 1: с", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByRole("button", {
      name: "Сохранить как постоянные предпочтения",
    }),
  ).toBeVisible();
  for (const mode of ["light", "dark"]) {
    await theme(page, mode);
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await dialog.screenshot({ path: info.outputPath(`intent-${mode}.png`) });
  }
});

test("components: illustrations fit whole, five models across, and the model page has an action row, a description and photos side by side", async ({
  page,
  browser,
  isMobile,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const assets = [];
  const original = (
    await db.query("SELECT value FROM site_settings WHERE id=1")
  ).rows[0].value;
  try {
    await member(page.request, "components", { admin: true });
    const nonce = randomUUID().slice(0, 6);
    const created = await page.request.post("/api/bikes/wizard", {
      headers: { origin },
      data: {
        requestId: randomUUID(),
        bike: {
          name: "Showcase bike",
          brand: "Cube",
          model: "Nuroad",
          year: 2024,
          category: "gravel",
          is_public: true,
          description: "",
          color: "",
          size: "",
          weight: null,
        },
        components: [
          {
            section: "build",
            category: "Седло",
            name: "Brooks Showcase " + nonce,
            notes: "",
            price: null,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const bikeId = (await created.json()).id;
    const model = (
      await db.query("SELECT model_id FROM components WHERE bike_id=$1", [
        bikeId,
      ])
    ).rows[0].model_id;
    // A wide and a tall illustration: both must fit their square whole.
    const picture = async (width, height) => {
      const r = await page.request.post(
        "/api/admin/assets?name=" + width + "x" + height + ".png",
        {
          headers: { origin, "Content-Type": "image/png" },
          data: await sharp({
            create: { width, height, channels: 3, background: "#e0b040" },
          })
            .png()
            .toBuffer(),
        },
      );
      expect(r.status()).toBe(201);
      const id = (await r.json()).id;
      assets.push(id);
      return id;
    };
    const wide = await picture(900, 300),
      tall = await picture(300, 900);
    const site = await (await page.request.get("/api/admin/overview")).json();
    const saved = await page.request.put("/api/admin/settings", {
      headers: { origin },
      data: {
        value: {
          ...site.settings,
          componentIllustrations: {
            groups: { frame: wide, drivetrain: tall },
            categories: { Седло: tall },
          },
        },
        version: site.settingsVersion,
      },
    });
    expect(saved.status()).toBe(200);
    if (!isMobile) await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/components");
    const tiles = page.locator("section[aria-label='Категории компонентов']");
    const art = tiles.locator(`img[src$="/api/assets/${tall}"]`).first();
    await expect(art).toBeVisible();
    const box = await art.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThan(1.5);
    expect(await art.evaluate((i) => getComputedStyle(i).objectFit)).toBe(
      "contain",
    );
    // Group tiles in a row share one height, however tall the picture is.
    const heights = await tiles
      .locator("button[aria-expanded]")
      .evaluateAll((nodes) =>
        nodes.slice(0, 2).map((n) => Math.round(n.offsetHeight)),
      );
    expect(heights[0]).toBe(heights[1]);
    const results = page.getByRole("region", { name: "Модели компонентов" });
    const cover = results.locator(`img[src$="/api/assets/${tall}"]`).first();
    const frame = await cover.evaluate((img) => {
      const i = img.getBoundingClientRect(),
        c = img.parentElement.getBoundingClientRect();
      return { i: i.toJSON(), c: c.toJSON() };
    });
    expect(frame.i.top).toBeGreaterThanOrEqual(frame.c.top - 1);
    expect(frame.i.bottom).toBeLessThanOrEqual(frame.c.bottom + 1);
    if (!isMobile) {
      const columns = await results
        .locator("li")
        .evaluateAll(
          (items) =>
            new Set(items.map((li) => Math.round(li.getBoundingClientRect().x)))
              .size,
        );
      expect(columns).toBe(Math.min(5, await results.locator("li").count()));
    }
    await noOverflow(page);
    for (const mode of ["light", "dark"]) {
      await theme(page, mode);
      await page.screenshot({
        path: info.outputPath(`components-${mode}.png`),
      });
    }
    // The model page: edit first in one row of small buttons, then the
    // description on the left and the photos on the right.
    await page.goto("/components/" + model);
    const tools = page.getByRole("group", { name: "Действия с компонентом" });
    await expect(tools.getByRole("button").first()).toHaveText("Редактировать");
    const rows = await tools
      .getByRole("button")
      .evaluateAll(
        (nodes) =>
          new Set(nodes.map((n) => Math.round(n.getBoundingClientRect().top)))
            .size,
      );
    expect(rows).toBe(1);
    const about = page.getByRole("region", { name: "Описание", exact: true });
    await expect(about).toContainText("Описания пока нет");
    await about.getByRole("button", { name: "Добавить описание" }).click();
    const editor = page.getByRole("dialog", {
      name: "Редактировать компонент",
    });
    await expect(editor.getByLabel("Описание")).toBeFocused();
    await editor
      .getByLabel("Описание")
      .fill("Кожаное седло для длинных поездок.\n\nПривыкает к посадке.");
    await editor
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(about.locator("p")).toHaveText([
      "Кожаное седло для длинных поездок.",
      "Привыкает к посадке.",
    ]);
    const photos = page.getByRole("region", { name: "Фотографии компонента" });
    const [left, right] = await Promise.all([
      about.boundingBox(),
      photos.boundingBox(),
    ]);
    if (isMobile) expect(right.y).toBeGreaterThan(left.y + left.height - 1);
    else expect(right.x).toBeGreaterThan(left.x + left.width - 1);
    await noOverflow(page);
    for (const mode of ["light", "dark"]) {
      await theme(page, mode);
      expect(
        (
          await new AxeBuilder({ page })
            .include("main")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`component-page-${mode}.png`),
        fullPage: true,
      });
    }
    // A reader gets the description and no editing.
    const reader = await browser.newContext({ baseURL: origin });
    try {
      const r = await reader.newPage();
      await r.goto("/components/" + model);
      await expect(
        r.getByRole("region", { name: "Описание", exact: true }),
      ).toContainText("Привыкает к посадке.");
      await expect(
        r.getByRole("button", { name: "Редактировать", exact: true }),
      ).toHaveCount(0);
    } finally {
      await reader.close();
    }
  } finally {
    await db.query("UPDATE site_settings SET value=$1 WHERE id=1", [original]);
    for (const id of assets)
      await page.request.delete("/api/admin/assets/" + id, {
        headers: { origin },
      });
    await db.end();
  }
});
