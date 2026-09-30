import type { JsonData } from "./contracts.ts";
import type { Queryable } from "./db.ts";
// Landing pages of owner experience for a model and for a part (#74): the
// same public data and spelling rules as /experience, one server-rendered
// page per canonical name, indexed once there is enough to read.
import { getSite } from "./site.ts";
import { componentModelAtPath, componentCounts } from "./component-catalog.ts";
import { bikeModelAtPath, bikeModelCounts } from "./bike-catalog.ts";
import { classificationLabels } from "./bike-classification.ts";
import { journalFrom, journalPublic } from "./journal.ts";
import {
  experienceHref,
  modelLandingPath,
  partLandingPath,
} from "./experience-catalog.ts";
import {
  experienceFilter,
  experienceRules,
  searchExperience,
  searchInput,
} from "./search.ts";

// Public builds a page needs before search engines see it; below that the
// page still opens for people but stays `noindex` and out of the sitemap.
export const landingMinimum = 3;

const publicBikes = " FROM bikes b JOIN users u ON u.id=b.owner_id";
const publicParts =
  " FROM components p JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id";
const visible = " WHERE b.is_public AND NOT u.blocked";
const plain = <T>(rows: T): JsonData<T> => JSON.parse(JSON.stringify(rows));

/** A model page: the public builds of one brand and model, their parts,
journal entries and rides. A once-public model survives its last build. */
export async function modelLanding(
  q: Queryable,
  viewer: string | null,
  brandRef: string,
  modelRef: string,
) {
  const { catalog } = await getSite(q);
  const model = await bikeModelAtPath(q, brandRef, modelRef);
  if (!model) return null;
  const input = searchInput.parse({ bikeModelId: model.id, exact: "1" });
  const params: unknown[] = [];
  const filter = experienceFilter(catalog, input, params),
    where = visible + filter;
  const summary = (
    await q.query<{
      builds: number;
      brand: string | null;
      model: string | null;
      first_year: number | null;
      last_year: number | null;
      weight: number | null;
      updated_at: Date | null;
    }>(
      `SELECT count(*)::int builds,
        mode() WITHIN GROUP (ORDER BY b.brand) brand,
        mode() WITHIN GROUP (ORDER BY b.model) model,
        min(nullif(b.year,0)) first_year, max(nullif(b.year,0)) last_year,
        round(avg(nullif(b.weight,0))::numeric,1)::float weight,
        max(b.updated_at) updated_at` +
        publicBikes +
        where,
      params,
    )
  ).rows[0];
  // Bike types by their main label, as on the cards.
  const types = new Map<string, number>();
  for (const row of (
    await q.query<{
      category: string;
      family: string | null;
      subtype: string | null;
      builds: number;
    }>(
      `SELECT b.category, b.classification->>'category' family,
        b.classification->>'subtype' subtype, count(*)::int builds` +
        publicBikes +
        where +
        " GROUP BY 1,2,3",
      params,
    )
  ).rows) {
    const [label] = classificationLabels({
      category: row.category,
      classification: row.family
        ? {
            category: row.family,
            subtype: row.subtype,
          }
        : null,
    });
    if (label) types.set(label, (types.get(label) || 0) + row.builds);
  }
  const parts = (
    await q.query<{
      id: string;
      category: string;
      name: string;
      category_slug: string;
      slug: string;
      builds: number;
    }>(
      `SELECT m.id,m.category,m.name,m.category_slug,m.slug,count(DISTINCT b.id)::int builds` +
        publicParts +
        " JOIN component_models source ON source.id=p.model_id JOIN component_models m ON m.id=coalesce(source.merged_into,source.id)" +
        where +
        ` AND p.section='build' GROUP BY m.id HAVING count(DISTINCT b.id)>=2
        ORDER BY builds DESC,m.id LIMIT 8`,
      params,
    )
  ).rows;
  // What owners fitted, from their public «Сборка / апгрейд» entries: the
  // parts captured with each entry.
  const installParams = [...params];
  const installRules = experienceRules(catalog, "component", (value) => {
    installParams.push(value);
    return "$" + installParams.length;
  });
  const installs = (
    await q.query<{ category: string; name: string; entries: number }>(
      `SELECT mode() WITHIN GROUP (ORDER BY p.category) category,
        mode() WITHIN GROUP (ORDER BY p.name) name, count(DISTINCT e.id)::int entries` +
        journalFrom +
        " CROSS JOIN LATERAL jsonb_to_recordset(e.components) AS p(name text,category text)" +
        " WHERE " +
        journalPublic +
        filter +
        ` AND e.kind='build' AND experience_normalize(p.name)<>''
        AND experience_normalize(p.category)<>''
        GROUP BY experience_normalize(p.category), experience_canonical(p.name,${installRules})
        ORDER BY entries DESC, category, name LIMIT 6`,
      installParams,
    )
  ).rows;
  const rides = (
    await q.query<{ rides: number; distance: number }>(
      `SELECT count(*)::int rides, coalesce(sum(r.distance_m),0)::float distance
        FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=b.owner_id` +
        where +
        " AND r.is_public AND r.status='completed'",
      params,
    )
  ).rows[0];
  const [bikes, entries] = await Promise.all([
    searchExperience(q, viewer, { ...input, type: "bikes" }),
    searchExperience(q, viewer, { ...input, type: "journal" }),
  ]);
  return plain({
    kind: "model" as const,
    id: model.id,
    title: `${model.brand} ${model.name}`,
    brand: model.brand,
    brandSlug: model.brand_slug,
    slug: model.slug,
    model: model.name,
    path: modelLandingPath(model.brand_slug, model.slug),
    search: `/experience?${new URLSearchParams({ bikeModelId: model.id, brand: model.brand, model: model.name, exact: "1" })}`,
    indexed: !model.archived && summary.builds >= landingMinimum,
    builds: summary.builds,
    years: [summary.first_year, summary.last_year].filter(Boolean),
    types: [...types]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .slice(0, 3)
      .map(([label, builds]) => ({ label, builds })),
    weight: summary.weight,
    updatedAt: summary.updated_at || model.updated_at,
    parts: parts.map((p) => ({
      ...p,
      path: partLandingPath(p.category_slug, p.slug),
    })),
    // Installation stories live in the journal, so the link opens them there.
    installs: installs.map((p) => ({
      ...p,
      search:
        experienceHref({ component: p.name, componentCategory: p.category }) +
        "&type=journal",
    })),
    rides: rides.rides,
    distanceKm: Math.round(rides.distance / 1000),
    bikes: bikes.items.slice(0, 12),
    entries: entries.items.slice(0, 6),
    entryCount: entries.total,
  });
}

