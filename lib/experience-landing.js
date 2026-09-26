// Landing pages of owner experience for a model and for a part (#74): the
// same public data and spelling rules as /experience, one server-rendered
// page per canonical name, indexed once there is enough to read.
import { getSite } from "./site.js";
import { componentModelAtPath, componentCounts } from "./component-catalog.js";
import { classificationLabels } from "./bike-classification.js";
import { journalFrom, journalPublic } from "./journal.js";
import {
  experienceHref,
  landingSlug,
  modelLandingPath,
  partLandingPath,
} from "./experience-catalog.js";
import {
  experienceFilter,
  experienceRules,
  searchExperience,
  searchInput,
} from "./search.js";

// Public builds a page needs before search engines see it; below that the
// page still opens for people but stays `noindex` and out of the sitemap.
export const landingMinimum = 3;

const publicBikes = " FROM bikes b JOIN users u ON u.id=b.owner_id";
const publicParts =
  " FROM components p JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id";
const visible = " WHERE b.is_public AND NOT u.blocked";
const plain = (rows) => JSON.parse(JSON.stringify(rows));

/**
 * A model page: the public builds of one brand and model, their parts,
 * journal entries and rides. `null` when no public build matches.
 * @param {import("pg").Pool | import("pg").PoolClient} q
 * @param {string | null} viewer
 */
