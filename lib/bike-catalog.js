import { z } from "zod";
import { CommunityError } from "./community-validation.js";
import { getSite, audit } from "./site.js";
import { landingSlug, modelLandingPath } from "./experience-catalog.js";
import { experienceRules } from "./search.js";

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes("\0"));
export const bikeCatalogInput = z.object({
  q: text(150).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const bikeModelEdit = z
  .object({
    brand: text(100).min(1),
    name: text(150).min(1),
    archived: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine((m) => !!landingSlug(m.brand) && !!landingSlug(m.name));
export const bikeModelMerge = z
  .object({
    targetId: z.uuid(),
    version: z.number().int().positive(),
    targetVersion: z.number().int().positive(),
  })
  .strict();
export const bikeModelCounts = `SELECT coalesce(s.merged_into,s.id) model_id,count(*)::int builds,max(b.updated_at) updated_at
 FROM bikes b JOIN users u ON u.id=b.owner_id JOIN bike_models s ON s.id=b.catalog_model_id
 WHERE b.is_public AND NOT u.blocked GROUP BY 1`;
export async function bikeCatalog(q, input, admin = false) {
  const where = ` FROM bike_models m WHERE m.first_public_at IS NOT NULL AND m.merged_into IS NULL
   ${admin ? "" : "AND NOT m.archived"}
   AND ($1='' OR strpos(lower(m.brand||' '||m.name),lower($1))>0 OR EXISTS(
    SELECT 1 FROM bike_model_names n JOIN bike_models s ON s.id=n.model_id
    WHERE coalesce(s.merged_into,s.id)=m.id AND strpos(n.brand_key||' '||n.name_key,component_key($1))>0))`;
  const total = (await q.query("SELECT count(*)::int total" + where, [input.q]))
    .rows[0].total;
  const rows = (
    await q.query(
      `SELECT m.*${where} ORDER BY m.brand,m.name,m.id LIMIT 24 OFFSET $2`,
      [input.q, (input.page - 1) * 24],
    )
  ).rows;
  return {
    total,
    page: input.page,
    pageSize: 24,
    items: rows.map((m) => ({
      id: m.id,
      brand: m.brand,
      name: m.name,
      path: modelLandingPath(m.brand_slug, m.slug),
      ...(admin ? { version: m.version, archived: m.archived } : {}),
    })),
  };
}
export async function resolveBikeModel(q, id) {
  if (!z.uuid().safeParse(id).success) return null;
  return (
    (
      await q.query(
        `SELECT m.* FROM bike_models s JOIN bike_models m ON m.id=coalesce(s.merged_into,s.id)
   WHERE s.id=$1 AND m.first_public_at IS NOT NULL`,
        [id],
      )
    ).rows[0] || null
  );
}
export async function bikeModelAtPath(q, brand, name) {
  if (
    typeof brand !== "string" ||
    typeof name !== "string" ||
    brand.length > 200 ||
    name.length > 500
  )
    return null;
  /** @type {unknown[]} */
  const params = [landingSlug(brand), landingSlug(name)];
  if (!params[0] || !params[1]) return null;
  const found = (
    await q.query(
      `SELECT m.* FROM bike_model_urls url JOIN bike_models s ON s.id=url.model_id
   JOIN bike_models m ON m.id=coalesce(s.merged_into,s.id)
   WHERE url.brand_slug=$1 AND url.slug=$2 AND m.first_public_at IS NOT NULL`,
      params,
    )
  ).rows[0];
  if (found) return found;
  // Keep permissive legacy experience links only when they resolve unambiguously.
  const { catalog } = await getSite(q);
  const add = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  const brands = experienceRules(catalog, "brand", add),
    models = experienceRules(catalog, "model", add);
  const matches = (
    await q.query(
      `SELECT DISTINCT m.* FROM bike_model_names n JOIN bike_models s ON s.id=n.model_id
   JOIN bike_models m ON m.id=coalesce(s.merged_into,s.id) CROSS JOIN LATERAL (SELECT n.brand_key brand) b
   WHERE m.first_public_at IS NOT NULL AND experience_canonical(n.brand_key,${brands})=experience_canonical($1,${brands})
   AND experience_canonical(n.name_key,${models})=experience_canonical($2,${models}) LIMIT 2`,
      params,
    )
  ).rows;
  return matches.length === 1 ? matches[0] : null;
}
async function mutationLock(q, actor) {
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND role='admin' AND NOT blocked FOR SHARE",
        [actor],
      )
    ).rowCount
  )
    throw new CommunityError("Доступ только для администратора", 403);
  await q.query("SELECT pg_advisory_xact_lock(145,0)");
}
async function editable(q, id, version) {
  const m = (await q.query("SELECT * FROM bike_models WHERE id=$1", [id]))
    .rows[0];
  if (!m || !m.first_public_at || m.merged_into)
    throw new CommunityError("Модель недоступна", 404);
  if (m.version !== version)
    throw new CommunityError("Модель уже изменена. Обновите список.", 409);
  return m;
}
export async function editBikeModel(q, actor, id, input) {
  await mutationLock(q, actor);
  await editable(q, id, input.version);
  const collision = (
    await q.query(
      `SELECT coalesce(m.merged_into,m.id) id FROM bike_model_names n JOIN bike_models m ON m.id=n.model_id
   WHERE n.brand_key=component_key($1) AND n.name_key=component_key($2)`,
      [input.brand, input.name],
    )
  ).rows[0];
  if (collision && collision.id !== id)
    throw new CommunityError(
      "Такая модель уже есть. Проверьте варианты перед объединением.",
      409,
    );
  const brandSlug = landingSlug(input.brand),
    baseSlug = landingSlug(input.name);
  let slug = baseSlug,
    suffix = 0;
  for (;;) {
    const url = (
      await q.query(
        `SELECT coalesce(m.merged_into,m.id) id FROM bike_model_urls u JOIN bike_models m ON m.id=u.model_id
     WHERE u.brand_slug=$1 AND u.slug=$2`,
        [brandSlug, slug],
      )
    ).rows[0];
    if (!url || url.id === id) break;
    slug = baseSlug + "-" + id + (suffix ? "-" + suffix : "");
    suffix++;
  }
  await q.query(
    "INSERT INTO bike_model_names VALUES(component_key($1),component_key($2),$3) ON CONFLICT DO NOTHING",
    [input.brand, input.name, id],
  );
  await q.query(
    "INSERT INTO bike_model_urls VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [brandSlug, slug, id],
  );
  await q.query(
    `UPDATE bike_models SET brand=$2,name=$3,brand_slug=$4,slug=$5,archived=$6,version=version+1,updated_at=now() WHERE id=$1`,
    [id, input.brand, input.name, brandSlug, slug, input.archived],
  );
  await audit(q, actor, "bike_model.update", id);
  return { id, path: modelLandingPath(brandSlug, slug) };
}
export async function mergeBikeModels(q, actor, id, input) {
  await mutationLock(q, actor);
  if (id === input.targetId) throw new CommunityError("Выберите другую модель");
  const source = await editable(q, id, input.version),
    target = await editable(q, input.targetId, input.targetVersion);
  if (target.archived)
    throw new CommunityError("Сначала верните целевую модель в каталог", 409);
  // The original IDs in bicycles and listings stay valid. Flatten previous merges.
  await q.query(
    "UPDATE bike_models SET merged_into=$2,version=version+1,updated_at=now() WHERE id=$1 OR merged_into=$1",
    [id, target.id],
  );
  await q.query(
    "UPDATE bike_models SET first_public_at=least(first_public_at,$2),version=version+1,updated_at=now() WHERE id=$1",
    [target.id, source.first_public_at],
  );
  await audit(q, actor, "bike_model.merge", id + " -> " + target.id);
  return {
    id: target.id,
    path: modelLandingPath(target.brand_slug, target.slug),
  };
}
