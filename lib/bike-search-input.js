// A deterministic convenience parser, not a source of manufacturing facts.
// Missing year stays null; unresolved models remain verbatim for the resolver.
export function parseBikeSearch(text, models = {}) {
  let value = String(text || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!value || value.length > 240) return null;
  const years = [...value.matchAll(/\b(?:19|20|21)\d{2}\b/g)];
  if (years.length > 1) return null;
  const year = years.length ? Number(years[0][0]) : null;
  if (year && (year < 1900 || year > 2100)) return null;
  value = value.replace(/\b(?:19|20|21)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  const brands = [...new Set(Object.values(models).flatMap((group) => Object.keys(group)))].sort((a,b) => b.length-a.length);
  const known = brands.find((brand) => value.toLocaleLowerCase().startsWith(brand.toLocaleLowerCase() + " "));
  const brand = known || value.split(" ")[0];
  const rest = value.slice(brand.length).trim();
  if (!brand || !rest || brand.length > 60) return null;
  const names = [...new Set(Object.values(models).flatMap((group) => group[brand] || []))].sort((a,b) => b.length-a.length);
  const model = names.find((name) => rest.toLocaleLowerCase() === name.toLocaleLowerCase() || rest.toLocaleLowerCase().startsWith(name.toLocaleLowerCase() + " ")) || rest;
  const trim = model === rest ? null : rest.slice(model.length).trim() || null;
  if (model.length > 100 || (trim && trim.length > 100)) return null;
  return { brand, model, trim, year };
}
