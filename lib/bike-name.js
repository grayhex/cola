// Deterministic convenience parser; trim tokens remain in model, never guessed away.
export function parseBikeName(name, brands) {
  const value = name.trim().replace(/\s+/g, " ");
  const brand = [...brands]
    .sort((a, b) => b.length - a.length)
    .find((b) => value.toLowerCase().startsWith(b.toLowerCase() + " "));
  if (!brand) return null;
  const rest = value.slice(brand.length).trim(),
    year = rest.match(/\b((?:19|20)\d{2})$/);
  const model = (year ? rest.slice(0, year.index) : rest).trim();
  if (!model) return null;
  return { brand, model, trim: "", ...(year ? { year: Number(year[1]) } : {}) };
}
