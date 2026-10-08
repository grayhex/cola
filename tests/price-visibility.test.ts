import test from "node:test";
import assert from "node:assert/strict";
import {
  chosenPrices,
  priceSummary,
  priceVisibilityKeys,
  pricesFromChoice,
  type PriceVisibility,
} from "../lib/price-visibility.ts";

// #370: the three independent «show the price» settings as one multiple
// choice. All eight combinations are possible and none loses information.
const combinations = Array.from({ length: 8 }, (_, mask) =>
  priceVisibilityKeys.filter((_, bit) => mask & (1 << bit)),
);

test("all eight combinations survive the round trip between booleans and the choice", () => {
  assert.equal(combinations.length, 8);
  for (const chosen of combinations) {
    const value = pricesFromChoice(chosen);
    // Exactly the chosen keys are on, the others are off — never undefined.
    for (const key of priceVisibilityKeys)
      assert.equal(value[key], chosen.includes(key), key);
    assert.deepEqual(chosenPrices(value), chosen);
  }
});

test("the choice does not depend on the order it was made in", () => {
  const forward = pricesFromChoice([
    "show_bike_price",
    "show_accessory_prices",
  ]);
  const backward = pricesFromChoice([
    "show_accessory_prices",
    "show_bike_price",
  ]);
  assert.deepEqual(forward, backward);
  assert.deepEqual(chosenPrices(backward), [
    "show_bike_price",
    "show_accessory_prices",
  ]);
});

test("unknown keys and loose values change nothing", () => {
  const value = pricesFromChoice(["show_bike_price", "is_public", "x"]);
  assert.deepEqual(Object.keys(value).sort(), [...priceVisibilityKeys].sort());
  assert.equal(value.show_bike_price, true);
  // Only a real `true` counts as shown.
  const loose = { show_bike_price: 1, show_component_prices: "yes" };
  assert.deepEqual(
    chosenPrices(loose as unknown as Partial<PriceVisibility>),
    [],
  );
});

test("the summary names what is shown: nothing, one, two, or everything", () => {
  const lines = combinations.map(priceSummary);
  assert.deepEqual(lines, [
    "Не показывать",
    "Велосипед",
    "Компоненты",
    "Велосипед, компоненты",
    "Аксессуары",
    "Велосипед, аксессуары",
    "Компоненты, аксессуары",
    "Все цены",
  ]);
  // Eight combinations, eight different lines.
  assert.equal(new Set(lines).size, 8);
});
