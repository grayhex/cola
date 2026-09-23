export const listingTypes = Object.freeze({
  sale: "Продам",
  wanted: "Куплю",
  exchange: "Обмен",
  free: "Отдам даром",
});
export const listingTypeKeys = Object.keys(listingTypes);

export function listingPriceLabel(listing) {
  if (listing.currency && listing.currency !== "RUB")
    return "Цена требует уточнения в рублях";
  if (listing.listingType === "free") return "Бесплатно";
  if (listing.price == null || listing.price === "") {
    if (listing.listingType === "exchange") return "Обмен";
    if (listing.listingType === "wanted") return "Бюджет не указан";
    return "Цена по договорённости";
  }
  return formatRubles(listing.price);
}

// Whole amounts omit kopecks (35 000 ₽); fractional amounts keep two digits.
export function formatRubles(value) {
  const amount = Number(value);
  const digits = Number.isInteger(amount) ? 0 : 2;
  return amount.toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
