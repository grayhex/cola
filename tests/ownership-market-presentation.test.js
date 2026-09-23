import test from "node:test";
import assert from "node:assert/strict";
import { isFormerBike, rideBikeStateError, selectableRideBikes } from "../lib/bike-status.js";
import { listingTypes, listingPriceLabel, publishedLabel } from "../lib/market-types.js";
import { readMarketQuery, writeMarketQuery } from "../lib/market-query.js";

test("former bikes are not new ride targets but their existing history remains editable", () => {
  const active = { id: "current", is_former: false };
  const former = { id: "old", is_former: true };
  assert.equal(isFormerBike({}), false);
  assert.equal(isFormerBike(former), true);
  assert.equal(rideBikeStateError(active), null);
  assert.match(rideBikeStateError(former), /бывшего велосипеда/);
  assert.match(rideBikeStateError(former, { bike_id: active.id, is_public: true }), /бывшего/);
  assert.equal(rideBikeStateError(former, { bike_id: former.id, is_public: true }, true), null);
  assert.equal(rideBikeStateError(former, { bike_id: former.id, is_public: true }, false), null);
  assert.equal(rideBikeStateError(former, { bike_id: former.id, is_public: false }, false), null);
  assert.match(rideBikeStateError(former, { bike_id: former.id, is_public: false }, true), /публиковать/);
  assert.deepEqual(selectableRideBikes([former, active]), [active]);
  assert.deepEqual(selectableRideBikes([former, active], former.id), [former, active]);
  assert.deepEqual(selectableRideBikes([former], "not-owned"), []);
});

test("market labels distinguish intent, optional prices and historical foreign currencies", () => {
  assert.deepEqual(Object.keys(listingTypes), ["sale", "wanted", "exchange", "free"]);
  assert.equal(listingPriceLabel({ listingType: "free", price: 0, currency: "RUB" }), "Бесплатно");
  assert.equal(listingPriceLabel({ listingType: "exchange", price: null }), "Обмен");
  assert.equal(listingPriceLabel({ listingType: "wanted", price: null }), "Бюджет не указан");
  assert.equal(listingPriceLabel({ listingType: "sale", price: null }), "Цена по договорённости");
  assert.match(listingPriceLabel({ price: 12345, currency: "RUB" }), /₽/);
  for (const currency of ["USD", "EUR"]) {
    const label = listingPriceLabel({ price: 100, currency });
    assert.match(label, /уточнения/);
    assert.doesNotMatch(label, /100|₽/);
  }
});

test("market URL restores combined filters, pagination and literal search", () => {
  const state = {
    own: true, category: "components", listingType: "wanted", condition: "used", query: "Колесо & рама + 29%",
    priceMin: 0, priceMax: 150000, city: "Санкт-Петербург", sort: "price_asc", page: 2,
  };
  assert.deepEqual(readMarketQuery(new URLSearchParams(writeMarketQuery(state))), state);
  assert.deepEqual(readMarketQuery(new URLSearchParams(
    "category=constructor&type=__proto__&condition=bad&page=-1&price_min=-5&price_max=1e3&sort=__proto__",
  )), {
    own: false, category: "", listingType: "", condition: "", query: "", priceMin: "", priceMax: "", city: "", sort: "new", page: 1,
  });
  assert.equal(readMarketQuery(new URLSearchParams("page=1.5")).page, 1);
  assert.equal(readMarketQuery(new URLSearchParams("page=Infinity")).page, 1);
  assert.equal(readMarketQuery(new URLSearchParams({ q: "x".repeat(150) })).query.length, 100);
  assert.equal(writeMarketQuery({ own: false, category: "", listingType: "", condition: "", query: "", page: 1 }), "");
  assert.equal(writeMarketQuery({ priceMin: "", priceMax: "", city: "", sort: "new", page: 1 }), "");
});

test("market publication dates read as calendar days in Russian", () => {
  const now = new Date(2026, 8, 23, 10, 0);
  assert.equal(publishedLabel(new Date(2026, 8, 23, 0, 5), now), "Опубликовано сегодня");
  assert.equal(publishedLabel(new Date(2026, 8, 22, 23, 50), now), "Опубликовано вчера");
  assert.equal(publishedLabel(new Date(2026, 8, 21, 12), now), "Опубликовано 2 дня назад");
  assert.equal(publishedLabel(new Date(2026, 8, 18, 12), now), "Опубликовано 5 дней назад");
  assert.equal(publishedLabel(new Date(2026, 8, 12, 12), now), "Опубликовано 11 дней назад");
  assert.equal(publishedLabel(new Date(2026, 8, 2, 12), now), "Опубликовано 21 день назад");
  assert.match(publishedLabel(new Date(2026, 5, 1, 12), now), /^Опубликовано 1 июня 2026/);
  assert.equal(publishedLabel(null, now), "");
  assert.equal(publishedLabel("not a date", now), "");
});
