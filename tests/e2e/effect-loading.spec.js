import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "../fixtures/legal.js";

const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

async function admin(page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Effect checks",
      email: randomUUID() + "@effects.test",
      password: "effect-browser-check-123",
    },
  });
  expect(response.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  } finally {
    await db.end();
  }
  await page.goto("/admin");
}

test("admin search reads the latest draft on submit without refetching on typing", async ({
  page,
}) => {
  const queries = [];
  await page.route("**/api/admin/users?**", (route) => {
    queries.push(new URL(route.request().url()).searchParams.get("q"));
    return route.fulfill({ json: { users: [], total: 0 } });
  });
  await admin(page);
  await page.getByRole("button", { name: "Пользователи", exact: true }).click();
  await expect.poll(() => queries).toEqual([""]);
  const search = page.getByRole("textbox", { name: "Поиск пользователей" });
  await search.fill("latest query");
  // Let effects scheduled by the input render settle before testing no request.
  await page.waitForTimeout(300);
  expect(queries).toEqual([""]);
  await search.press("Enter");
  await expect.poll(() => queries).toEqual(["", "latest query"]);
});

for (const staleStatus of [200, 500]) {
  test(`reports ignore a late ${staleStatus} from the previous filter`, async ({
    page,
  }) => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let waiting = false;
    const report = (name) => ({
      id: name,
      entityType: "bike",
      target: { name },
      reporter: { username: "reporter" },
      createdAt: "2026-09-01T12:00:00Z",
      reason: "spam",
      status: "closed",
    });
    await page.route("**/api/community/admin/reports?**", async (route) => {
      const stale =
        new URL(route.request().url()).searchParams.get("status") === "closed";
      if (stale) {
        waiting = true;
        await pending;
      }
      await route.fulfill({
        status: stale ? staleStatus : 200,
        json: {
          reports: [report(stale ? "Устаревшая жалоба" : "Актуальная жалоба")],
          total: 1,
          error: "Устаревшая ошибка",
        },
      });
    });
    try {
      await admin(page);
      await page.getByRole("button", { name: "Жалобы", exact: true }).click();
      await expect(page.locator(".report-card")).toContainText(
        "Актуальная жалоба",
      );
      const filter = page.getByRole("combobox", { name: "Статус жалоб" });
      await filter.selectOption("closed");
      await expect.poll(() => waiting).toBe(true);
      const current = page.waitForResponse((r) =>
        r.url().includes("reports?status=open"),
      );
      await filter.selectOption("open");
      await current;
      const stale = page.waitForResponse((r) =>
        r.url().includes("reports?status=closed"),
      );
      release();
      await (await stale).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(page.locator(".report-card")).toContainText(
        "Актуальная жалоба",
      );
      await expect(page.getByText("Устаревшая жалоба")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("password recovery link keeps the same browser document", async ({
  page,
}) => {
  await page.goto("/login");
  const clock = await page.evaluate(() => performance.timeOrigin);
  await page.locator('.auth-form a[href="/forgot-password"]').click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(
    page.getByRole("textbox", { name: "Электронная почта", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(clock);
});
