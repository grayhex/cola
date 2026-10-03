// Files of the site media library, stored as an upload stores them: the
// browser reads them at /api/assets/<id>, the app settings (#338) name them.
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";
import type { SiteAssetRow } from "../../lib/database-rows.ts";
import { given, insertRow, type Columns } from "./rows.ts";

/**
 * A stored asset: a raster file (`site-<id>.webp`) unless `overrides` name
 * another one. `overrides` are columns of `site_assets`.
 */
export async function siteAssetRow(
  q: Queryable,
  overrides: Columns<SiteAssetRow> = {},
): Promise<SiteAssetRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<SiteAssetRow>(q, "site_assets", {
    id,
    name: "Файл " + id.slice(0, 8),
    filename: `site-${id}.webp`,
    ...given(overrides),
  });
}
