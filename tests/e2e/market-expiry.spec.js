import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "../fixtures/legal.js";
import { pageOverflow, describeOverflow } from "../fixtures/overflow.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

async function register(request, name) {
  expect(
    (
      await request.post("/api/auth/register", {
        headers: { origin },
        data: {
          ...testConsents,
          name,
          email: `${name}@example.test`,
          password: "market-expiry-secret-123",
        },
      })
    ).status(),
  ).toBe(201);
  return (await (await request.get("/api/me")).json()).user;
}
async function listing(request, title, status = "active") {
  const response = await request.post("/api/market", {
    headers: { origin },
    data: {
      title,
      description: "Listing for the term test",
      category: "components",
      listingType: "sale",
      condition: "used",
      price: 2500,
      currency: "RUB",
      location: "Москва",
      contact: "@seller",
      status,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function noOverflow(page, where) {
  const overflow = await pageOverflow(page);
  expect(overflow, overflow && `${where}: ${describeOverflow(overflow)}`).toBe(
    null,
  );
}

// #116: saving, the seller's other listings, the end of the term and the
// owner's one-click extension, from the page and from the notice.
test("market listing: save, other listings of the seller, expiry and extension", async ({
  page,
  browser,
}, info) => {
  page.setDefaultTimeout(15000);
  const nonce = randomUUID().slice(0, 8);
  const seller = await register(page.request, "seller-" + nonce);
  const main = await listing(page.request, "Колёса " + nonce),
    second = await listing(page.request, "Педали " + nonce);
  await listing(page.request, "Черновик " + nonce, "draft");
  const buyerContext = await browser.newContext(info.project.use);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const buyer = await buyerContext.newPage();
    buyer.setDefaultTimeout(15000);
    await register(buyer.request, "buyer-" + nonce);

    // A buyer saves the listing and finds the seller's other one below.
    await buyer.goto("/market/" + main.shareId);
    const save = buyer.getByRole("button", { name: "Сохранить", exact: true });
    await save.click();
    await expect(
      buyer.getByRole("button", { name: "Сохранено", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const others = buyer.getByRole("region", {
      name: "Другие объявления продавца",
    });
    await expect(others.locator("article")).toHaveCount(1);
    await expect(others).toContainText("Педали " + nonce);
    await expect(others).not.toContainText("Черновик");
    await noOverflow(buyer, "listing");
    await buyer.screenshot({
      path: info.outputPath("listing.png"),
      fullPage: true,
      animations: "disabled",
    });
    await others
      .getByRole("link", { name: "Все объявления продавца", exact: true })
      .click();
    await expect(buyer).toHaveURL(
      new RegExp("/market\\?seller=" + seller.username + "$"),
    );
    await expect(buyer.getByText("Объявления продавца")).toBeVisible();
    await expect(buyer.locator("article[data-listing-id]")).toHaveCount(2);
    await buyer
      .getByRole("button", { name: "Показать объявления всех продавцов" })
      .click();
    await expect(buyer).toHaveURL(/\/market$/);

    // Saved listings have their own tab in /saved.
    await buyer.goto("/saved");
    await buyer
      .getByRole("button", { name: "Объявления", exact: true })
      .click();
    await expect(buyer).toHaveURL(/\/saved\?type=market$/);
    await expect(buyer.locator("article[data-listing-id]")).toHaveCount(1);
    await expect(buyer.locator("article[data-listing-id]")).toContainText(
      "Колёса " + nonce,
    );

    // The term ends: the server's clock is real, so the term moves.
    await db.query(
      "UPDATE market_listings SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [main.id],
    );
    await buyer.goto("/market/" + main.shareId);
    await expect(buyer.getByText("Срок публикации истёк")).toBeVisible();
    await expect(
      buyer.getByRole("button", { name: "Показать контакт" }),
    ).toHaveCount(0);
    await expect(buyer.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await buyer.goto("/saved?type=market");
    await expect(buyer.getByText("Сохранённых объявлений нет")).toBeVisible();
    await buyer.goto("/market?q=" + encodeURIComponent("Колёса " + nonce));
    await expect(buyer.getByText("Пока нет объявлений")).toBeVisible();

    // The owner sees «Срок истёк» and extends the listing in one click.
    await page.goto("/market/" + main.shareId);
    await expect(
      page.getByText("Срок истёк · объявления нет в поиске и ленте"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Продлить на 60 дней", exact: true })
      .click();
    await expect(page.getByText(/^На рынке до /)).toBeVisible();
    await expect(page.getByText("Срок истёк")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("owner.png"),
      fullPage: true,
      animations: "disabled",
    });
    await buyer.goto("/saved?type=market");
    await expect(buyer.locator("article[data-listing-id]")).toHaveCount(1);

    // Three days before the end the owner gets a notice with the same button.
    await db.query(
      "UPDATE market_listings SET expires_at=now()+interval '2 days' WHERE id=$1",
      [second.id],
    );
    await page.goto("/notifications");
    const notice = page
      .locator(".notification-list li")
      .filter({ hasText: "Педали " + nonce });
    await expect(notice).toContainText("снимется с публикации");
    await noOverflow(page, "notifications");
    await page.screenshot({
      path: info.outputPath("notifications.png"),
      fullPage: true,
      animations: "disabled",
    });
    await notice
      .getByRole("button", { name: "Продлить на 60 дней", exact: true })
      .click();
    await expect(notice).toContainText("продлено до");
    await expect(
      notice.getByRole("button", { name: "Продлить на 60 дней" }),
    ).toHaveCount(0);
    const term = (
      await db.query("SELECT expires_at FROM market_listings WHERE id=$1", [
        second.id,
      ])
    ).rows[0].expires_at;
    expect(term.getTime()).toBeGreaterThan(Date.now() + 59 * 86400000);
  } finally {
    await db.end();
    await buyerContext.close();
  }
});
