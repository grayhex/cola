import type { FactorySnapshot, FactoryOrigin } from "./database-rows.ts";
export type SnapshotSource = Omit<
  FactorySnapshot,
  "price" | "notes" | "url" | "group_id"
> & {
  price?: string | number | null;
  notes?: string;
  url?: string;
  group_id?: string;
};
import type { Resolved } from "../services/bike-resolver/src/domain.ts";
import type { Queryable } from "./db.ts";
import { factoryEntries } from "./factory-components.ts";

// Server-owned snapshots in the already stored specification; no legacy migration.
// A later edit/removal of any installation cannot be undone by the rebuild.
export function factorySnapshot(c: SnapshotSource): FactorySnapshot {
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
export function sameFactoryPart(a: SnapshotSource, b: SnapshotSource) {
  return (
    JSON.stringify(factorySnapshot(a)) === JSON.stringify(factorySnapshot(b))
  );
}
export function factoryOrigins(
  spec: Resolved,
  parts: (SnapshotSource & { id: string })[],
): FactoryOrigin[] {
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
    .sort((a: { id: string }, b) => a.id.localeCompare(b.id));
}
export async function assignFactoryBrand(
  q: Queryable,
  id: string,
  brand: unknown,
) {
  if (!brand) return;
  await q.query(
    `UPDATE component_models m SET brand=$2 WHERE m.id=(SELECT model_id FROM components WHERE id=$1)
    AND m.version=1 AND m.merged_into IS NULL AND m.brand=''`,
    [id, brand],
  );
}
