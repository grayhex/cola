import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow } from "../fixtures/overflow.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// #374: the status of a search under the field of step 1 — a thin line, one
// phrase, the components, the last events. The page is given a stream that the
// test feeds line by line, so every state of a running search can be looked at.
async function member(page) {
  const suffix = randomUUID();
  const registered = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Progress " + suffix.slice(0, 8),
      email: suffix + "@example.test",
      password: "resolver-progress-secret-123",
    },
  });
  expect(registered.status()).toBe(201);
}
async function feedable(page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    const feed = (window.__feed = { opened: 0, lines: 0, closed: false });
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.endsWith("/api/bikes/resolve-stream"))
        return realFetch(input, init);
      feed.opened += 1;
      feed.closed = false;
      const encoder = new TextEncoder();
      let controller;
      const body = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      feed.push = (line) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
          feed.lines += 1;
        } catch {}
      };
      feed.end = () => {
        try {
          controller.close();
        } catch {}
      };
      init?.signal?.addEventListener("abort", () => {
        feed.closed = true;
        try {
          controller.error(new DOMException("aborted", "AbortError"));
        } catch {}
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      );
    };
  });
}
const event = (name, extra = {}) => ({
  type: "event",
  event: name,
  elapsedMs: 100,
  ...extra,
});
const push = (page, ...lines) =>
  page.evaluate((list) => list.forEach((l) => window.__feed.push(l)), lines);
