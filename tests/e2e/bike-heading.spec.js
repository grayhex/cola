import { testConsents } from "../fixtures/legal.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// Regression for #66: a long automatic username squeezed the title to "Мой э…".
test("bike title stays readable next to a long author name and username", async ({
  page,
  playwright,
}) => {
  const owner = await playwright.request.newContext({ baseURL: origin });
  // The longest handle and a long name must not squeeze the title (#66, #71).
  const username = "heading-" + randomUUID().replaceAll("-", "").slice(0, 22);
  const author = "Александра Константинопольская-Задунайская";
  try {
    const register = await owner.post("/api/auth/register", {
      headers: { origin },
      data: {
        ...testConsents,
        name: author,
        email: randomUUID() + "@heading.test",
        password: "heading-browser-secret",
        username,
      },
    });
    expect(register.status()).toBe(201);
    const { user } = await (await owner.get("/api/me")).json();
    expect(user.username).toBe(username);
    const name = "Мой эндуро на каждый день и выходные";
    const created = await owner.post("/api/bikes", {
      headers: { origin },
      data: {
        name,
        brand: "Specialized",
        model: "Stumpjumper EVO",
        year: 2023,
        category: "mtb",
        description: "Трейлы по выходным, в будни — до работы.",
        color: "",
        size: "S3",
        weight: 14.8,
        is_public: true,
        price: 250000,
        show_bike_price: true,
        manufacturer_url: "https://www.specialized.com/",
      },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const { bike } = await (await owner.get("/api/bikes/" + id)).json();

    await page.goto("/b/" + bike.share_id);
    const title = page.locator(".bike-heading h1");
    await expect(title).toHaveText(name);
    const authorLink = page.locator(".bike-heading .author-link");
    await expect(authorLink).toContainText(author);
    await expect(authorLink).not.toContainText("@");
    // #77: the model under a custom name, the year as a badge (#104);
    // description, public price and the manufacturer link under the title.
    await expect(page.locator(".bike-subtitle")).toHaveText(
      "Specialized Stumpjumper EVO",
    );
    await expect(
      page.locator(".bike-heading").getByText("2023", { exact: true }),
    ).toBeVisible();
    const intro = page.locator(".bike-heading .bike-intro");
    await expect(intro).toContainText("Трейлы по выходным");
    await expect(intro).toContainText(/250\s000\s₽/);
    await expect(
      intro.getByRole("link", { name: "Сайт производителя", exact: true }),
    ).toHaveAttribute("href", "https://www.specialized.com/");
    // No rides yet: one compact line instead of an empty column.
    await expect(page.locator(".bike-rides-empty")).toHaveText(
      "Покатушек с этим велосипедом пока нет",
    );
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
    const box = await authorLink.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(geometry.viewport + 1);
  } finally {
    await owner.dispose();
  }
});
