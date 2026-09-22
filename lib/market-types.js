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
  return Number(listing.price).toLocaleString("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 2,
  });
}