async function startSearch(page, text = "Cube Aim 2020") {
  await page.goto("/account?tab=bikes");
  await page
    .getByRole("button", { name: "Добавить велосипед", exact: true })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Новый велосипед",
    exact: true,
  });
  await expect(wizard).toBeVisible();
  await wizard
    .getByLabel("Модель, год и комплектация", { exact: true })
    .fill(text);
  await wizard.getByRole("button", { name: /^Найти комплектацию/ }).click();
  await expect(wizard.locator(".resolver-run")).toBeVisible();
  return wizard;
}
const box = (locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

test("a running search: calm start, a line that moves, a phrase and a site from the events, one line of events, a block that does not change its height", async ({
  page,
}, info) => {
  await member(page);
  await feedable(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // A narrow window: the last events do not fit one line there.
  await page.setViewportSize({ width: 480, height: 900 });
  const wizard = await startSearch(page);
  const run = wizard.locator(".resolver-run");
  const stage = run.locator(".resolver-run-stage");
  const stop = wizard.getByRole("button", {
    name: "Остановить поиск",
    exact: true,
  });

  // Nothing has arrived: a calm start and a moving line, no site, no counts.
  await expect(run).toHaveAttribute("data-state", "running");
  await expect(run.locator(".resolver-run-title")).toHaveText(
    "Ищем комплектацию",
  );
  await expect(stage).toHaveText("Начинаем поиск");
  await expect(run.locator(".resolver-run-components")).toContainText(
    "пока нет данных",
  );
  await expect(run.locator(".resolver-run-events")).toContainText("пока нет");
  await expect(run.locator("summary, details")).toHaveCount(0);
  // The segment moves on the compositor: a running animation of transform.
  await expect
    .poll(() =>
      run.locator(".resolver-run-line i").evaluate((e) =>
        e
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) =>
            Object.keys(a.effect.getKeyframes()[0]).includes("transform"),
          )
          .some(Boolean),
      ),
    )
    .toBe(true);
  // The line is decoration: hidden from a reader of the screen.
  await expect(run.locator(".resolver-run-line")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  const calm = { run: await box(run), stop: await box(stop) };

  // A site appears only with the event that names it, and changes with it.
  await push(page, event("resolve_started"));
  await expect(stage).toHaveText("Начинаем поиск");
  await push(
    page,
    event("document_fetch_started", { host: "first-shop.example" }),
  );
  await expect(stage).toContainText("Загружаем страницу");
  await expect(stage.locator("code")).toHaveText("first-shop.example");
  await push(
    page,
    event("source_failed", { host: "first-shop.example", reason: "timeout" }),
  );
  await expect(stage).toContainText(
    "Источник не дал комплектацию, ищем дальше",
  );
  await expect(stage).toContainText("не ответил вовремя");
  // A site the page has never heard of is shown as it is: no list is kept.
  await push(
    page,
    event("document_fetch_started", { host: "second-store.example" }),
  );
  await expect(stage.locator("code")).toHaveText("second-store.example");
  await expect(stage).not.toContainText("first-shop.example");
  // The next event names no site: none is carried over to it.
  await push(page, event("normalization_started"));
  await expect(stage).toHaveText("Определяем компоненты");
  await expect(stage.locator("code")).toHaveCount(0);

  // Components: only what the stream says — the count of the last page; no
  // group gets a mark from a number.
  const components = run.locator(".resolver-run-components");
  await push(page, event("components_recognized", { count: 8, total: 12 }));
  await expect(components).toContainText("Распознано 8 из 12 характеристик");
  await expect(run.locator(".resolver-run-marks")).toHaveCount(0);

  // The events are in view without opening anything, in the words of the
  // stream, and there is no log under a spoiler.
  const events = run.locator(".resolver-run-events");
  await expect(events).toContainText("Начинаем поиск");
  await expect(events).toContainText("Загружаем страницу");
  await expect(events).toContainText("Источник не дал комплектацию");
  await expect(events).toContainText("Компоненты распознаны");

  // A hundred more: the block and the buttons under it stay where they were.
  const names = [
    "document_fetch_started",
    "document_fetched",
    "structured_data_found",
    "spec_section_found",
    "candidate_found",
    "store_checked",
    "source_failed",
  ];
  for (let i = 0; i < 100; i++)
    await push(
      page,
      event(names[i % names.length], {
        host: `shop-${i}.example`,
        count: i % 7 || undefined,
        reason: i % 7 === 6 ? "http_403" : undefined,
      }),
    );
  await expect(stage.locator("code")).toHaveText(/^shop-99\.example$/);
  const busy = { run: await box(run), stop: await box(stop) };
  expect(busy.run.height).toBe(calm.run.height);
  expect(busy.stop.y).toBe(calm.stop.y);
  expect(await pageOverflow(page)).toBeNull();
  // Every row is one line, whatever the phrase.
  for (const row of ["title", "stage", "components", "events"])
    expect(
      (await box(run.locator(`.resolver-run-${row}`))).height,
    ).toBeLessThan(30);
  // The ribbon does not fit: it fades at the edges and drifts; the pointer on
  // it holds it still.
  const view = events.locator(".resolver-run-view");
  await expect(view).toHaveAttribute("data-overflow");
  await expect
    .poll(() =>
      view
        .locator(".resolver-run-track")
        .evaluate(
          (e) =>
            e.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBeGreaterThan(0);
  await view.hover();
  await expect
    .poll(() =>
      view
        .locator(".resolver-run-track")
        .evaluate(
          (e) =>
            e.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  await page.mouse.move(0, 0);
  // And it can be held by the keyboard: a stop for those who cannot point.
  await expect(view).toHaveAttribute("tabindex", "0");
  await view.focus();
  await expect
    .poll(() =>
      view
        .locator(".resolver-run-track")
        .evaluate(
          (e) =>
            e.getAnimations().filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  await stop.focus();
  await page.screenshot({
    path: info.outputPath("resolver-progress-running.png"),
    animations: "disabled",
  });
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);

  // «Остановить поиск»: the line and the ribbon stop, the status says so, and
  // what the old stream still sends changes nothing.
  await stop.click();
  await expect(run).toHaveAttribute("data-state", "done");
  await expect(run).toHaveAttribute("data-outcome", "cancelled");
  await expect(run.locator(".resolver-run-title")).toHaveText(
    "Поиск остановлен",
  );
  await expect(stage).toHaveText("Поиск остановлен");
  await expect
    .poll(() =>
      run
        .locator(".resolver-run-line i, .resolver-run-track")
        .evaluateAll(
          (all) =>
            all.flatMap((e) =>
              e.getAnimations().filter((a) => a.playState === "running"),
            ).length,
        ),
    )
    .toBe(0);
  const before = await run.innerText();
  await push(page, event("document_fetch_started", { host: "late.example" }));
  await page.waitForTimeout(300);
  expect(await run.innerText()).toBe(before);
  await expect(wizard).toContainText("Поиск остановлен. Запустите его снова");
  // The way on never waited for the line.
  await expect(
    wizard.getByRole("button", { name: /^(Далее|Продолжить вручную)$/ }),
  ).toBeEnabled();
});

test("a reader of the screen gets one polite status that does not chatter, and a reduced-motion visitor gets a still line with the same words", async ({
  page,
}) => {
  await member(page);
  await feedable(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 480, height: 900 });
  const wizard = await startSearch(page);
  const run = wizard.locator(".resolver-run");
  const status = run.locator("[role=status]");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("Начинаем поиск");
  // A stream of events does not become a stream of announcements: the text
  // of the region changes at most once in a couple of seconds.
  await page.evaluate(() => {
    const region = document.querySelector(".resolver-run [role=status]");
    window.__announced = [];
    new MutationObserver(() =>
      window.__announced.push(region.textContent),
    ).observe(region, { childList: true, characterData: true, subtree: true });
  });
  const names = [
    "document_fetch_started",
    "document_fetched",
    "source_connected",
  ];
  for (let i = 0; i < 30; i++) {
    await push(page, event(names[i % 3], { host: `s${i}.example` }));
    await page.waitForTimeout(40);
  }
  await expect(run.locator(".resolver-run-stage code")).toHaveText(
    "s29.example",
  );
  const announced = await page.evaluate(() => window.__announced.length);
  expect(announced).toBeLessThanOrEqual(2);
  // Still: nothing moves, the words keep updating.
  expect(
    await run
      .locator(".resolver-run-line i, .resolver-run-track")
      .evaluateAll((all) => all.flatMap((e) => e.getAnimations()).length),
  ).toBe(0);
  expect(
    await run
      .locator(".resolver-run-phrase")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  // The ribbon that does not fit shows the newest events, not an empty start.
  const view = run.locator(".resolver-run-view");
  await expect(view).toHaveAttribute("data-overflow");
  expect(
    await view.evaluate((e) => {
      const track = e.querySelector(".resolver-run-track");
      const words = track.firstElementChild.getBoundingClientRect();
      return words.left < e.getBoundingClientRect().left;
    }),
  ).toBe(true);
  // The whole text is there for a reader, whatever the view shows.
  expect(await view.getAttribute("title")).toContain("·");
  // The result ends it: the announcement is at once.
  await page.evaluate(() => {
    window.__feed.push({
      type: "result",
      result: {
        status: "not_found",
        query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
        cached: false,
      },
    });
    window.__feed.end();
  });
  await expect(run).toHaveAttribute("data-outcome", "not_found");
  await expect(status).toHaveText("Комплектация не найдена");
});

test("how a search ended: a result that is not found draws no line, a broken stream says so, a new query lets go of the old status", async ({
  page,
}) => {
  await member(page);
  await feedable(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wizard = await startSearch(page);
  const run = wizard.locator(".resolver-run");
  const line = run.locator(".resolver-run-line");
  const lineColour = () =>
    line.evaluate((e) => getComputedStyle(e).backgroundImage);
  const idle = await lineColour();
  await push(
    page,
    event("discovery_started"),
    event("candidate_found", { count: 3 }),
  );
  await expect(run.locator(".resolver-run-stage")).toContainText(
    "Найдены варианты",
  );
  await expect(run.locator(".resolver-run-stage small")).toHaveText("3");
  // Several variants offered: the choice is still ahead, nothing is drawn done.
  await page.evaluate(() => {
    window.__feed.push({
      type: "result",
      result: {
        status: "ambiguous",
        query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
        cached: false,
        candidates: [],
      },
    });
    window.__feed.end();
  });
  await expect(run).toHaveAttribute("data-outcome", "ambiguous");
  await expect(run.locator(".resolver-run-stage")).toHaveText(
    "Нашли варианты — выберите свой",
  );
  expect(await lineColour()).toBe(idle);
  await expect(run.locator(".resolver-run-marks")).toHaveCount(0);
  // The events stay in view after the end, still.
  await expect(run.locator(".resolver-run-events")).toContainText(
    "Найдены варианты",
  );

  // Editing the request lets go of the status of the old one: its events do
  // not describe the new query.
  const field = wizard.getByLabel("Модель, год и комплектация", {
    exact: true,
  });
  await field.fill("Giant Contend 2022");
  await expect(run).toHaveCount(0);
  await field.fill("Cube Aim 2020");
  await expect(run).toHaveCount(1);
  await expect(run).toHaveAttribute("data-outcome", "ambiguous");

  // A broken stream.
  await wizard.getByRole("button", { name: /^Повторить/ }).click();
  await expect(run).toHaveAttribute("data-state", "running");
  await expect(run.locator(".resolver-run-stage")).toHaveText("Начинаем поиск");
  await expect(run.locator(".resolver-run-events")).toContainText("пока нет");
  await page.evaluate(() => window.__feed.end());
  await expect(run).toHaveAttribute("data-outcome", "failed");
  await expect(run.locator(".resolver-run-title")).toHaveText("Поиск прерван");
  expect(await lineColour()).toBe(idle);

  // «Продолжить вручную» takes the status with it.
  await wizard.getByRole("button", { name: "Продолжить вручную" }).click();
  await wizard.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(wizard.locator(".resolver-run")).toHaveCount(0);
});

for (const scheme of ["light", "dark"])
  test(`the status in both themes, phone and desktop (${scheme})`, async ({
    page,
  }, info) => {
    await member(page);
    await feedable(page);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      const wizard = await startSearch(page);
      const run = wizard.locator(".resolver-run");
      await push(
        page,
        event("resolve_started"),
        event("document_fetch_started", {
          host: "a-rather-long-store-name.example",
        }),
        event("source_failed", {
          host: "a-rather-long-store-name.example",
          reason: "access_challenge",
        }),
        event("components_recognized", { count: 14, total: 20 }),
      );
      await expect(run.locator(".resolver-run-events")).toContainText(
        "Компоненты распознаны",
      );
      expect(await pageOverflow(page)).toBeNull();
      expect(await wizard.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      // The line is 1–2 px, in the line colour, as wide as the field.
      const line = await run.locator(".resolver-run-line").evaluate((e) => ({
        height: e.getBoundingClientRect().height,
        width: e.getBoundingClientRect().width,
      }));
      const field = await wizard
        .getByLabel("Модель, год и комплектация", { exact: true })
        .evaluate((e) => e.getBoundingClientRect().width);
      expect(Math.abs(line.width - field)).toBeLessThan(4);
      expect(line.height).toBeLessThanOrEqual(8);
      expect(
        (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
      ).toEqual([]);
      await wizard.screenshot({
        path: info.outputPath(`resolver-progress-${scheme}-${width}.png`),
        animations: "disabled",
      });
    }
  });

test("the admin Inspector keeps the full technical log: every event with its time, behind «Подробнее»", async ({
  page,
}) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let user;
  try {
    await member(page);
    user = (await (await page.request.get("/api/me")).json()).user.id;
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user]);
    const lines = [
      event("resolve_started", { elapsedMs: 120 }),
      event("document_fetch_started", { host: "shop.example", elapsedMs: 480 }),
      event("source_failed", {
        host: "shop.example",
        reason: "http_403",
        elapsedMs: 1500,
      }),
      event("components_recognized", { count: 6, total: 9, elapsedMs: 2200 }),
      {
        type: "result",
        result: {
          status: "not_found",
          query: { brand: "Cube", model: "Aim", trim: null, year: 2020 },
          cached: false,
        },
      },
    ];
    await page.route("**/api/admin/resolver/inspect", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Система", exact: true }).click();
    await page
      .getByRole("button", { name: "Bike Resolver", exact: true })
      .click();
    await page.getByText("Диагностика парсера", { exact: true }).click();
    await page.getByLabel("Производитель").fill("Cube");
    await page.getByLabel("Модель", { exact: true }).fill("Aim");
    await page.getByLabel("Год", { exact: true }).fill("2020");
    await page
      .getByRole("button", { name: "Проверить комплектацию", exact: true })
      .click();
    const log = page.locator(".resolver-timeline");
    await expect(log).toBeVisible();
    // The diagnostic view is not the wizard's short status.
    await expect(page.locator(".resolver-run")).toHaveCount(0);
    const summary = log.locator("summary");
    await expect(summary).toHaveText("Подробнее · 4 событий");
    await summary.click();
    const rows = log.locator("details li");
    await expect(rows).toHaveCount(4);
    // Each event with its host, the reason of a failure, its counts and time.
    await expect(rows.nth(1)).toContainText("shop.example");
    await expect(rows.nth(2)).toContainText("сайт отклонил запрос");
    await expect(rows.nth(3)).toContainText("6 / 9");
    await expect(rows.nth(0).locator("time")).toHaveText("0.1 с");
    await expect(rows.nth(2).locator("time")).toHaveText("1.5 с");
  } finally {
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  }
});
