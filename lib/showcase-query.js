export function readShowcaseQuery(params, categories = {}) {
  return {
    sort: ["new", "popular", "records"].includes(params.get("sort"))
      ? params.get("sort")
      : "new",
    page: Math.max(
      1,
      Math.min(100000, Number.parseInt(params.get("page"), 10) || 1),
    ),
    query: (params.get("q") || "").slice(0, 150),
    filters: [...new Set((params.get("category") || "").split(","))].filter(
      (key) => Object.hasOwn(categories, key),
    ),
  };
}
export function writeShowcaseQuery(params, patch) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    const name = { filters: "category", query: "q" }[key] || key;
    const text = Array.isArray(value) ? value.join(",") : String(value);
    if (
      !text ||
      (key === "page" && text === "1") ||
      (key === "sort" && text === "new")
    )
      next.delete(name);
    else next.set(name, text);
  }
  return next.toString();
}
