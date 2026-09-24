import { db } from "../lib/db.js";
import { sitemapEntries } from "../lib/indexing.js";
export const dynamic = "force-dynamic";
export default function sitemap() {
  return sitemapEntries(db);
}
