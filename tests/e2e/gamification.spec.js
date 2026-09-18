import { test, expect, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
async function register(request, name) {
  const r = await request.post("/api/auth/register", {
    headers: { origin },
    data: {
      name,
      email: name + "@example.test",
      password: "gamification-browser-123",
    },
  });
  expect(r.status()).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function create(request, name, weight) {
  const input = {
    name,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight,
    is_public: true,
  };
  const r = await request.post("/api/bikes", {
    headers: { origin },
    data: input,
  });
  expect(r.status()).toBe(201);
  const id = (await r.json()).id;
  // Real tiny PNG is decoded by existing safe photo upload.
  const upload = await request.post("/api/bikes/" + id + "/photos", {
    headers: { origin, "Content-Type": "image/png" },
    data: await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#e7482f" },
    })
      .png()
      .toBuffer(),
  });
  expect(upload.status()).toBe(201);
  return {
    input,
    ...(await (await request.get("/api/bikes/" + id)).json()).bike,
  };
}
test("Hall of Fame changes its current record holder, with profile awards and mobile reactions", async ({
  page,
  browser,
  isMobile,
}) => {
  const suffix = randomUUID().slice(0, 8),
    a = await register(page.request, "record-a-" + suffix),
    first = await create(page.request, "Feather " + suffix, 3.2);
  const context = await browser.newContext({
    ...(isMobile ? devices["iPhone 13"] : {}),
    baseURL: origin,
  });
  try {
    const visitor = await context.newPage();
    await register(visitor.request, "record-b-" + suffix);
    await page.goto("/records");
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      first.name,
    );
    const second = await create(visitor.request, "Lighter " + suffix, 3.1);
    await page.reload();
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      second.name,
    );
    await expect(
      page.locator('[data-record="lightest_road"]'),
    ).not.toContainText(first.name);
    await visitor.request.patch("/api/bikes/" + second.id, {
      headers: { origin },
      data: { ...second.input, is_public: false },
    });
    await page.reload();
    await expect(page.locator('[data-record="lightest_road"]')).toContainText(
      first.name,
    );
    await visitor.goto("/b/" + first.share_id);
    await visitor
      .getByRole("button", { name: "Безумие 0", exact: true })
      .click();
    await expect(
      visitor.getByRole("button", { name: "Безумие 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/u/" + a.username);
    await expect(page.locator(".badge-shelf")).toContainText("Первый выход");
    await expect(page.locator(".badge-shelf")).toContainText("Легче ветра");
    await page.goto("/account?tab=achievements");
    await expect(page.locator(".badge-shelf")).toContainText(
      "Следующая вершина",
    );
    await visitor.goto("/records");
    await expect(visitor.locator('[data-record="wild"]')).toContainText(
      first.name,
    );
    expect(
      await visitor.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    for (const request of [page.request, context.request]) {
      const result = await request.get("/api/bikes");
      for (const b of (await result.json()).bikes || [])
        await request.delete("/api/bikes/" + b.id, { headers: { origin } });
    }
    await context.close();
  }
});
