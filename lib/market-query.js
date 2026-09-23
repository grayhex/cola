import { listingTypes, marketSorts } from "./market-types.js";
export const marketCategories = Object.freeze({
  bikes: "Велосипеды", components: "Комплектующие", accessories: "Аксессуары",
});
export function readMarketQuery(params) {
  const page = Number(params.get("page") || 1);
  return {
    own: params.get("own") === "1",
    category: Object.hasOwn(marketCategories, params.get("category")) ? params.get("category") : "",
    listingType: Object.hasOwn(listingTypes, params.get("type")) ? params.get("type") : "",
    condition: ["new", "used"].includes(params.get("condition")) ? params.get("condition") : "",
    query: (params.get("q") || "").trim().slice(0, 100),
    priceMin: price(params.get("price_min")),
    priceMax: price(params.get("price_max")),
    city: (params.get("city") || "").trim().slice(0, 100),
    sort: Object.hasOwn(marketSorts, params.get("sort")) ? params.get("sort") : "new",
    page: Number.isInteger(page) && page > 0 && page <= 10000 ? page : 1,
  };
}
// Whole rubles only; anything else means "no bound".
const price = (value) => (/^\d{1,10}$/.test(value || "") ? Number(value) : "");
export function writeMarketQuery(value) {
  const params = new URLSearchParams();
  if (value.own) params.set("own", "1");
  if (value.category) params.set("category", value.category);
  if (value.listingType) params.set("type", value.listingType);
  if (value.condition) params.set("condition", value.condition);
  if (value.query) params.set("q", value.query);
  if (value.priceMin !== "" && value.priceMin != null) params.set("price_min", String(value.priceMin));
  if (value.priceMax !== "" && value.priceMax != null) params.set("price_max", String(value.priceMax));
  if (value.city) params.set("city", value.city);
  if (value.sort && value.sort !== "new") params.set("sort", value.sort);
  if (value.page > 1) params.set("page", String(value.page));
  return params.toString();
}
