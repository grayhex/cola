import type { Queryable } from "./db.ts";
import { db } from "./db.ts";
import { getSite } from "./site.ts";

// Only independently published editorial entries augment every page's picker.
// An ordinary installation name must not escape a bike's visibility through
// the shared page bootstrap, even if its retained catalog URL still exists.
export const seededPickerModel = `EXISTS(SELECT 1 FROM component_seed_entries e
  JOIN component_seed_batches batch ON batch.batch=e.batch
  JOIN component_models original ON original.id=e.model_id
  WHERE coalesce(original.merged_into,original.id)=m.id
    AND e.state IN ('created','filled','reused') AND e.rolled_back_at IS NULL
    AND batch.rolled_back_at IS NULL)`;

/** Seeded public model names augment options, never editable site settings. */
export async function getPublicSite(q: Queryable = db) {
  const site = await getSite(q);
  const rows = (
    await q.query<{
      category: string;
      name: string;
    }>(`SELECT m.category,m.name FROM component_models m
    WHERE m.first_public_at IS NOT NULL AND NOT m.archived AND m.merged_into IS NULL
      AND ${seededPickerModel}
    ORDER BY m.category,m.name LIMIT 2000`)
  ).rows;
  const parts = { ...site.catalog.parts };
  for (const row of rows)
    parts[row.category] = [
      ...new Set([...(parts[row.category] || []), row.name]),
    ];
  return { ...site, catalog: { ...site.catalog, parts } };
}
