import { test, expect } from "@playwright/test";

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
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: null } }));
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
  await panel.getByLabel("Тип объявления", { exact: true }).selectOption("sale");
  await panel.getByLabel("Состояние", { exact: true }).selectOption("used");
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
  await expect(panel.getByLabel("Тип объявления", { exact: true })).toHaveValue("sale");
  await expect(panel.getByLabel("Состояние", { exact: true })).toHaveValue("used");
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
