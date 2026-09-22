// Only fixed SQL expressions; all user values are parameters. COALESCE supports
// old rows/clients without a classification, including rolling upgrades.
export const classificationCategorySql =
  "coalesce(b.classification->>'category',CASE WHEN b.category IN ('road','gravel') THEN 'road_gravel' ELSE b.category END)";
const subtypeSql =
  "coalesce(b.classification->>'subtype',CASE WHEN b.category IN ('road','gravel') THEN b.category END)";
export function classificationWhere(input = {}, params = [], categories = []) {
  const add = (value) => {
    params.push(value);
    return "$" + params.length;
  };
  const clauses = [];
  if (categories.length) {
    const canonical = categories.filter((v) => !["road", "gravel"].includes(v));
    const types = [];
    if (canonical.length)
      types.push(`${classificationCategorySql}=ANY(${add(canonical)}::text[])`);
    if (categories.includes("gravel"))
      types.push(
        `(${classificationCategorySql}='road_gravel' AND ${subtypeSql}='gravel')`,
      );
    if (categories.includes("road"))
      types.push(
        `(${classificationCategorySql}='road_gravel' AND ${subtypeSql}<>'gravel')`,
      );
    clauses.push("(" + types.join(" OR ") + ")");
  }
  if (input.subtype) clauses.push(`${subtypeSql}=${add(input.subtype)}`);
  for (const key of ["suspension", "construction"])
    if (input[key])
      clauses.push(`b.classification->>'${key}'=${add(input[key])}`);
  if (input.use)
    clauses.push(
      `coalesce(b.classification->'uses','[]'::jsonb) @> ${add(JSON.stringify([input.use]))}::jsonb`,
    );
  for (const key of ["electric", "fatbike"])
    if (input[key] === "0" || input[key] === "1")
      clauses.push(
        `coalesce((b.classification->>'${key}')::boolean,false)=${add(input[key] === "1")}`,
      );
  return clauses.length ? " AND " + clauses.join(" AND ") : "";
}
