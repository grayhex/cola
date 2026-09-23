import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// Regression for #66: a long automatic username squeezed the title to "Мой э…".
test("bike title stays readable next to a long author username", async ({
  page,
  playwright,
}) => {
  const owner = await playwright.request.newContext({ baseURL: origin });
  try {
    const register = await owner.post("/api/auth/register", {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Heading",
        email: randomUUID() + "@heading.test",
        password: "heading-browser-secret",
      },
    });
    expect(register.status()).toBe(201);
    const { user } = await (await owner.get("/api/me")).json();
    // The default username is "rider-" plus 24 hex characters.
    expect(user.username.length).toBeGreaterThanOrEqual(30);
    const name = "Мой эндуро на каждый день и выходные";
    const created = await owner.post("/api/bikes", {
      headers: { origin },
      data: {
        name,
        brand: "Specialized",
        model: "Stumpjumper EVO",
        year: 2023,
        category: "mtb",
        description: "",
        color: "",
        size: "S3",
        weight: 14.8,
        is_public: true,
      },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const { bike } = await (await owner.get("/api/bikes/" + id)).json();

    await page.goto("/b/" + bike.share_id);
    const title = page.locator(".bike-heading h1");
    await expect(title).toHaveText(name);
    const author = page.locator(".bike-heading .detail-actions .author-link");
    await expect(author).toBeVisible();
    const geometry = await title.evaluate((h1) => ({
      clippedX: h1.scrollWidth - h1.clientWidth,
      clippedY: h1.scrollHeight - h1.clientHeight,
      lineHeight: parseFloat(getComputedStyle(h1).lineHeight),
      width: h1.getBoundingClientRect().width,
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(geometry.clippedX).toBeLessThanOrEqual(1);
    // Descenders may overflow the line box by a few pixels; a hidden line may not.
    expect(geometry.clippedY).toBeLessThan(geometry.lineHeight / 2);
    // The title keeps a readable share of the row instead of a few letters.
    expect(geometry.width).toBeGreaterThanOrEqual(
      Math.min(geometry.viewport * 0.5, 320),
    );
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    const box = await author.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(geometry.viewport + 1);
  } finally {
    await owner.dispose();
  }
});
