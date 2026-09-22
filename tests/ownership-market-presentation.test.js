import test from "node:test";
import assert from "node:assert/strict";
import { isFormerBike, rideBikeStateError, selectableRideBikes } from "../lib/bike-status.js";
import { listingTypes, listingPriceLabel } from "../lib/market-types.js";
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
  const state = { own: true, category: "components", listingType: "wanted", condition: "used", query: "Колесо & рама + 29%", page: 2 };
  assert.deepEqual(readMarketQuery(new URLSearchParams(writeMarketQuery(state))), state);
  assert.deepEqual(readMarketQuery(new URLSearchParams("category=constructor&type=__proto__&condition=bad&page=-1")), {
    own: false, category: "", listingType: "", condition: "", query: "", page: 1,
  });
  assert.equal(readMarketQuery(new URLSearchParams("page=1.5")).page, 1);
  assert.equal(readMarketQuery(new URLSearchParams("page=Infinity")).page, 1);
  assert.equal(readMarketQuery(new URLSearchParams({ q: "x".repeat(150) })).query.length, 100);
  assert.equal(writeMarketQuery({ own: false, category: "", listingType: "", condition: "", query: "", page: 1 }), "");
});
