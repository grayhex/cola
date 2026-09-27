import { factoryEntries } from "./factory-components.js";

// Server-owned snapshots in the already stored specification; no legacy migration.
// A later edit/removal of any installation cannot be undone by the rebuild.
export function factorySnapshot(c) {
  return {
    section: c.section,
    category: c.category,
    name: c.name,
    notes: c.notes || "",
    price: c.price == null ? null : Number(c.price),
    url: c.url || "",
    group_id: c.group_id || "",
  };
}
export function sameFactoryPart(a, b) {
  return (
    JSON.stringify(factorySnapshot(a)) === JSON.stringify(factorySnapshot(b))
  );
}
export function factoryOrigins(spec, parts) {
  const entries = factoryEntries(spec);
  return parts
    .flatMap((part) => {
      const matches = entries.filter((e) =>
        sameFactoryPart(part, { ...e.value, group_id: part.group_id }),
      );
      if (matches.length !== 1) return [];
      return [
        {
          id: part.id,
          source: matches[0].source,
          snapshot: factorySnapshot(part),
        },
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function assignFactoryBrand(q, id, brand) {
  if (!brand) return;
  await q.query(
    `UPDATE component_models m SET brand=$2 WHERE m.id=(SELECT model_id FROM components WHERE id=$1)
    AND m.version=1 AND m.merged_into IS NULL AND m.brand=''`,
    [id, brand],
  );
}
