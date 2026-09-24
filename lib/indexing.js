import { absolutePublicUrl, publicPath } from "./public-urls.js";

// Search engines index a page only when it opts in (#74). The root layout
// marks every page `hidden`; catalogs and public entities override it with
// `indexed`, so a new or personal page stays out of search by default.
export const indexed = Object.freeze({ index: true, follow: true });
export const hidden = Object.freeze({ index: false, follow: false });

// Personal sections are closed with the robots meta tag, not here: a crawler
// has to fetch a page to see its noindex. Only the API is off limits, except
// public media and preview cards (the longest matching rule wins).
export function crawlRules(env = process.env) {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/api/photos/",
        "/api/avatars/",
        "/api/assets/",
        "/api/journal/media/",
        "/api/market/media/",
        "/api/social-preview/",
      ],
      disallow: ["/api/"],
    },
    sitemap: absolutePublicUrl("/sitemap.xml", env),
  };
}

export const indexedSections = [
  "/",
  "/bikes",
  "/journal",
  "/articles",
  "/rides",
  "/market",
  "/records",
  "/about",
];
// A sitemap holds at most 50 000 addresses. These caps keep the total below
// that; the newest changes go first when a kind outgrows its cap.
const cap = { bike: 12000, journal: 12000, ride: 10000, market: 6000, profile: 5000, article: 4000 };

// Only what a guest can open. The public_entity_links view owns the
// visibility contract; the tables add the time of the last change.
export async function sitemapEntries(q, env = process.env) {
  const rows = (sql, limit) => q.query(sql, limit ? [limit] : []).then((r) => r.rows);
  const linked = (kind, table, extra = "") =>
    rows(
      `SELECT l.public_id,l.slug,t.updated_at FROM public_entity_links l
       JOIN ${table} t ON t.id=l.entity_id
       WHERE l.kind='${kind}' AND l.is_public${extra}
       ORDER BY t.updated_at DESC,l.public_id LIMIT $1`,
      cap[kind],
    );
  const [bikes, entries, rides, listings, profiles, articles, legal] =
    await Promise.all([
      linked("bike", "bikes"),
      linked("journal", "journal_entries"),
      linked("ride", "rides"),
      // A closed listing still opens, but only active ones are worth a visit.
      linked("market", "market_listings", " AND t.status='active'"),
      // Profiles with something public to show: a bike (entries and rides
      // need one too) or an article.
      rows(
        `SELECT l.slug,max(x.updated_at) updated_at FROM public_entity_links l
         JOIN (SELECT owner_id,updated_at FROM bikes WHERE is_public
           UNION ALL SELECT owner_id,updated_at FROM journal_entries
           WHERE kind='article' AND status='published' AND is_public) x
         ON x.owner_id=l.entity_id
         WHERE l.kind='profile' GROUP BY l.slug
         ORDER BY 2 DESC,l.slug LIMIT $1`,
        cap.profile,
      ),
      rows(
        `SELECT e.share_id,e.updated_at FROM journal_entries e
         JOIN users u ON u.id=e.owner_id
         WHERE e.kind='article' AND e.status='published' AND e.is_public
         AND NOT u.blocked ORDER BY e.updated_at DESC,e.share_id LIMIT $1`,
        cap.article,
      ),
      rows(
        `SELECT v.kind,v.published_at FROM legal_documents d
         JOIN legal_document_versions v ON v.kind=d.kind
         AND v.revision=d.published_revision`,
      ),
    ]);
  const entry = (path, lastModified) => ({
    url: absolutePublicUrl(path, env),
    ...(lastModified && { lastModified: new Date(lastModified) }),
  });
  return [
    ...indexedSections.map((path) => entry(path)),
    ...legal.map((d) => entry("/legal/" + d.kind, d.published_at)),
    ...bikes.map((r) => entry(publicPath("bike", r), r.updated_at)),
    ...entries.map((r) => entry(publicPath("journal", r), r.updated_at)),
    ...rides.map((r) => entry(publicPath("ride", r), r.updated_at)),
    ...listings.map((r) => entry(publicPath("market", r), r.updated_at)),
    ...profiles.map((r) => entry(publicPath("profile", r), r.updated_at)),
    ...articles.map((r) => entry("/articles/" + r.share_id, r.updated_at)),
  ];
}
