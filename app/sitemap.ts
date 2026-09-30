import { db } from "../lib/db.ts";
import { sitemapEntries } from "../lib/indexing.ts";
export const dynamic = "force-dynamic";
export default function sitemap() {
  return sitemapEntries(db);
}
