import type { Queryable } from "./db.ts";
import { db } from "./db.ts";
import { getSite } from "./site.ts";

/** Public model names augment picker options, never the editable site settings. */
export async function getPublicSite(q: Queryable = db) {
  const site = await getSite(q);
  const rows = (
    await q.query<{
      category: string;
      name: string;
    }>(`SELECT category,name FROM component_models
    WHERE first_public_at IS NOT NULL AND NOT archived AND merged_into IS NULL
    ORDER BY category,name LIMIT 2000`)
  ).rows;
  const parts = { ...site.catalog.parts };
  for (const row of rows)
    parts[row.category] = [
      ...new Set([...(parts[row.category] || []), row.name]),
    ];
  return { ...site, catalog: { ...site.catalog, parts } };
}
