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

export const marketSorts = Object.freeze({
  new: "Сначала новые",
  price_asc: "Сначала дешевле",
  price_desc: "Сначала дороже",
});

const dayWord = (n) =>
  n % 10 === 1 && n % 100 !== 11
    ? "день"
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? "дня"
      : "дней";
// Calendar days in the viewer's time zone: "сегодня", "вчера", "5 дней назад".
export function publishedLabel(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const day = (d) =>
    Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  const days = day(now) - day(date);
  if (days <= 0) return "Опубликовано сегодня";
  if (days === 1) return "Опубликовано вчера";
  if (days < 30) return `Опубликовано ${days} ${dayWord(days)} назад`;
  return (
    "Опубликовано " +
    date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
}
