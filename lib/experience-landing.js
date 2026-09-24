// Landing pages of owner experience for a model and for a part (#74): the
// same public data and spelling rules as /experience, one server-rendered
// page per canonical name, indexed once there is enough to read.
import { getSite } from "./site.js";
import {
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
  const where = visible + experienceFilter(catalog, input, params);
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
  // Grouped like the part pages, so every link lands on an existing page.
  const partParams = [...params];
  const partRules = experienceRules(catalog, "component", (value) => {
    partParams.push(value);
    return "$" + partParams.length;
  });
  const parts = (
    await q.query(
      `SELECT mode() WITHIN GROUP (ORDER BY p.category) category,
        mode() WITHIN GROUP (ORDER BY p.name) name, count(DISTINCT b.id)::int builds` +
        publicParts +
        where +
        ` AND p.section='build' AND experience_normalize(p.name)<>''
        AND experience_normalize(p.category)<>''
        GROUP BY experience_normalize(p.category), experience_canonical(p.name,${partRules})
        HAVING count(DISTINCT b.id)>=2
        ORDER BY builds DESC, category, name LIMIT 8`,
      partParams,
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
    weight: summary.weight,
    updatedAt: summary.updated_at,
    parts: parts.map((p) => ({ ...p, path: partLandingPath(p.category, p.name) })),
    rides: rides.rides,
    distanceKm: Math.round(rides.distance / 1000),
    bikes: bikes.items.slice(0, 12),
    entries: entries.items.slice(0, 6),
    entryCount: entries.total,
  });
}

/**
 * A part page: public bikes with this part or accessory in their current
 * configuration and journal entries that captured it. `null` when no public
 * bike has it.
 */
export async function partLanding(q, viewer, categoryRef, nameRef) {
  const { catalog } = await getSite(q);
  const parsed = searchInput.safeParse({
    component: String(nameRef || ""),
    componentCategory: String(categoryRef || ""),
    exact: "1",
  });
  const input = parsed.data;
  if (!landingSlug(input?.component) || !landingSlug(input?.componentCategory))
    return null;
  const params = [];
  const add = (value) => {
    params.push(value);
    return "$" + params.length;
  };
  const rules = experienceRules(catalog, "component", add);
  const match =
    visible +
    ` AND experience_normalize(p.category)=experience_normalize(${add(input.componentCategory)})` +
    ` AND experience_canonical(p.name,${rules})=experience_canonical(${add(input.component)},${rules})`;
  const summary = (
    await q.query(
      `SELECT count(DISTINCT b.id)::int builds,
        mode() WITHIN GROUP (ORDER BY p.category) category,
        mode() WITHIN GROUP (ORDER BY p.name) name,
        max(b.updated_at) updated_at` +
        publicParts +
        match,
      params,
    )
  ).rows[0];
  if (!summary.builds) return null;
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
    title: summary.name,
    category: summary.category,
    name: summary.name,
    path: partLandingPath(summary.category, summary.name),
    search: `/experience?${new URLSearchParams({ component: summary.name, componentCategory: summary.category, exact: "1" })}`,
    indexed: summary.builds >= landingMinimum,
    builds: summary.builds,
    updatedAt: summary.updated_at,
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
  const partParams = [];
  const addPart = (value) => {
    partParams.push(value);
    return "$" + partParams.length;
  };
  const partRules = experienceRules(catalog, "component", addPart);
  const parts = (
    await q.query(
      `SELECT mode() WITHIN GROUP (ORDER BY p.category) category,
        mode() WITHIN GROUP (ORDER BY p.name) name, max(b.updated_at) updated_at` +
        publicParts +
        visible +
        ` AND experience_normalize(p.name)<>'' AND experience_normalize(p.category)<>''
        GROUP BY experience_normalize(p.category), experience_canonical(p.name,${partRules})
        HAVING count(DISTINCT b.id)>=${addPart(landingMinimum)}
        ORDER BY updated_at DESC LIMIT ${addPart(limit.part)}`,
      partParams,
    )
  ).rows;
  return [
    ...models.map((m) => ({ path: modelLandingPath(m.brand, m.model), updatedAt: m.updated_at })),
    ...parts.map((p) => ({ path: partLandingPath(p.category, p.name), updatedAt: p.updated_at })),
  ];
}
