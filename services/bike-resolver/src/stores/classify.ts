import { load } from "cheerio";
import { jsonObjects } from "../extract.js";
import { ResolverError, type SourceDocument } from "../domain.js";

// Breadcrumb names from inert JSON-LD, outermost first.
export function breadcrumbNames(doc: SourceDocument): string[] {
  const $ = load(doc.body);
  for (const object of jsonObjects($)) {
    if (object["@type"] !== "BreadcrumbList") continue;
    const items = object.itemListElement;
    if (!Array.isArray(items)) continue;
    return items.flatMap((item: unknown) => {
      const name =
        item !== null && typeof item === "object" && "name" in item
          ? item.name
          : undefined;
      return typeof name === "string" ? [name.replace(/\s+/g, " ").trim()] : [];
    });
  }
  return [];
}
// A frame, part or accessory page often lists three or more "components", so
// quality thresholds cannot tell it from a bicycle: the store must say so.
export const notCompleteBike = () =>
  new ResolverError(
    "parse_error",
    "Page is not a complete bicycle",
    false,
    "not_complete_bike",
  );
