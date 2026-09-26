import { z } from "zod";
import { CommunityError } from "./community-validation.js";
import { getSite, audit } from "./site.js";
import { landingSlug, partLandingPath } from "./experience-catalog.js";
import { experienceRules } from "./search.js";

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes("\0"));
export const componentCatalogInput = z.object({
  q: text(150).default(""),
  category: text(60).default(""),
  brand: text(100).default(""),
  sort: z.enum(["popular", "new"]).default("popular"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const componentModelEdit = z
  .object({
    category: text(60).min(1),
    brand: text(100),
    name: text(150).min(1),
    archived: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export const componentModelMerge = z
  .object({
    targetId: z.uuid(),
    version: z.number().int().positive(),
    targetVersion: z.number().int().positive(),
  })
  .strict();

export const componentCounts = `SELECT coalesce(source.merged_into,source.id) model_id,
 count(DISTINCT b.id)::int builds,max(b.updated_at) updated_at FROM components p
 JOIN component_models source ON source.id=p.model_id
 JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id
 WHERE b.is_public AND NOT u.blocked GROUP BY 1`;
const publicModel = (m) => ({
  id: m.id,
  category: m.category,
  brand: m.brand,
  name: m.name,
  path: partLandingPath(m.category_slug, m.slug),
  builds: m.builds || 0,
  firstPublicAt: m.first_public_at,
});

/** A bounded public DTO. Never return installations, owners or private dates. */
export async function componentCatalog(q, input, admin = false) {
  const visibility =
    "m.first_public_at IS NOT NULL AND m.merged_into IS NULL" +
    (admin ? "" : " AND NOT m.archived");
  const where = ` FROM component_models m WHERE ${visibility}
    AND ($1='' OR strpos(lower(m.name||' '||m.brand),lower($1))>0
      OR EXISTS(SELECT 1 FROM component_model_names n JOIN component_models source ON source.id=n.model_id
        WHERE coalesce(source.merged_into,source.id)=m.id AND strpos(n.name_key,component_key($1))>0))
    AND ($2='' OR component_key(m.category)=component_key($2))
    AND ($3='' OR component_key(m.brand)=component_key($3))`;
  const params = [input.q, input.category, input.brand];
  const total = (await q.query("SELECT count(*)::int total" + where, params))
    .rows[0].total;
  const rows = (
    await q.query(
      `WITH counts AS (${componentCounts}) SELECT m.*,
      coalesce((SELECT builds FROM counts WHERE model_id=m.id),0)::int builds` +
        where +
        " ORDER BY " +
        (input.sort === "new" ? "m.first_public_at DESC" : "builds DESC") +
        ",m.id LIMIT 24 OFFSET $4",
      [...params, (input.page - 1) * 24],
    )
  ).rows;
  const options = (
    await q.query(
      `SELECT DISTINCT m.category,m.brand FROM component_models m WHERE ${visibility} ORDER BY 1,2`,
    )
  ).rows;
  return {
    items: rows.map((m) => ({
      ...publicModel(m),
      ...(admin ? { version: m.version, archived: m.archived } : {}),
    })),
    total,
    page: input.page,
    pageSize: 24,
    categories: [...new Set(options.map((r) => r.category))],
    brands: [...new Set(options.map((r) => r.brand).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "ru"),
    ),
  };
}

/** Stable external references resolve through retained merge rows, one hop. */
export async function resolveComponentModel(q, id) {
  if (!z.uuid().safeParse(id).success) return null;
  return (
    (
      await q.query(
        `SELECT m.* FROM component_models source
    JOIN component_models m ON m.id=coalesce(source.merged_into,source.id)
    WHERE source.id=$1 AND m.first_public_at IS NOT NULL`,
        [id],
      )
    ).rows[0] || null
  );
}

export async function componentModelAtPath(q, category, name) {
  if (
    typeof category !== "string" ||
    typeof name !== "string" ||
    category.length > 200 ||
    name.length > 500
  )
    return null;
  /** @type {unknown[]} */
  const params = [landingSlug(category), landingSlug(name)];
  if (!params[0] || !params[1]) return null;
  const found = (
    await q.query(
      `SELECT m.* FROM component_model_urls url
    JOIN component_models source ON source.id=url.model_id
    JOIN component_models m ON m.id=coalesce(source.merged_into,source.id)
    WHERE url.category_slug=$1 AND url.slug=$2 AND m.first_public_at IS NOT NULL`,
      params,
    )
  ).rows[0];
  if (found) return found;
  // Old experience URLs accepted permissive spelling/search aliases. Redirect
  // only if they now identify ONE model; never guess between variants.
  const { catalog } = await getSite(q);
  const rules = experienceRules(catalog, "component", (v) => {
    params.push(v);
    return "$" + params.length;
  });
  const matches = (
    await q.query(
      `SELECT DISTINCT m.* FROM component_model_names n
    JOIN component_models source ON source.id=n.model_id
    JOIN component_models m ON m.id=coalesce(source.merged_into,source.id)
    CROSS JOIN LATERAL (SELECT n.category_key category) p
    WHERE m.first_public_at IS NOT NULL AND experience_normalize(n.category_key)=experience_normalize($1)
      AND experience_canonical(n.name_key,${rules})=experience_canonical($2,${rules}) LIMIT 2`,
      params,
    )
  ).rows;
  return matches.length === 1 ? matches[0] : null;
}

// Caller owns the transaction. No user installations/snapshots are rewritten.
async function editable(q, id, version) {
  const m = (await q.query("SELECT * FROM component_models WHERE id=$1", [id]))
    .rows[0];
  if (!m || !m.first_public_at || m.merged_into)
    throw new CommunityError("Модель недоступна", 404);
  if (m.version !== version)
    throw new CommunityError("Модель уже изменена. Обновите список.", 409);
  return m;
}
async function catalogMutationLock(q, actor) {
  const user = (
    await q.query(
      "SELECT id FROM users WHERE id=$1 AND role='admin' AND NOT blocked FOR SHARE",
      [actor],
    )
  ).rows[0];
  if (!user) throw new CommunityError("Доступ только для администратора", 403);
  await q.query("SELECT pg_advisory_xact_lock(145,0)");
}
export async function editComponentModel(q, actor, id, input) {
  await catalogMutationLock(q, actor);
  await editable(q, id, input.version);
  const collision = (
    await q.query(
      `SELECT coalesce(m.merged_into,m.id) id FROM component_model_names n
    JOIN component_models m ON m.id=n.model_id WHERE n.category_key=component_key($1) AND n.name_key=component_key($2)`,
      [input.category, input.name],
    )
  ).rows[0];
  if (collision && collision.id !== id)
    throw new CommunityError(
      "Такая модель уже есть. Проверьте варианты перед объединением.",
      409,
    );
  const categorySlug = landingSlug(input.category) || "component";
  const baseSlug = landingSlug(input.name) || "model";
  let slug = baseSlug,
    suffix = 0;
  for (;;) {
    const url = (
      await q.query(
        `SELECT coalesce(m.merged_into,m.id) id FROM component_model_urls u
    JOIN component_models m ON m.id=u.model_id WHERE u.category_slug=$1 AND u.slug=$2`,
        [categorySlug, slug],
      )
    ).rows[0];
    if (!url || url.id === id) break;
    slug = baseSlug + "-" + id + (suffix ? "-" + suffix : "");
    suffix++;
  }
  await q.query(
    "INSERT INTO component_model_names VALUES(component_key($1),component_key($2),$3) ON CONFLICT DO NOTHING",
    [input.category, input.name, id],
  );
  await q.query(
    "INSERT INTO component_model_urls VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [categorySlug, slug, id],
  );
  await q.query(
    `UPDATE component_models SET category=$2,brand=$3,name=$4,archived=$5,
    category_slug=$6,slug=$7,version=version+1,updated_at=now() WHERE id=$1`,
    [
      id,
      input.category,
      input.brand,
      input.name,
      input.archived,
      categorySlug,
      slug,
    ],
  );
  await audit(q, actor, "component_model.update", id);
  return { id, path: partLandingPath(categorySlug, slug) };
}
export async function mergeComponentModels(q, actor, id, input) {
  await catalogMutationLock(q, actor);
  if (id === input.targetId) throw new CommunityError("Выберите другую модель");
  const source = await editable(q, id, input.version);
  const target = await editable(q, input.targetId, input.targetVersion);
  if (target.archived)
    throw new CommunityError("Сначала верните целевую модель в каталог", 409);
  const photos = (
    await q.query(
      "SELECT count(*)::int n FROM component_photos p JOIN component_models s ON s.id=p.model_id WHERE coalesce(s.merged_into,s.id)=ANY($1::uuid[])",
      [[id, target.id]],
    )
  ).rows[0].n;
  if (photos > 60)
    throw new CommunityError(
      "В объединённой галерее будет больше 60 фото. Сначала проверьте и удалите лишние загрузки.",
      409,
    );
  // Flatten old merges. Existing installation/content FKs still point at their
  // original stable IDs; readers resolve those IDs, so no foreign content dies.
  await q.query(
    `UPDATE component_models SET merged_into=$2,version=version+1,updated_at=now()
    WHERE id=$1 OR merged_into=$1`,
    [id, target.id],
  );
  await q.query(
    `UPDATE component_models SET first_public_at=least(first_public_at,$2),
    cover_photo_id=coalesce(cover_photo_id,$3),gallery_version=gallery_version+1,
    version=version+1,updated_at=now() WHERE id=$1`,
    [target.id, source.first_public_at, source.cover_photo_id],
  );
  await audit(q, actor, "component_model.merge", id + " -> " + target.id);
  return {
    id: target.id,
    path: partLandingPath(target.category_slug, target.slug),
  };
}
