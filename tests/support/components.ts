import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";
import type { ComponentPhotoRow } from "../../lib/database-rows.ts";
import { given, insertRow, type Columns } from "./rows.ts";

/**
 * A photo of a catalog model by `authorId`: 800 × 600, shown, no caption.
 * `overrides` are columns of `component_photos`.
 */
export function componentPhotoRow(
  q: Queryable,
  modelId: string,
  authorId: string,
  overrides: Columns<ComponentPhotoRow> = {},
): Promise<ComponentPhotoRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<ComponentPhotoRow>(q, "component_photos", {
    id,
    model_id: modelId,
    author_id: authorId,
    filename: id + ".webp",
    size_bytes: 1000,
    width: 800,
    height: 600,
    ...given(overrides),
  });
}
