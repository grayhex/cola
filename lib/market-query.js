import { listingTypes } from "./market-types.js";
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
    page: Number.isInteger(page) && page > 0 && page <= 10000 ? page : 1,
  };
}
export function writeMarketQuery(value) {
  const params = new URLSearchParams();
  if (value.own) params.set("own", "1");
  if (value.category) params.set("category", value.category);
  if (value.listingType) params.set("type", value.listingType);
  if (value.condition) params.set("condition", value.condition);
  if (value.query) params.set("q", value.query);
  if (value.page > 1) params.set("page", String(value.page));
  return params.toString();
}
