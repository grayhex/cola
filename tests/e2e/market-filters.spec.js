import { registerVerified } from "../fixtures/verified-user.js";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";

// Exercise the real page/effects/history without sharing mutable database data.
const listings = [
  { title: "Колесо №1", category: "components", listingType: "sale", condition: "used" },
  { title: "Колесо №2", category: "components", listingType: "sale", condition: "used" },
  { title: "Ищу велосипед", category: "bikes", listingType: "wanted", condition: "new" },
].map((listing, i) => ({
  ...listing,
  id: `10000000-0000-4000-8000-00000000000${i + 1}`,
  shareId: `20000000-0000-4000-8000-00000000000${i + 1}`,
  description: "Синтетическое объявление для проверки фильтров",
  price: 1000,
  currency: "RUB",
  status: "active",
  location: "Тестовый город",
  photos: [],
  author: { name: "Filter fixture", username: "filter_fixture" },
  isOwner: false,
}));

async function mockMarket(page, beforeReply = async () => {}) {
  const requests = [];
  await page.route((url) => url.pathname === "/api/market", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params.toString());
    await beforeReply(params);
    const matches = listings.filter((listing) =>
      (!params.get("category") || params.get("category") === listing.category) &&
      (!params.get("type") || params.get("type") === listing.listingType) &&
      (!params.get("condition") || params.get("condition") === listing.condition) &&
      listing.title.toLowerCase().includes((params.get("q") || "").toLowerCase()),
    );
    const current = Number(params.get("page") || 1);
    await route.fulfill({ json: {
      items: matches.slice(current - 1, current),
      total: matches.length,
      page: current,
      pageSize: 1,
    } });
  });
  return requests;
}

