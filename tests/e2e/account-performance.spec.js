import { test, expect } from "@playwright/test";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import pg from "pg";
import { bikeRow, componentRow } from "../support/bikes.ts";
import { pageOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function owner(page, count = 0) {
  const response = await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Performance owner",
      email: randomUUID() + "@account-perf.test",
      password: "account-perf-secret-123",
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const bikes = [];
  try {
    for (let i = 0; i < count; i++) {
      const b = await bikeRow(db, user.id, {
        name: `Performance bike ${String(i).padStart(2, "0")}`,
        is_public: i % 2 === 0,
        is_former: i % 3 === 0,
        description: "Owner detail notes",
      });
      bikes.push(b);
      await componentRow(db, b.id, {
        name: "Owner detail component",
        notes: "Editor-only component notes",
      });
    }
  } finally {
    await db.end();
  }
  return bikes;
}
async function section(page, label) {
  const link = page
    .locator(".account-nav-list a:visible")
    .filter({ hasText: new RegExp("^" + label + "$") });
  if (!(await link.count()))
    await page.getByRole("button", { name: /Раздел:/ }).click();
  await page
    .locator(".account-nav-list a:visible")
    .filter({ hasText: new RegExp("^" + label + "$") })
    .click();
}

test("account loads only the selected tab and compact overview, with no eager editors", async ({
  page,
}, info) => {
  await owner(page, 4);
  const requests = [],
    scripts = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
  });
  page.on("requestfinished", (r) => {
    if (r.resourceType() === "script")
      scripts.push(r.response().then((response) => response.text()));
  });
  await page.goto("/account?tab=profile");
  await expect(
    page.getByRole("heading", { name: "Мой профиль", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requests.filter((u) => new URL(u).pathname === "/api/bikes")).toEqual(
    [],
  );
  const source = (await Promise.all(scripts)).join("\n");
  expect(source).not.toContain("rides/csv-preview");
  expect(source).not.toContain("account/export");
  const gzipBytes = (await Promise.all(scripts)).reduce(
    (sum, s) => sum + gzipSync(s).length,
    0,
  );
  expect(gzipBytes).toBeLessThan(260 * 1024);
  await info.attach("account-profile-bundle", {
    body: JSON.stringify({ gzipBytes }),
    contentType: "application/json",
  });
  const profileReads = requests.filter(
    (u) => new URL(u).pathname === "/api/social/account",
  ).length;
  await section(page, "Обзор");
  await expect(page.locator(".recent-bikes .bike-card")).toHaveCount(3);
  const bikes = requests.filter((u) => new URL(u).pathname === "/api/bikes");
  expect(bikes).toHaveLength(1);
  expect(new URL(bikes[0]).searchParams.get("view")).toBe("cards");
  expect(new URL(bikes[0]).searchParams.get("limit")).toBe("3");
  await section(page, "Оформление");
  await expect(
    page.getByRole("heading", { name: "Оформление", exact: true }),
  ).toBeVisible();
  await section(page, "Обзор");
  await expect(page.locator(".recent-bikes .bike-card")).toHaveCount(3);
  expect(
    requests.filter((u) => new URL(u).pathname === "/api/bikes"),
  ).toHaveLength(1);
  expect(
    requests.filter((u) => new URL(u).pathname === "/api/social/account"),
  ).toHaveLength(profileReads);
  await section(page, "Мои покатушки");
  await expect(
    page.getByRole("heading", { name: "Мои покатушки", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(
    requests.filter((u) => new URL(u).pathname === "/api/bikes"),
  ).toHaveLength(1);
  await section(page, "Интеграции и импорт");
  await expect(
    page.getByRole("heading", { name: "Интеграции и импорт", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.filter(
          (u) => new URL(u).searchParams.get("view") === "choices",
        ).length,
    )
    .toBe(1);
  expect(await pageOverflow(page)).toBeNull();
});

test("large owner garage pages and filters on the server, then loads full detail independently", async ({
  page,
}, info) => {
  const bikes = await owner(page, 50);
  await page.goto("/account?tab=bikes");
  await expect(page.locator(".bike-card")).toHaveCount(24);
  const first = await page
    .locator(".bike-card")
    .evaluateAll((cards) => cards.map((card) => card.dataset.bikeId));
  const pager = page.getByRole("navigation", { name: "Страницы гаража" });
  await pager.getByRole("button", { name: "Далее" }).click();
  await expect(pager).toContainText("2 / 3");
  await expect(page.locator(".bike-card")).toHaveCount(24);
  await expect
    .poll(() => page.locator(".bike-card").first().getAttribute("data-bike-id"))
    .not.toBe(first[0]);
  const second = await page
    .locator(".bike-card")
    .evaluateAll((cards) => cards.map((card) => card.dataset.bikeId));
  expect(second.some((id) => first.includes(id))).toBe(false);
  await pager.getByRole("button", { name: "Далее" }).click();
  await expect(page.locator(".bike-card")).toHaveCount(2);
  const search = page.getByRole("searchbox", { name: "Поиск в гараже" });
  await search.fill("Performance bike 00");
  await expect(page.locator(".bike-card")).toHaveCount(1);
  await page
    .locator(".bike-card")
    .getByRole("button", { name: "Performance bike 00", exact: true })
    .click();
  await page.getByRole("tab", { name: /Комплектация/ }).click();
  const group = page.getByRole("button", {
    name: "Рама и подвеска 1",
    exact: true,
  });
  if ((await group.getAttribute("aria-expanded")) === "false") {
    await group.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByText("Owner detail component", { exact: true }),
  ).toBeVisible();
  // A deep link to a bike outside the first page still fetches its detail.
  await page.goto("/account?tab=bikes&bike=" + bikes[0].id);
  await expect(
    page.getByRole("heading", { name: "Performance bike 00", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Комплектация/ }).click();
  if ((await group.getAttribute("aria-expanded")) === "false") {
    await group.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByText("Owner detail component", { exact: true }),
  ).toBeVisible();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    expect(await pageOverflow(page)).toBeNull();
    await page.screenshot({
      path: info.outputPath(`garage-${colorScheme}.png`),
      fullPage: true,
    });
  }
});

test("a late overview response cannot replace the selected section; retry keeps the shell", async ({
  page,
}) => {
  await owner(page, 1);
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  let started;
  const seen = new Promise((done) => {
    started = done;
  });
  await page.route("**/api/bikes?view=cards&limit=3", async (route) => {
    started();
    await gate;
    await route.fulfill({ status: 200, json: { bikes: [] } }).catch(() => {});
  });
  await page.goto("/account");
  await seen;
  await section(page, "Мой профиль");
  release();
  await expect(
    page.getByRole("heading", { name: "Мой профиль", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/bikes?view=cards&limit=3");
  await section(page, "Обзор");
  await expect(page.locator(".recent-bikes .bike-card")).toHaveCount(1);
});