/** A durable catalog page, including when the last public installation is gone. */
export async function partLanding(
  q: Queryable,
  viewer: string | null | undefined,
  categoryRef: string,
  nameRef: string,
) {
  const model = await componentModelAtPath(q, categoryRef, nameRef);
  if (!model) return null;
  const input = searchInput.parse({ componentModelId: model.id, exact: "1" });
  const params = [model.id];
  const match =
    visible +
    " AND p.model_id IN (SELECT id FROM component_models WHERE coalesce(merged_into,id)=$1)";
  const summary = (
    await q.query<{ builds: number; updated_at: Date }>(
      "SELECT count(DISTINCT b.id)::int builds,max(b.updated_at) updated_at" +
        publicParts +
        match,
      params,
    )
  ).rows[0];
  const models = (
    await q.query<{
      brand: string;
      model: string;
      brand_slug: string;
      slug: string;
      builds: number;
    }>(
      `SELECT m.brand,m.name model,m.brand_slug,m.slug,count(DISTINCT b.id)::int builds${publicParts}
    JOIN bike_models source ON source.id=b.catalog_model_id JOIN bike_models m ON m.id=coalesce(source.merged_into,source.id)
    ${match} GROUP BY m.id ORDER BY builds DESC,m.id LIMIT 8`,
      params,
    )
  ).rows;
  const [bikes, entries] = await Promise.all([
    searchExperience(q, viewer, { ...input, type: "bikes" }),
    searchExperience(q, viewer, { ...input, type: "journal" }),
  ]);
  return plain({
    kind: "part" as const,
    id: model.id,
    title: model.name,
    category: model.category,
    brand: model.brand,
    name: model.name,
    // The page's description and what an administrator's edit needs (#264).
    description: model.description || "",
    archived: model.archived,
    version: model.version,
    categorySlug: model.category_slug,
    slug: model.slug,
    path: partLandingPath(model.category_slug, model.slug),
    search: `/experience?${new URLSearchParams({ componentModelId: model.id, component: model.name, exact: "1" })}`,
    indexed: !model.archived && summary.builds >= landingMinimum,
    builds: summary.builds,
    updatedAt: summary.updated_at || model.updated_at,
    models: models.map((m) => ({
      brand: m.brand,
      model: m.model,
      builds: m.builds,
      path: modelLandingPath(m.brand_slug, m.slug),
    })),
    bikes: bikes.items.slice(0, 12),
    entries: entries.items.slice(0, 6),
    entryCount: entries.total,
  });
}

/** Landing pages worth a search engine's visit: models and parts with at
least `landingMinimum` public builds, newest changes first. */
export async function landingSitemap(
  q: Queryable,
  limit: {
    model: number;
    part: number;
  },
) {
  const models = (
    await q.query<{ brand_slug: string; slug: string; updated_at: Date }>(
      `WITH counts AS (${bikeModelCounts})
    SELECT m.brand_slug,m.slug,greatest(m.updated_at,c.updated_at) updated_at FROM bike_models m JOIN counts c ON c.model_id=m.id
    WHERE NOT m.archived AND c.builds>=$1 ORDER BY updated_at DESC,m.id LIMIT $2`,
      [landingMinimum, limit.model],
    )
  ).rows;
  const parts = (
    await q.query<{ category_slug: string; slug: string; updated_at: Date }>(
      `WITH counts AS (${componentCounts})
    SELECT m.category_slug,m.slug,greatest(m.updated_at,c.updated_at) updated_at FROM component_models m JOIN counts c ON c.model_id=m.id
    WHERE NOT m.archived AND c.builds>=$1 ORDER BY updated_at DESC,m.id LIMIT $2`,
      [landingMinimum, limit.part],
    )
  ).rows;
  return [
    ...models.map((m) => ({
      path: modelLandingPath(m.brand_slug, m.slug),
      updatedAt: m.updated_at,
    })),
    ...parts.map((p) => ({
      path: partLandingPath(p.category_slug, p.slug),
      updatedAt: p.updated_at,
    })),
  ];
}
