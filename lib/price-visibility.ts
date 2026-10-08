// The three «show the price» settings of a bike (#370) as one choice of
// several: they stay independent (eight combinations), and a combination is
// only a view of three booleans — changing it removes no price and does not
// touch the bike's privacy.
export const priceVisibilityKeys = [
  "show_bike_price",
  "show_component_prices",
  "show_accessory_prices",
] as const;
export type PriceVisibilityKey = (typeof priceVisibilityKeys)[number];
export type PriceVisibility = Record<PriceVisibilityKey, boolean>;

export const priceVisibilityLabels: Record<PriceVisibilityKey, string> = {
  show_bike_price: "Стоимость велосипеда",
  show_component_prices: "Стоимость компонентов",
  show_accessory_prices: "Стоимость аксессуаров",
};
const shortLabels: Record<PriceVisibilityKey, string> = {
  show_bike_price: "велосипед",
  show_component_prices: "компоненты",
  show_accessory_prices: "аксессуары",
};

/** The chosen keys, in the fixed order of the options. */
export function chosenPrices(value: Partial<PriceVisibility>) {
  return priceVisibilityKeys.filter((key) => value[key] === true);
}
/** Three booleans from a list of chosen keys; unknown keys are ignored. */
export function pricesFromChoice(chosen: readonly string[]): PriceVisibility {
  return {
    show_bike_price: chosen.includes("show_bike_price"),
    show_component_prices: chosen.includes("show_component_prices"),
    show_accessory_prices: chosen.includes("show_accessory_prices"),
  };
}
/** The short line a closed control shows: nothing, all, or what is chosen. */
export function priceSummary(chosen: readonly PriceVisibilityKey[]) {
  if (!chosen.length) return "Не показывать";
  if (chosen.length === priceVisibilityKeys.length) return "Все цены";
  const words = priceVisibilityKeys
    .filter((key) => chosen.includes(key))
    .map((key) => shortLabels[key]);
  const line = words.join(", ");
  return line[0].toLocaleUpperCase("ru") + line.slice(1);
}