// Let the click/popstate commit and passive effects finish before asserting
// that an unchanged request has NOT cleared the existing result.
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ));
}
async function result(page, title, total) {
  await expect(page.getByText(`Найдено объявлений: ${total}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Загружаем объявления…", { exact: true })).toHaveCount(0);
}

test("reapplying the same market search and filters keeps results and history", async ({ page }) => {
  const requests = await mockMarket(page);
  await page.goto("/market");
  await result(page, "Колесо №1", 3);
  const panel = page.getByRole("region", { name: "Фильтры объявлений" });
  const search = page.getByRole("search", { name: "Поиск объявлений" });
  const find = search.getByRole("button", { name: "Найти", exact: true });
  async function unchanged(action, title, total) {
    const count = requests.length;
    const history = await page.evaluate(() => window.history.length);
    await action();
    await settle(page);
    await result(page, title, total);
    expect(requests).toHaveLength(count);
    expect(await page.evaluate(() => window.history.length)).toBe(history);
  }
  await unchanged(() => find.click(), "Колесо №1", 3);
  await unchanged(() => panel.getByRole("button", { name: "Все объявления", exact: true }).click(), "Колесо №1", 3);
  await unchanged(() => panel.getByRole("button", { name: "Все", exact: true }).click(), "Колесо №1", 3);
  await search.getByRole("searchbox").fill("Колесо");
  await find.click();
  await result(page, "Колесо №1", 2);
  await panel.getByRole("button", { name: "Комплектующие", exact: true }).click();
  await panel.getByRole("combobox", { name: "Тип объявления", exact: true }).selectOption("sale");
  await panel.getByRole("combobox", { name: "Состояние", exact: true }).selectOption("used");
  await settle(page);
  await result(page, "Колесо №1", 2);
  await unchanged(() => find.click(), "Колесо №1", 2);
  await unchanged(() => panel.getByRole("button", { name: "Комплектующие", exact: true }).click(), "Колесо №1", 2);
  await search.getByRole("searchbox").fill("Нет такого");
  await find.click();
  await result(page, "Пока нет объявлений", 0);
  await unchanged(() => find.click(), "Пока нет объявлений", 0);
  await panel.getByRole("button", { name: "Сбросить фильтры" }).click();
  await result(page, "Колесо №1", 3);
  await expect(search.getByRole("searchbox")).toHaveValue("");
});

test("market back, forward and reload restore filters and page, including equivalent URLs", async ({ page }) => {
  const requests = await mockMarket(page);
  const params = new URLSearchParams({ category: "components", type: "sale", condition: "used", q: "Колесо" });
  await page.goto("/market?" + params);
  await result(page, "Колесо №1", 2);
  const firstUrl = page.url();
  await page.getByRole("navigation", { name: "Страницы", exact: true })
    .getByRole("button", { name: "Далее", exact: true }).click();
  await result(page, "Колесо №2", 2);
  const secondUrl = page.url();
  expect(new URL(secondUrl).searchParams.get("page")).toBe("2");
  await page.goBack();
  await expect(page).toHaveURL(firstUrl);
  await result(page, "Колесо №1", 2);
  await page.goForward();
  await expect(page).toHaveURL(secondUrl);
  await result(page, "Колесо №2", 2);
  await page.reload();
  await result(page, "Колесо №2", 2);
  const panel = page.getByRole("region", { name: "Фильтры объявлений" });
  await expect(panel.getByRole("button", { name: "Комплектующие", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("combobox", { name: "Тип объявления", exact: true })).toHaveValue("sale");
  await expect(panel.getByRole("combobox", { name: "Состояние", exact: true })).toHaveValue("used");
  await expect(page.getByLabel("Поиск на рынке", { exact: true })).toHaveValue("Колесо");

  // Old bookmarks/history may contain irrelevant parameters or duplicate states.
  // popstate must not clear data if the canonical request key stays unchanged.
  const count = requests.length;
  await page.evaluate(() => window.history.pushState(null, "", location.href + "&ignored=1"));
  const equivalentUrl = page.url();
  await page.goBack();
  await expect(page).toHaveURL(secondUrl);
  await settle(page);
  await result(page, "Колесо №2", 2);
  expect(requests).toHaveLength(count);
  await page.goForward();
  await expect(page).toHaveURL(equivalentUrl);
  await settle(page);
  await result(page, "Колесо №2", 2);
  expect(requests).toHaveLength(count);
});

test("a late market response cannot replace a newer search result", async ({ page }) => {
  let release, seen;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { seen = resolve; });
  await mockMarket(page, async (params) => {
    if (params.get("q") === "Медленный запрос") {
      seen();
      await gate;
    }
  });
  try {
    await page.goto("/market");
    await result(page, "Колесо №1", 3);
    const search = page.getByRole("search", { name: "Поиск объявлений" });
    await search.getByRole("searchbox").fill("Медленный запрос");
    await search.getByRole("button", { name: "Найти", exact: true }).click();
    await started;
    await expect(page.getByText("Загружаем объявления…", { exact: true })).toBeVisible();
    await search.getByRole("searchbox").fill("Колесо");
    await search.getByRole("button", { name: "Найти", exact: true }).click();
    await result(page, "Колесо №1", 2);
    const late = page.waitForResponse((response) =>
      new URL(response.url()).searchParams.get("q") === "Медленный запрос",
    );
    release();
    await (await late).finished();
    await settle(page);
    await result(page, "Колесо №1", 2);
    await expect(search.getByRole("searchbox")).toHaveValue("Колесо");
  } finally {
    release();
  }
});

test("price, city and sort live in the URL and survive reload and reset", async ({ page }) => {
  const requests = await mockMarket(page);
  await page.goto("/market");
  await result(page, "Колесо №1", 3);
  const panel = page.getByRole("region", { name: "Фильтры объявлений" });
  const range = panel.getByRole("form", { name: "Цена и город" });
  await range.getByLabel("Цена от, ₽", { exact: true }).fill("500");
  await range.getByLabel("Цена до, ₽", { exact: true }).fill("5000");
  await range.getByLabel("Город", { exact: true }).fill(" Москва ");
  await range.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page).toHaveURL(/price_min=500&price_max=5000&city=/);
  await panel.getByRole("combobox", { name: "Сортировка", exact: true }).selectOption("price_asc");
  await expect(page).toHaveURL(/sort=price_asc/);
  await result(page, "Колесо №1", 3);
  expect(Object.fromEntries(new URLSearchParams(requests.at(-1)))).toMatchObject({
    price_min: "500", price_max: "5000", city: "Москва", sort: "price_asc",
  });
  await page.reload();
  await result(page, "Колесо №1", 3);
  await expect(range.getByLabel("Цена от, ₽", { exact: true })).toHaveValue("500");
  await expect(range.getByLabel("Город", { exact: true })).toHaveValue("Москва");
  await expect(panel.getByRole("combobox", { name: "Сортировка", exact: true })).toHaveValue("price_asc");
  await panel.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(page).toHaveURL(/\/market$/);
  await expect(range.getByLabel("Цена до, ₽", { exact: true })).toHaveValue("");
  await expect(panel.getByRole("combobox", { name: "Сортировка", exact: true })).toHaveValue("new");
});

test("market contact: guests are invited to sign in, members reveal it on request", async ({ page, browser }) => {
  // The listing page and the reader both come from the server (#74), so the
  // listing and the member are real; only the contact reply is mocked.
  const nonce = randomUUID().slice(0, 8);
  const seller = await browser.newContext();
  expect((await registerVerified(seller.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Seller " + nonce,
      email: `seller-${nonce}@example.test`,
      password: "market-contact-secret-123",
    },
  })).status()).toBe(201);
  const created = await seller.request.post("/api/market", {
    headers: { origin },
    data: {
      title: "Колесо " + nonce,
      description: "Контакт по запросу",
      category: "components",
      listingType: "sale",
      condition: "used",
      price: 1000,
      currency: "RUB",
      location: "Тестовый город",
      contact: "+7 900 000-00-00",
      status: "active",
    },
  });
  expect(created.status()).toBe(201);
  const listing = await created.json();
  await seller.close();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      "UPDATE market_listings SET published_at=now()-interval '2 days' WHERE id=$1",
      [listing.id],
    );
  } finally {
    await db.end();
  }
  let contacts = 0;
  await page.route((url) => url.pathname === `/api/market/public/${listing.shareId}/contact`, (route) => {
    contacts++;
    return route.fulfill({ json: { contact: "+7 900 000-00-00" } });
  });
  await page.goto("/market/" + listing.shareId);
  const aside = page.locator("aside").filter({ hasText: "Связаться с автором" });
  await expect(aside.getByText("Опубликовано 2 дня назад", { exact: true })).toBeVisible();
  await expect(aside.getByRole("link", { name: "Войти", exact: true })).toHaveAttribute(
    "href", "/login?next=" + encodeURIComponent("/market/" + listing.shareId),
  );
  await expect(aside.getByRole("button", { name: "Показать контакт" })).toHaveCount(0);
  // The guest's HTML never carries the contact itself.
  expect(await page.content()).not.toContain("+7 900 000-00-00");
  expect((await registerVerified(page.request, {
    headers: { origin },
    data: {
      ...testConsents,
      name: "Member " + nonce,
      email: `member-${nonce}@example.test`,
      password: "market-contact-secret-123",
    },
  })).status()).toBe(201);
  await page.reload();
  await aside.getByRole("button", { name: "Показать контакт", exact: true }).click();
  await expect(aside.getByText("+7 900 000-00-00", { exact: true })).toBeVisible();
  expect(contacts).toBe(1);
});