export async function modelLanding(q, viewer, brandRef, modelRef) {
  const { catalog } = await getSite(q);
  const parsed = searchInput.safeParse({
    brand: String(brandRef || ""),
    model: String(modelRef || ""),
    exact: "1",
  });
  const input = parsed.data;
  if (!landingSlug(input?.brand) || !landingSlug(input?.model)) return null;
  const params = [];
  const filter = experienceFilter(catalog, input, params),
    where = visible + filter;
  const summary = (
    await q.query(
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
  if (!summary.builds) return null;
  // Bike types by their main label, as on the cards.
  const types = new Map();
  for (const row of (
    await q.query(
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
      classification: row.family && { category: row.family, subtype: row.subtype },
    });
    if (label) types.set(label, (types.get(label) || 0) + row.builds);
  }
  const parts = (
    await q.query(
      `SELECT m.id,m.category,m.name,m.category_slug,m.slug,count(DISTINCT b.id)::int builds` +
        publicParts +
        " JOIN component_models source ON source.id=p.model_id JOIN component_models m ON m.id=coalesce(source.merged_into,source.id)" +
        where + ` AND p.section='build' GROUP BY m.id HAVING count(DISTINCT b.id)>=2
        ORDER BY builds DESC,m.id LIMIT 8`, params,
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
    await q.query(
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
    await q.query(
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
    kind: "model",
    title: `${summary.brand} ${summary.model}`,
    brand: summary.brand,
    model: summary.model,
    path: modelLandingPath(summary.brand, summary.model),
    search: `/experience?${new URLSearchParams({ brand: summary.brand, model: summary.model, exact: "1" })}`,
    indexed: summary.builds >= landingMinimum,
    builds: summary.builds,
    years: [summary.first_year, summary.last_year].filter(Boolean),
    types: [...types]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .slice(0, 3)
      .map(([label, builds]) => ({ label, builds })),
    weight: summary.weight,
    updatedAt: summary.updated_at,
    parts: parts.map((p) => ({ ...p, path: partLandingPath(p.category_slug, p.slug) })),
    // Installation stories live in the journal, so the link opens them there.
    installs: installs.map((p) => ({
      ...p,
      search: experienceHref({ component: p.name, componentCategory: p.category }) + "&type=journal",
    })),
    rides: rides.rides,
    distanceKm: Math.round(rides.distance / 1000),
    bikes: bikes.items.slice(0, 12),
    entries: entries.items.slice(0, 6),
    entryCount: entries.total,
  });
}

/** A durable catalog page, including when the last public installation is gone. */
export async function partLanding(q, viewer, categoryRef, nameRef) {
  const model = await componentModelAtPath(q, categoryRef, nameRef);
  if (!model) return null;
  const { catalog } = await getSite(q);
  const input = searchInput.parse({ componentModelId: model.id, exact: "1" });
  const params = [model.id];
  const match = visible + " AND p.model_id IN (SELECT id FROM component_models WHERE coalesce(merged_into,id)=$1)";
  const summary = (await q.query("SELECT count(DISTINCT b.id)::int builds,max(b.updated_at) updated_at" + publicParts + match, params)).rows[0];
  // Grouped like the model pages, so every link lands on an existing page.
  const modelParams = [...params];
  const addModel = (value) => {
    modelParams.push(value);
    return "$" + modelParams.length;
  };
  const brandRules = experienceRules(catalog, "brand", addModel),
    modelRules = experienceRules(catalog, "model", addModel);
  const models = (
    await q.query(
      `SELECT mode() WITHIN GROUP (ORDER BY b.brand) brand,
        mode() WITHIN GROUP (ORDER BY b.model) model, count(DISTINCT b.id)::int builds` +
        publicParts +
        match +
        ` AND experience_normalize(b.brand)<>'' AND experience_normalize(b.model)<>''
        GROUP BY experience_canonical(b.brand,${brandRules}), experience_canonical(b.model,${modelRules})
        ORDER BY builds DESC, brand, model LIMIT 8`,
      modelParams,
    )
  ).rows;
  const [bikes, entries] = await Promise.all([
    searchExperience(q, viewer, { ...input, type: "bikes" }),
    searchExperience(q, viewer, { ...input, type: "journal" }),
  ]);
  return plain({
    kind: "part",
    id: model.id,
    title: model.name,
    category: model.category,
    brand: model.brand,
    name: model.name,
    categorySlug: model.category_slug,
    slug: model.slug,
    path: partLandingPath(model.category_slug, model.slug),
    search: `/experience?${new URLSearchParams({ componentModelId: model.id, component: model.name, exact: "1" })}`,
    indexed: !model.archived && summary.builds >= landingMinimum,
    builds: summary.builds,
    updatedAt: summary.updated_at || model.updated_at,
    models: models.map((m) => ({ ...m, path: modelLandingPath(m.brand, m.model) })),
    bikes: bikes.items.slice(0, 12),
    entries: entries.items.slice(0, 6),
    entryCount: entries.total,
  });
}

/**
 * Landing pages worth a search engine's visit: models and parts with at
 * least `landingMinimum` public builds, newest changes first.
 * @param {{ model: number, part: number }} limit
 */
export async function landingSitemap(q, limit) {
  const { catalog } = await getSite(q);
  const modelParams = [];
  const addModel = (value) => {
    modelParams.push(value);
    return "$" + modelParams.length;
  };
  const brandRules = experienceRules(catalog, "brand", addModel),
    modelRules = experienceRules(catalog, "model", addModel);
  const models = (
    await q.query(
      `SELECT mode() WITHIN GROUP (ORDER BY b.brand) brand,
        mode() WITHIN GROUP (ORDER BY b.model) model, max(b.updated_at) updated_at` +
        publicBikes +
        visible +
        ` AND experience_normalize(b.brand)<>'' AND experience_normalize(b.model)<>''
        GROUP BY experience_canonical(b.brand,${brandRules}), experience_canonical(b.model,${modelRules})
        HAVING count(*)>=${addModel(landingMinimum)}
        ORDER BY updated_at DESC LIMIT ${addModel(limit.model)}`,
      modelParams,
    )
  ).rows;
  const parts = (await q.query(`WITH counts AS (${componentCounts})
    SELECT m.category_slug,m.slug,greatest(m.updated_at,c.updated_at) updated_at FROM component_models m JOIN counts c ON c.model_id=m.id
    WHERE NOT m.archived AND c.builds>=$1 ORDER BY updated_at DESC,m.id LIMIT $2`,
  [landingMinimum, limit.part])).rows;
  return [
    ...models.map((m) => ({ path: modelLandingPath(m.brand, m.model), updatedAt: m.updated_at })),
    ...parts.map((p) => ({ path: partLandingPath(p.category_slug, p.slug), updatedAt: p.updated_at })),
  ];
}
